// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "https://coeri.tl.ifms.edu.br",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });
const reportTypeLabels: Record<string, string> = {
  parcial: "Relatório parcial",
  final: "Relatório final",
  avaliacao_supervisor: "Avaliação do estagiário pelo supervisor"
};

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
    if (input.action === "clear_sent") {
      const { error, count } = await service.from("email_notifications")
        .update({ archived_at: new Date().toISOString() }, { count: "exact" })
        .eq("status", "enviado").is("archived_at", null);
      if (error) return json(500, { error: "Não foi possível limpar as notificações enviadas." });
      return json(200, { cleared: true, archived: true, count: count || 0 });
    }
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

    if (input.action === "request_tce_correction") {
      const protocol = String(input.protocol || "").trim().toUpperCase();
      const correctionNote = String(input.correction_note || "").trim().slice(0, 2000);
      if (!protocol || correctionNote.length < 5) return json(400, { error: "Descreva o que deve ser corrigido." });
      const { data: tceRequest, error } = await service.from("tce_requests")
        .select("student_name,student_email,public_protocol")
        .eq("public_protocol", protocol).single();
      if (error) return json(404, { error: "Solicitação de TCE não encontrada." });
      const recipientEmail = String(tceRequest.student_email || "").trim().toLowerCase();
      if (!recipientEmail) return json(422, { error: "A solicitação não possui e-mail do estudante." });
      const { data: notification, error: notificationError } = await service.from("email_notifications").insert({
        event_type: "tce_correcao",
        reference_key: `${protocol}:${crypto.randomUUID()}`,
        recipient_email: recipientEmail,
        student_name: tceRequest.student_name || "Estudante",
        subject: "Correção necessária na solicitação do TCE",
        template_data: { protocol, correctionNote }
      }).select("*").single();
      if (notificationError) return json(500, { error: "Não foi possível preparar a notificação de correção do TCE." });
      return json(200, await dispatch(service, notification));
    }
    if (input.action === "request_report_correction") {
      const reportId = String(input.report_id || "");
      const correctionNote = String(input.correction_note || "").trim().slice(0, 2000);
      if (!reportId || correctionNote.length < 5) return json(400, { error: "Descreva o que deve ser corrigido." });
      const { data: report, error } = await service.from("internship_report_submissions")
        .select("id,document_type,contact_email,internship_id,internships(student_name,student_email,internship_number,course)")
        .eq("id", reportId).single();
      if (error) return json(404, { error: "Documento não encontrado." });
      const student = report.internships;
      const recipientEmail = String(report.contact_email || student?.student_email || "").trim().toLowerCase();
      if (!recipientEmail) return json(422, { error: "O documento não possui e-mail de contato." });
      const { data: notification, error: notificationError } = await service.from("email_notifications").insert({
        event_type: "relatorio_correcao",
        reference_key: `${report.id}:${crypto.randomUUID()}`,
        recipient_email: recipientEmail,
        student_name: student?.student_name || "Estudante",
        subject: "Correção necessária na documentação de estágio",
        template_data: {
          reportType: reportTypeLabels[report.document_type] || "Documento de estágio",
          correctionNote,
          internshipNumber: student?.internship_number || "",
          course: student?.course || ""
        }
      }).select("*").single();
      if (notificationError) return json(500, { error: "Não foi possível preparar a notificação de correção." });
      const { error: updateError } = await service.from("internship_report_submissions").update({
        status: "correcao_solicitada",
        admin_note: correctionNote,
        reviewed_at: new Date().toISOString()
      }).eq("id", report.id);
      if (updateError) {
        await service.from("email_notifications").delete().eq("id", notification.id);
        return json(500, { error: "Não foi possível registrar a solicitação de correção." });
      }
      return json(200, { updated: true, ...(await dispatch(service, notification)) });
    }

    if (input.action === "complete_internship") {
      if (input.internship_id && !input.report_id) {
        const internshipId = String(input.internship_id);
        const { data: internship, error } = await service.from("internships")
          .select("id,student_name,student_email,internship_number,course")
          .eq("id", internshipId).single();
        if (error) return json(404, { error: "Estágio não encontrado." });

        const { data: storagePaths, error: completionError } = await caller.rpc("complete_internship_with_reports", { p_internship_id: internshipId });
        if (completionError) {
          console.error("manual-internship-completion-failed", { internshipId, error: completionError });
          return json(500, { error: `Não foi possível concluir o estágio: ${completionError.message || "erro no banco de dados"}. Nenhum e-mail de conclusão foi enviado.` });
        }

        let cleanupError = "";
        if (storagePaths?.length) {
          const { error: removalError } = await service.storage.from("internship-reports").remove(storagePaths);
          if (removalError) {
            cleanupError = removalError.message || "Não foi possível remover os arquivos do armazenamento.";
            console.error("manual-report-storage-cleanup-failed", { internshipId, storagePaths, error: cleanupError });
          }
        }

        let emailResult = { sent: false, error: "O estudante não possui e-mail cadastrado." };
        if (internship.student_email) {
          try {
            const notification = await createOrGet(service, {
              event_type: "estagio_concluido", reference_key: internshipId,
              recipient_email: internship.student_email, student_name: internship.student_name,
              subject: "Confirmação de finalização do estágio",
              template_data: { internshipNumber: internship.internship_number || "", course: internship.course || "" },
            });
            emailResult = await dispatch(service, notification);
          } catch (notificationError) {
            emailResult = { sent: false, error: notificationError instanceof Error ? notificationError.message : String(notificationError) };
          }
        }
        return json(200, { completed: true, cleanup_pending: Boolean(cleanupError), cleanup_error: cleanupError || null, ...emailResult });
      }

      const { data: report, error } = await service.from("internship_report_submissions")
        .select("id,document_type,contact_email,internship_id,internships(student_name,student_email,internship_number,course)")
        .eq("id", input.report_id).single();
      if (error || report.document_type !== "avaliacao_supervisor") return json(404, { error: "Avaliação do supervisor não encontrada." });
      const student = report.internships;
      const { data: storagePaths, error: completionError } = await caller.rpc("accept_supervisor_evaluation_and_complete", { p_report_id: report.id });
      if (completionError) return json(500, { error: "Não foi possível concluir o estágio. Nenhum e-mail de conclusão foi enviado." });

      let cleanupError = "";
      if (storagePaths?.length) {
        const { error: removalError } = await service.storage.from("internship-reports").remove(storagePaths);
        if (removalError) {
          cleanupError = removalError.message || "Não foi possível remover os arquivos do armazenamento.";
          console.error("report-storage-cleanup-failed", { internshipId: report.internship_id, storagePaths, error: cleanupError });
        }
      }

      let emailResult = { sent: false, error: "O estudante não possui e-mail cadastrado." };
      const completionEmail = String(report.contact_email || student.student_email || "").trim().toLowerCase();
      if (completionEmail) {
        try {
          const notification = await createOrGet(service, {
            event_type: "estagio_concluido", reference_key: report.internship_id,
            recipient_email: completionEmail, student_name: student.student_name,
            subject: "Confirmação de finalização do estágio",
            template_data: { internshipNumber: student.internship_number || "", course: student.course || "" },
          });
          emailResult = await dispatch(service, notification);
        } catch (notificationError) {
          emailResult = { sent: false, error: notificationError instanceof Error ? notificationError.message : String(notificationError) };
        }
      }
      return json(200, { completed: true, cleanup_pending: Boolean(cleanupError), cleanup_error: cleanupError || null, ...emailResult });
    }
    return json(400, { error: "Ação inválida." });
  } catch (error) {
    console.error(error);
    return json(500, { error: error instanceof Error ? error.message : "Falha inesperada." });
  }
});
