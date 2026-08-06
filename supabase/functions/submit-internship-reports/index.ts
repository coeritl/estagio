import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://coeri.tl.ifms.edu.br",
  "https://coeritl.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
]);
const coeriEmail = "coeri.tl@ifms.edu.br";
const maxSize = 10 * 1024 * 1024;
const maxRequestSize = 15 * 1024 * 1024;
const types: Record<string, string> = {
  partial_report: "parcial",
  final_report: "final",
  supervisor_evaluation: "avaliacao_supervisor"
};

function headers(origin: string) {
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://coeri.tl.ifms.edu.br",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8"
  };
}
function answer(origin: string, status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), { status, headers: headers(origin) });
}
function failure(origin: string, status = 400, message?: string) {
  return answer(origin, status, {
    error: message || `Não foi possível concluir o envio. Confira os dados e tente novamente. Se o problema persistir, entre em contato com a COERI pelo e-mail ${coeriEmail}.`
  });
}

Deno.serve(async request => {
  const origin = request.headers.get("origin") ?? "";
  if (request.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (request.method !== "POST" || !allowedOrigins.has(origin)) return failure(origin, 403);

  const storedPaths: string[] = [];
  try {
    const form = await request.formData();
    const token = String(form.get("token") || "");
    const captchaForm = new FormData();
    captchaForm.append("secret", Deno.env.get("TURNSTILE_SECRET_KEY") ?? "");
    captchaForm.append("response", token);
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) captchaForm.append("remoteip", forwarded);
    const captchaResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: captchaForm
    });
    const captcha = await captchaResponse.json();
    if (!captcha.success) {
      console.warn("report-upload: captcha-rejected");
      return failure(origin, 403, `Não foi possível validar o CAPTCHA. Recarregue a página e tente novamente. Se o problema persistir, escreva para ${coeriEmail}.`);
    }

    const cpf = String(form.get("cpf") || "").replace(/\D/g, "");
    const email = String(form.get("email") || "").trim().toLowerCase();
    const studentClass = String(form.get("student_class") || "").trim().slice(0, 120);
    const internshipPeriod = String(form.get("internship_period") || "").trim().slice(0, 160);
    const totalWorkload = Number(String(form.get("total_workload") || "").replace(/\D/g, ""));
    if (
      cpf.length !== 11 ||
      !email.endsWith("@estudante.ifms.edu.br") ||
      !studentClass ||
      !internshipPeriod ||
      !Number.isInteger(totalWorkload) ||
      totalWorkload < 1 ||
      totalWorkload > 10000
    ) return failure(origin, 400, `Confira o CPF, o e-mail institucional, a turma, o período e a carga horária informados. Se precisar de ajuda, escreva para ${coeriEmail}.`);

    const files = Object.entries(types)
      .map(([field, documentType]) => ({ file: form.get(field), documentType }))
      .filter(item => item.file instanceof File && item.file.size > 0) as Array<{file: File; documentType: string}>;
    if (!files.length) return failure(origin, 400, "Selecione pelo menos um documento para enviar.");
    const invalidFile = files.some(item => {
      const isPdf = item.file.type === "application/pdf" || item.file.name.toLowerCase().endsWith(".pdf");
      return !isPdf || item.file.size > maxSize;
    });
    if (invalidFile) return failure(origin, 400, "Envie somente arquivos PDF de até 10 MB cada.");
    const totalSize = files.reduce((sum, item) => sum + item.file.size, 0);
    if (totalSize > maxRequestSize) {
      return failure(origin, 413, "Os arquivos somam mais de 15 MB. Envie os documentos em etapas separadas.");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );
    const { data: matches, error: matchError } = await supabase
      .from("internships")
      .select("id,student_cpf")
      .eq("status", "em_andamento")
      .limit(2000);
    const identified = (matches || []).filter(item =>
      String(item.student_cpf || "").replace(/\D/g, "") === cpf
    );
    if (matchError) {
      console.error("report-upload: internship-query-failed", matchError.message);
      return failure(origin, 500, `Não foi possível consultar o cadastro agora. Tente novamente em alguns minutos ou escreva para ${coeriEmail}.`);
    }
    if (!identified.length) {
      console.warn("report-upload: no-matching-active-internship");
      return failure(origin, 404, `Não encontramos um estágio em andamento com este CPF. Confira o número informado ou escreva para ${coeriEmail}.`);
    }
    if (identified.length > 1) {
      console.warn("report-upload: duplicate-matching-active-internship");
      return failure(origin, 409, `Há mais de um estágio em andamento vinculado a este CPF. Entre em contato com a COERI pelo e-mail ${coeriEmail} para identificar o cadastro correto.`);
    }

    const submissionCode = crypto.randomUUID();
    const rows = [];
    for (const { file, documentType } of files) {
      const path = `${identified[0].id}/${submissionCode}/${documentType}.pdf`;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { error: uploadError } = await supabase.storage
        .from("internship-reports")
        .upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (uploadError) throw uploadError;
      storedPaths.push(path);
      rows.push({
        internship_id: identified[0].id,
        document_type: documentType,
        original_filename: file.name.slice(0, 255),
        storage_path: path,
        mime_type: "application/pdf",
        file_size: file.size,
        student_class: studentClass,
        internship_period: internshipPeriod,
        total_workload: totalWorkload
      });
    }
    const { error: insertError } = await supabase.from("internship_report_submissions").insert(rows);
    if (insertError) throw insertError;
    return answer(origin, 200, {
      success: true,
      message: "Documentos enviados para a COERI com sucesso.",
      receipt: submissionCode.split("-")[0].toUpperCase()
    });
  } catch (error) {
    console.error("report-upload: unexpected-failure", error instanceof Error ? error.message : String(error));
    if (storedPaths.length) {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await supabase.storage.from("internship-reports").remove(storedPaths);
    }
    return failure(origin, 500);
  }
});
