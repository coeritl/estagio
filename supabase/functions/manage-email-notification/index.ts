// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "https://coeri.tl.ifms.edu.br",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });

async function dispatch(service: any, notification: any) {
  const url = Deno.env.get("GOOGLE_APPS_SCRIPT_URL") || "";
  const secret = Deno.env.get("GOOGLE_APPS_SCRIPT_SECRET") || "";
  if (!url || !secret) {
    const error = "Google Apps Script ainda não configurado.";
    await service.from("email_notifications").update({ status: "falhou", error_message: error, attempts: notification.attempts + 1 }).eq("id", notification.id);
    return { sent: false, error };
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
        data: notification.template_data,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw new Error(result.error || `Google respondeu com HTTP ${response.status}.`);
    await service.from("email_notifications").update({
      status: "enviado", attempts: notification.attempts + 1, error_message: null,
      provider_response: result, sent_at: new Date().toISOString(),
    }).eq("id", notification.id);
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await service.from("email_notifications").update({ status: "falhou", error_message: message.slice(0, 1000), attempts: notification.attempts + 1 }).eq("id", notification.id);
    return { sent: false, error: message };
  }
}

async function createOrGet(service: any, values: any) {
  const { data: existing } = await service.from("email_notifications").select("*")
    .eq("event_type", values.event_type).eq("reference_key", values.reference_key).maybeSingle();
  if (existing) return existing;
  const { data, error } = await service.from("email_notifications").insert(values).select("*").single();
  if (error) throw error;
  return data;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return json(405, { error: "Método não permitido." });
  try {
    const authorization = request.headers.get("Authorization") || "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data: userData, error: userError } = await caller.auth.getUser();
    if (userError || !userData.user) return json(401, { error: "Sessão inválida." });
    const { data: isAdmin } = await caller.rpc("is_coeri_admin");
    if (!isAdmin) return json(403, { error: "Acesso não autorizado." });

    const input = await request.json();
    if (input.action === "retry") {
      const { data: notification, error } = await service.from("email_notifications").select("*").eq("id", input.notification_id).single();
      if (error) return json(404, { error: "Notificação não encontrada." });
      return json(200, await dispatch(service, notification));
    }

    if (input.action === "tce_generated") {
      const protocol = String(input.protocol || "").trim().toUpperCase();
      const { data: internship, error } = await service.from("internships")
        .select("student_name,student_email,public_protocol").eq("public_protocol", protocol).single();
      if (error) return json(404, { error: "Estágio processado não encontrado." });
      const notification = await createOrGet(service, {
        event_type: "tce_gerado", reference_key: protocol,
        recipient_email: internship.student_email, student_name: internship.student_name,
        subject: "Seu TCE foi gerado e enviado para assinatura",
        template_data: { protocol, documentUrl: String(input.document_url || "") },
      });
      return json(200, await dispatch(service, notification));
    }

    if (input.action === "complete_internship") {
      if (input.internship_id && !input.report_id) {
        const internshipId = String(input.internship_id);
        const { data: internship, error } = await service.from("internships")
          .select("id,student_name,student_email,internship_number,course")
          .eq("id", internshipId).single();
        if (error) return json(404, { error: "Estágio não encontrado." });

        let emailResult = { sent: false, error: "O estudante não possui e-mail cadastrado." };
        if (internship.student_email) {
          const notification = await createOrGet(service, {
            event_type: "estagio_concluido", reference_key: internshipId,
            recipient_email: internship.student_email, student_name: internship.student_name,
            subject: "Confirmação de finalização do estágio",
            template_data: { internshipNumber: internship.internship_number || "", course: internship.course || "" },
          });
          emailResult = await dispatch(service, notification);
        }

        const { error: completionError } = await caller.rpc("complete_internship", { p_internship_id: internshipId });
        if (completionError) return json(500, { error: "O e-mail foi processado, mas não foi possível concluir o estágio." });
        return json(200, { completed: true, ...emailResult });
      }

      const { data: report, error } = await service.from("internship_report_submissions")
        .select("id,document_type,internship_id,internships(student_name,student_email,internship_number,course)")
        .eq("id", input.report_id).single();
      if (error || report.document_type !== "avaliacao_supervisor") return json(404, { error: "Avaliação do supervisor não encontrada." });
      const student = report.internships;
      const notification = await createOrGet(service, {
        event_type: "estagio_concluido", reference_key: report.internship_id,
        recipient_email: student.student_email, student_name: student.student_name,
        subject: "Confirmação de finalização do estágio",
        template_data: { internshipNumber: student.internship_number || "", course: student.course || "" },
      });
      const emailResult = await dispatch(service, notification);
      const { data: storagePaths, error: completionError } = await caller.rpc("accept_supervisor_evaluation_and_complete", { p_report_id: report.id });
      if (completionError) return json(500, { error: "O e-mail foi processado, mas não foi possível concluir o estágio." });
      if (storagePaths?.length) await service.storage.from("internship-reports").remove(storagePaths);
      return json(200, { completed: true, ...emailResult });
    }
    return json(400, { error: "Ação inválida." });
  } catch (error) {
    console.error(error);
    return json(500, { error: error instanceof Error ? error.message : "Falha inesperada." });
  }
});
