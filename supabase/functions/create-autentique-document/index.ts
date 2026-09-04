// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "https://coeri.tl.ifms.edu.br", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json; charset=utf-8" };
const answer = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: cors });
const protocolPattern = /^TCE-[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const positions = {
  concedente: [{ x: "12.0", y: "24.0", z: 7, element: "SIGNATURE" }], coeri: [{ x: "53.0", y: "24.0", z: 7, element: "SIGNATURE" }],
  estudante: [{ x: "12.0", y: "44.0", z: 7, element: "SIGNATURE" }], responsavel: [{ x: "53.0", y: "44.0", z: 7, element: "SIGNATURE" }],
  orientador: [{ x: "12.0", y: "66.0", z: 7, element: "SIGNATURE" }], supervisor: [{ x: "53.0", y: "66.0", z: 7, element: "SIGNATURE" }],
};

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return answer(405, { error: "Método não permitido." });
  try {
    const authorization = request.headers.get("Authorization") || "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData.user) return answer(401, { error: "Sessão inválida." });
    const { data: isAdmin } = await caller.rpc("is_coeri_admin");
    if (!isAdmin) return answer(403, { error: "Acesso não autorizado." });
    const form = await request.formData();
    const file = form.get("file");
    const requestId = String(form.get("request_id") || "");
    const protocol = String(form.get("protocol") || "").trim().toUpperCase();
    const sandbox = String(form.get("sandbox")) !== "false";
    let rawSigners: Array<{ role: string; name: string; email: string }> = [];
    try { rawSigners = JSON.parse(String(form.get("signers") || "[]")); } catch { return answer(400, { error: "Lista de signatários inválida." }); }
    if (!(file instanceof File) || file.type !== "application/pdf" || file.size < 5 || file.size > 10 * 1024 * 1024) return answer(400, { error: "Selecione um PDF válido de até 10 MB." });
    if (!protocolPattern.test(protocol)) return answer(400, { error: "Protocolo inválido." });
    if (new TextDecoder().decode(new Uint8Array(await file.slice(0, 5).arrayBuffer())) !== "%PDF-") return answer(400, { error: "O arquivo selecionado não é um PDF válido." });
    const { data: tce } = await service.from("tce_requests").select("id,public_protocol,student_email").eq("id", requestId).maybeSingle();
    if (!tce || tce.public_protocol !== protocol) return answer(404, { error: "Solicitação de TCE não encontrada." });
    const requiredRoles = new Set(["concedente", "coeri", "estudante", "orientador", "supervisor"]);
    const merged = new Map<string, any>();
    for (const item of rawSigners) {
      const role = String(item.role || "").toLowerCase(); const name = String(item.name || "").trim(); const email = String(item.email || "").trim().toLowerCase();
      if (!positions[role]) continue;
      if (!name || !emailPattern.test(email)) return answer(400, { error: `Confira nome e e-mail do signatário: ${role}.` });
      requiredRoles.delete(role);
      const current = merged.get(email) || { email, action: "SIGN", positions: [], name };
      current.positions.push(...positions[role]); merged.set(email, current);
    }
    if (requiredRoles.size) return answer(400, { error: `Faltam signatários: ${Array.from(requiredRoles).join(", ")}.` });
    const token = Deno.env.get("AUTENTIQUE_API_TOKEN") || "";
    if (!token) return answer(503, { error: "Token do Autentique não configurado." });
    const query = `mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) { createDocument(sandbox: ${sandbox ? "true" : "false"}, document: $document, signers: $signers, file: $file) { id name sandbox signatures { public_id name email link { short_link } } } }`;
    const apiForm = new FormData();
    apiForm.append("operations", JSON.stringify({ query, variables: { document: { name: `${protocol} - Termo de Compromisso de Estágio` }, signers: Array.from(merged.values()), file: null } }));
    apiForm.append("map", JSON.stringify({ file: ["variables.file"] })); apiForm.append("file", file, `${protocol}.pdf`);
    const response = await fetch("https://api.autentique.com.br/v2/graphql", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: apiForm });
    const result = await response.json().catch(() => ({})); const document = result?.data?.createDocument;
    if (!response.ok || result?.errors?.length || !document?.id) { console.error("Autentique", response.status, result?.errors || result); return answer(502, { error: result?.errors?.[0]?.message || "O Autentique não conseguiu criar o documento." }); }
    const studentSignature = document.signatures?.find((signature: any) => String(signature.email || "").toLowerCase() === String(tce.student_email || "").toLowerCase());
    const studentLink = studentSignature?.link?.short_link || null;
    const { error: statusError } = await service.from("tce_protocol_statuses").update({ status: "tce_gerado", public_note: sandbox ? "TCE criado no ambiente de testes do Autentique." : "TCE gerado e encaminhado para assinaturas. Confira seu e-mail.", document_url: studentLink }).eq("protocol", protocol);
    if (statusError) throw statusError;
    return answer(200, { success: true, sandbox, document_id: document.id, student_link: studentLink, signatures: document.signatures?.map((signature: any) => ({ name: signature.name, email: signature.email, link: signature.link?.short_link || null })) || [] });
  } catch (error) { console.error(error); return answer(500, { error: "Não foi possível enviar o TCE ao Autentique." }); }
});
