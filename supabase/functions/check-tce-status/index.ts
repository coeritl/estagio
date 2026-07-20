// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://coeritl.github.io", "http://localhost:5500", "http://127.0.0.1:5500"]);
const labels = {
  recebido: "Recebido pela COERI",
  em_processamento: "Em processamento pela COERI",
  tce_gerado: "TCE gerado e enviado para assinaturas",
  pendente_correcao: "Pendente de correção",
  tce_negado: "TCE negado — consulte a COERI",
};

function headers(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://coeritl.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

function answer(origin: string | null, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

export default { async fetch(request: Request) {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (request.method !== "POST") return answer(origin, 405, { error: "Método não permitido." });
  try {
    const { token, protocol } = await request.json();
    const normalized = String(protocol || "").trim().toUpperCase();
    if (!/^TCE-[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/.test(normalized)) return answer(origin, 400, { error: "Informe um protocolo válido." });

    const captchaForm = new FormData();
    captchaForm.append("secret", Deno.env.get("TURNSTILE_SECRET_KEY") ?? "");
    captchaForm.append("response", String(token || ""));
    const captchaResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: captchaForm });
    const captcha = await captchaResponse.json();
    if (!captcha.success) return answer(origin, 403, { error: "Não foi possível validar o CAPTCHA. Tente novamente." });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data, error } = await supabase.from("tce_protocol_statuses").select("status,public_note,document_url,updated_at").eq("protocol", normalized).maybeSingle();
    if (error) throw error;
    if (!data) return answer(origin, 404, { error: "Protocolo não encontrado. Confira os caracteres informados." });
    return answer(origin, 200, { status: data.status, label: labels[data.status], note: data.public_note, document_url: data.status === "tce_gerado" ? data.document_url : null, updated_at: data.updated_at });
  } catch (error) {
    console.error(error);
    return answer(origin, 500, { error: "Não foi possível consultar o protocolo agora." });
  }
} };
