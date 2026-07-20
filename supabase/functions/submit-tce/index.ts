// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://coeritl.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
]);

function cors(origin: string | null) {
  const allowed = origin && allowedOrigins.has(origin) ? origin : "https://coeritl.github.io";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function response(origin: string | null, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

const text = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);
const bool = (value: unknown) => value === true;

export default { async fetch(request: Request) {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (request.method !== "POST") return response(origin, 405, { error: "Método não permitido." });

  try {
    const { token, payload: input } = await request.json();
    if (!token || !input || typeof input !== "object") {
      return response(origin, 400, { error: "Preencha o formulário e confirme o CAPTCHA." });
    }

    const captchaForm = new FormData();
    captchaForm.append("secret", Deno.env.get("TURNSTILE_SECRET_KEY") ?? "");
    captchaForm.append("response", text(token, 2048));
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) captchaForm.append("remoteip", forwarded);
    const captchaResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: captchaForm,
    });
    const captcha = await captchaResponse.json();
    if (!captcha.success) return response(origin, 403, { error: "Não foi possível validar o CAPTCHA. Tente novamente." });

    const studentEmail = text(input.student_email, 254).toLowerCase();
    if (!/^[^@\s]+@estudante\.ifms\.edu\.br$/.test(studentEmail)) {
      return response(origin, 400, { error: "Use seu e-mail institucional @estudante.ifms.edu.br." });
    }

    const isMinor = bool(input.is_minor);
    const isPaid = bool(input.is_paid);
    const requiresEpi = bool(input.requires_epi);
    const payload = {
      request_type: text(input.request_type, 10),
      student_name: text(input.student_name, 180),
      student_cpf: text(input.student_cpf, 14),
      student_sex: text(input.student_sex, 20),
      student_birth_date: text(input.student_birth_date, 10),
      student_email: studentEmail,
      student_course: text(input.student_course, 180),
      student_period: text(input.student_period, 80),
      student_phone: text(input.student_phone, 30),
      is_minor: isMinor,
      guardian_name: isMinor ? text(input.guardian_name, 180) : null,
      guardian_email: isMinor ? text(input.guardian_email, 254) : null,
      guardian_cpf: isMinor ? text(input.guardian_cpf, 14) : null,
      guardian_phone: isMinor ? text(input.guardian_phone, 30) : null,
      company_name: text(input.company_name, 180),
      company_cnpj: text(input.company_cnpj, 18),
      company_email: text(input.company_email, 254),
      company_phone: text(input.company_phone, 30),
      internship_modality: text(input.internship_modality, 30),
      advisor_name: text(input.advisor_name, 180),
      is_paid: isPaid,
      scholarship_amount: isPaid ? Number(input.scholarship_amount) : null,
      weekly_schedule: text(input.weekly_schedule, 1500),
      start_date: text(input.start_date, 10),
      expected_end_date: text(input.expected_end_date, 10),
      internship_sector: text(input.internship_sector, 180),
      activity_plan: text(input.activity_plan, 6000),
      supervisor_name: text(input.supervisor_name, 180),
      supervisor_email: text(input.supervisor_email, 254),
      supervisor_education: text(input.supervisor_education, 80),
      supervisor_experience: text(input.supervisor_experience, 1000),
      requires_epi: requiresEpi,
      epi_types: requiresEpi ? text(input.epi_types, 1000) : "Não se aplica",
      privacy_consent: bool(input.privacy_consent),
      acknowledgment_start: bool(input.acknowledgment_start),
      acknowledgment_reports: bool(input.acknowledgment_reports),
      acknowledgment_changes: bool(input.acknowledgment_changes),
    };

    const required = [
      "request_type", "student_name", "student_cpf", "student_sex", "student_birth_date",
      "student_course", "student_period", "student_phone", "company_name", "company_cnpj",
      "company_email", "company_phone", "internship_modality", "advisor_name", "weekly_schedule",
      "start_date", "expected_end_date", "internship_sector", "activity_plan", "supervisor_name",
      "supervisor_email", "supervisor_education", "supervisor_experience", "epi_types",
    ] as const;
    if (required.some((field) => !payload[field])) return response(origin, 400, { error: "Preencha todos os campos obrigatórios." });
    if (payload.activity_plan.length < 50) return response(origin, 400, { error: "O plano de atividades deve ter pelo menos 50 caracteres." });
    if (isMinor && (!payload.guardian_name || !payload.guardian_email || !payload.guardian_cpf || !payload.guardian_phone)) {
      return response(origin, 400, { error: "Preencha os dados do responsável legal." });
    }
    if (!payload.privacy_consent || !payload.acknowledgment_start || !payload.acknowledgment_reports || !payload.acknowledgment_changes) {
      return response(origin, 400, { error: "Confirme todas as declarações antes do envio." });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data, error } = await supabase.from("tce_requests").insert(payload).select("id").single();
    if (error) throw error;
    return response(origin, 201, { id: data.id });
  } catch (error) {
    console.error(error);
    return response(origin, 500, { error: "Não foi possível registrar a solicitação. Tente novamente mais tarde." });
  }
} };
