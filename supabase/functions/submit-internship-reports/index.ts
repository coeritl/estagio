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
const documentLabels: Record<string, string> = {
  parcial: "Relatório parcial",
  final: "Relatório final",
  avaliacao_supervisor: "Avaliação do estagiário pelo supervisor"
};
const uploadBucket = "internship-reports";

type StudentData = {
  cpf: string;
  email: string;
  whatsapp: string;
  studentClass: string;
  internshipPeriod: string;
  totalWorkload: number;
};
type UploadDocument = {
  field: string;
  documentType: string;
  originalFilename: string;
  size: number;
  path: string;
};
type UploadSession = StudentData & {
  internshipId: string;
  studentName: string;
  submissionCode: string;
  expiresAt: number;
  documents: UploadDocument[];
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

function normalizeStudentData(source: Record<string, unknown>): StudentData | null {
  const cpf = String(source.cpf || "").replace(/\D/g, "");
  const email = String(source.email || "").trim().toLowerCase();
  const whatsappDigits = String(source.whatsapp || "").replace(/\D/g, "").slice(0, 11);
  const whatsapp = whatsappDigits.length === 11
    ? `(${whatsappDigits.slice(0, 2)}) ${whatsappDigits.slice(2, 7)}-${whatsappDigits.slice(7)}`
    : "";
  const studentClass = String(source.student_class || source.studentClass || "").trim().slice(0, 120);
  const internshipPeriod = String(source.internship_period || source.internshipPeriod || "").trim().slice(0, 160);
  const totalWorkload = Number(String(source.total_workload || source.totalWorkload || "").replace(/\D/g, ""));
  if (
    cpf.length !== 11 ||
    !/^[^@\s]+@(?:estudante\.)?ifms\.edu\.br$/.test(email) ||
    whatsappDigits.length !== 11 ||
    !studentClass ||
    !internshipPeriod ||
    !Number.isInteger(totalWorkload) ||
    totalWorkload < 1 ||
    totalWorkload > 10000
  ) return null;
  return { cpf, email, whatsapp, studentClass, internshipPeriod, totalWorkload };
}

async function validateCaptcha(token: string, request: Request) {
  const captchaForm = new FormData();
  captchaForm.append("secret", Deno.env.get("TURNSTILE_SECRET_KEY") ?? "");
  captchaForm.append("response", token);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) captchaForm.append("remoteip", forwarded);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: captchaForm });
  const result = await response.json();
  return Boolean(result.success);
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function signingKey() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(Deno.env.get("REPORT_UPLOAD_SIGNING_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signSession(session: UploadSession) {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(session)));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), new TextEncoder().encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

async function verifySession(value: string): Promise<UploadSession | null> {
  try {
    const [payload, signature] = value.split(".");
    if (!payload || !signature) return null;
    const valid = await crypto.subtle.verify("HMAC", await signingKey(), fromBase64Url(signature), new TextEncoder().encode(payload));
    if (!valid) return null;
    const session = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as UploadSession;
    return session.expiresAt > Date.now() ? session : null;
  } catch {
    return null;
  }
}

async function dispatchEmail(service: any, notification: any) {
  const url = Deno.env.get("GOOGLE_APPS_SCRIPT_URL") || "";
  const secret = Deno.env.get("GOOGLE_APPS_SCRIPT_SECRET") || "";
  const attempts = Number(notification.attempts || 0) + 1;
  if (!url || !secret) {
    await service.from("email_notifications").update({ status: "falhou", attempts, error_message: "Google Apps Script não configurado." }).eq("id", notification.id);
    return false;
  }
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        notificationId: notification.id,
        type: notification.event_type,
        to: notification.recipient_email,
        subject: notification.subject,
        studentName: notification.student_name,
        data: notification.template_data
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw new Error(result.error || `Google respondeu com HTTP ${response.status}.`);
    await service.from("email_notifications").update({
      status: "enviado",
      attempts,
      error_message: null,
      provider_response: result,
      sent_at: new Date().toISOString()
    }).eq("id", notification.id);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await service.from("email_notifications").update({ status: "falhou", attempts, error_message: errorMessage.slice(0, 1000) }).eq("id", notification.id);
    return false;
  }
}

async function findInternship(service: any, cpf: string) {
  const { data: matches, error } = await service
    .from("internships")
    .select("id,student_cpf,student_name")
    .eq("status", "em_andamento")
    .limit(2000);
  if (error) throw new Error(`internship-query:${error.message}`);
  return (matches || []).filter((item: any) => String(item.student_cpf || "").replace(/\D/g, "") === cpf);
}

async function registerSubmission(service: any, session: UploadSession) {
  const paths = session.documents.map(document => document.path);
  const { data: existing, error: existingError } = await service
    .from("internship_report_submissions")
    .select("id")
    .in("storage_path", paths)
    .limit(1);
  if (existingError) throw existingError;
  if (existing?.length) return { alreadyRegistered: true, emailSent: false };

  const folder = `${session.internshipId}/${session.submissionCode}`;
  const { data: stored, error: listError } = await service.storage.from(uploadBucket).list(folder, { limit: 10 });
  if (listError) throw listError;
  const storedByName = new Map((stored || []).map((item: any) => [item.name, item]));
  const complete = session.documents.every(document => {
    const filename = document.path.split("/").pop() || "";
    const item: any = storedByName.get(filename);
    const storedSize = Number(item?.metadata?.size ?? item?.metadata?.contentLength ?? 0);
    return item && (!storedSize || storedSize === document.size);
  });
  if (!complete) throw new Error("upload-incomplete");

  const rows = session.documents.map(document => ({
    internship_id: session.internshipId,
    document_type: document.documentType,
    original_filename: document.originalFilename.slice(0, 255),
    storage_path: document.path,
    mime_type: "application/pdf",
    file_size: document.size,
    student_class: session.studentClass,
    internship_period: session.internshipPeriod,
    total_workload: session.totalWorkload,
    contact_email: session.email,
    contact_whatsapp: session.whatsapp
  }));
  const { error: insertError } = await service.from("internship_report_submissions").insert(rows);
  if (insertError) throw insertError;
  if (rows.some(document => document.document_type === "parcial")) {
    const { error } = await service.from("internships")
      .update({ partial_report_received_at: new Date().toISOString() })
      .eq("id", session.internshipId);
    if (error) console.error("report-upload: partial-received-marker-failed", error.message);
  }

  let emailSent = false;
  try {
    const documentNames = rows.map(document => documentLabels[document.document_type] || document.document_type);
    const { data: notification, error } = await service.from("email_notifications").insert({
      event_type: "relatorios_recebidos",
      reference_key: session.submissionCode,
      recipient_email: session.email,
      student_name: session.studentName,
      subject: "Documentação de estágio recebida pela COERI",
      template_data: { documentTypes: documentNames }
    }).select("*").single();
    if (error) throw error;
    emailSent = await dispatchEmail(service, notification);
  } catch (error) {
    console.error("report-upload: receipt-email-failed", error instanceof Error ? error.message : String(error));
  }
  return { alreadyRegistered: false, emailSent };
}

async function handleDirectUpload(request: Request, origin: string, body: Record<string, any>) {
  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );
  if (body.action === "init") {
    if (!await validateCaptcha(String(body.token || ""), request)) {
      console.warn("report-upload: captcha-rejected");
      return failure(origin, 403, `Não foi possível validar o CAPTCHA. Recarregue a página e tente novamente. Se o problema persistir, escreva para ${coeriEmail}.`);
    }
    const student = normalizeStudentData(body);
    if (!student) return failure(origin, 400, `Confira o CPF, o e-mail institucional, o WhatsApp, a turma, o período e a carga horária informados. Se precisar de ajuda, escreva para ${coeriEmail}.`);
    const requested = Array.isArray(body.documents) ? body.documents : [];
    const documents = requested.map((item: any) => ({
      field: String(item.field || ""),
      documentType: types[String(item.field || "")],
      originalFilename: String(item.name || "").slice(0, 255),
      size: Number(item.size || 0)
    }));
    const invalid = !documents.length || documents.some((document: any) =>
      !document.documentType || !document.originalFilename.toLowerCase().endsWith(".pdf") ||
      !Number.isInteger(document.size) || document.size < 1 || document.size > maxSize
    );
    if (invalid) return failure(origin, 400, "Envie somente arquivos PDF de até 10 MB cada.");
    if (documents.reduce((sum: number, document: any) => sum + document.size, 0) > maxRequestSize) {
      return failure(origin, 413, "Os arquivos somam mais de 15 MB. Envie os documentos em etapas separadas.");
    }
    let matches;
    try {
      matches = await findInternship(service, student.cpf);
    } catch (error) {
      console.error("report-upload: internship-query-failed", error instanceof Error ? error.message : String(error));
      return failure(origin, 500, `Não foi possível consultar o cadastro agora. Tente novamente em alguns minutos ou escreva para ${coeriEmail}.`);
    }
    if (!matches.length) return failure(origin, 404, `Não encontramos um estágio em andamento com este CPF. Confira o número informado ou escreva para ${coeriEmail}.`);
    if (matches.length > 1) return failure(origin, 409, `Há mais de um estágio em andamento vinculado a este CPF. Entre em contato com a COERI pelo e-mail ${coeriEmail} para identificar o cadastro correto.`);

    const submissionCode = crypto.randomUUID();
    const sessionDocuments: UploadDocument[] = documents.map((document: any) => ({
      ...document,
      path: `${matches[0].id}/${submissionCode}/${document.documentType}.pdf`
    }));
    const uploads = [];
    for (const document of sessionDocuments) {
      const { data, error } = await service.storage.from(uploadBucket).createSignedUploadUrl(document.path, { upsert: false });
      if (error) throw error;
      uploads.push({ field: document.field, path: document.path, token: data.token });
    }
    const session: UploadSession = {
      ...student,
      internshipId: matches[0].id,
      studentName: matches[0].student_name,
      submissionCode,
      expiresAt: Date.now() + 2 * 60 * 60 * 1000,
      documents: sessionDocuments
    };
    return answer(origin, 200, { success: true, session: await signSession(session), uploads });
  }

  const session = await verifySession(String(body.session || ""));
  if (!session) return failure(origin, 401, `A autorização do envio expirou. Recarregue a página e tente novamente. Se precisar, escreva para ${coeriEmail}.`);
  if (body.action === "cancel") {
    await service.storage.from(uploadBucket).remove(session.documents.map(document => document.path));
    return answer(origin, 200, { success: true });
  }
  if (body.action !== "finalize") return failure(origin, 400);
  try {
    const result = await registerSubmission(service, session);
    return answer(origin, 200, {
      success: true,
      message: result.alreadyRegistered ? "Este envio já havia sido registrado pela COERI." : "Documentos enviados para a COERI com sucesso.",
      receipt: session.submissionCode.split("-")[0].toUpperCase(),
      email_sent: result.emailSent
    });
  } catch (error) {
    console.error("report-upload: finalize-failed", error instanceof Error ? error.message : String(error));
    return failure(origin, 500, error instanceof Error && error.message === "upload-incomplete"
      ? `Nem todos os arquivos chegaram ao armazenamento. Tente novamente ou escreva para ${coeriEmail}.`
      : undefined);
  }
}

Deno.serve(async request => {
  const origin = request.headers.get("origin") ?? "";
  if (request.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (request.method !== "POST" || !allowedOrigins.has(origin)) return failure(origin, 403);

  if ((request.headers.get("content-type") || "").includes("application/json")) {
    try {
      return await handleDirectUpload(request, origin, await request.json());
    } catch (error) {
      console.error("report-upload: direct-flow-failure", error instanceof Error ? error.message : String(error));
      return failure(origin, 500);
    }
  }

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
    const whatsappDigits = String(form.get("whatsapp") || "").replace(/\D/g, "").slice(0, 11);
    const whatsapp = whatsappDigits.length === 11
      ? `(${whatsappDigits.slice(0, 2)}) ${whatsappDigits.slice(2, 7)}-${whatsappDigits.slice(7)}`
      : "";
    const studentClass = String(form.get("student_class") || "").trim().slice(0, 120);
    const internshipPeriod = String(form.get("internship_period") || "").trim().slice(0, 160);
    const totalWorkload = Number(String(form.get("total_workload") || "").replace(/\D/g, ""));
    if (
      cpf.length !== 11 ||
      !/^[^@\s]+@(?:estudante\.)?ifms\.edu\.br$/.test(email) ||
      whatsappDigits.length !== 11 ||
      !studentClass ||
      !internshipPeriod ||
      !Number.isInteger(totalWorkload) ||
      totalWorkload < 1 ||
      totalWorkload > 10000
    ) return failure(origin, 400, `Confira o CPF, o e-mail institucional (@estudante.ifms.edu.br ou @ifms.edu.br), o WhatsApp, a turma, o período e a carga horária informados. Se precisar de ajuda, escreva para ${coeriEmail}.`);

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
      .select("id,student_cpf,student_name")
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
        total_workload: totalWorkload,
        contact_email: email,
        contact_whatsapp: whatsapp
      });
    }
    const { error: insertError } = await supabase.from("internship_report_submissions").insert(rows);
    if (insertError) throw insertError;
    if (rows.some(row => row.document_type === "parcial")) {
      const { error: receivedError } = await supabase.from("internships")
        .update({ partial_report_received_at: new Date().toISOString() })
        .eq("id", identified[0].id);
      if (receivedError) console.error("report-upload: partial-received-marker-failed", receivedError.message);
    }
    let emailSent = false;
    try {
      const documentNames = rows.map(row => documentLabels[row.document_type] || row.document_type);
      const { data: notification, error: notificationError } = await supabase.from("email_notifications").insert({
        event_type: "relatorios_recebidos",
        reference_key: submissionCode,
        recipient_email: email,
        student_name: identified[0].student_name,
        subject: "Documentação de estágio recebida pela COERI",
        template_data: { documentTypes: documentNames }
      }).select("*").single();
      if (notificationError) throw notificationError;
      emailSent = await dispatchEmail(supabase, notification);
    } catch (notificationError) {
      console.error("report-upload: receipt-email-failed", notificationError instanceof Error ? notificationError.message : String(notificationError));
    }
    return answer(origin, 200, {
      success: true,
      message: "Documentos enviados para a COERI com sucesso.",
      receipt: submissionCode.split("-")[0].toUpperCase(),
      email_sent: emailSent
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
