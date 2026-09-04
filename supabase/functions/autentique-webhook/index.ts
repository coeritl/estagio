// Recebe eventos do Autentique e sincroniza o status público do TCE.
// O endpoint não expõe dados pessoais: apenas localiza o protocolo e atualiza o registro.
// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-autentique-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers });

function findProtocol(value: unknown): string | null {
  const text = typeof value === "string" ? value.toUpperCase() : "";
  const match = text.match(/TCE-[A-F0-9]{4}(?:-[A-F0-9]{4}){3}/);
  return match?.[0] ?? null;
}

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach(item => collectStrings(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach(item => collectStrings(item, output));
  return output;
}

async function validSignature(rawBody: string, received: string, secret: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody)));
  const calculated = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  let difference = calculated.length ^ received.length;
  for (let index = 0; index < calculated.length; index += 1) {
    difference |= calculated.charCodeAt(index) ^ (received.charCodeAt(index) || 0);
  }
  return difference === 0;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return json(405, { error: "Método não permitido." });

  try {
    const configuredSecret = Deno.env.get("AUTENTIQUE_WEBHOOK_SECRET") || "";
    if (!configuredSecret) return json(503, { error: "Segredo do webhook ainda não configurado." });
    const rawBody = await request.text();
    const receivedSignature = request.headers.get("x-autentique-signature") || "";
    if (!(await validSignature(rawBody, receivedSignature, configuredSecret))) {
      return json(401, { error: "Assinatura do webhook inválida." });
    }
    const payload = JSON.parse(rawBody);
    const eventName = String(payload?.event?.type || payload?.type || "").toLowerCase();
    const protocol = findProtocol(collectStrings(payload).find(value => findProtocol(value)));
    if (!protocol) return json(202, { received: true, matched: false });

    const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const signedUrl = collectStrings(payload).find(value => /https?:\/\/.*(assinado|signed).*\.pdf/i.test(value)) || null;
    const finished = /finished|completed|complete|document\.finished/.test(eventName);
    const note = finished
      ? "Todas as assinaturas do TCE foram concluídas no Autentique."
      : `Atualização recebida do Autentique: ${eventName || "evento de assinatura"}.`;
    const update: Record<string, unknown> = { public_note: note };
    if (signedUrl) update.document_url = signedUrl;
    const { error } = await service.from("tce_protocol_statuses").update(update).eq("protocol", protocol);
    if (error) throw error;
    return json(200, { received: true, matched: true, protocol, finished });
  } catch (error) {
    console.error(error);
    return json(400, { error: "Payload de webhook inválido." });
  }
});
