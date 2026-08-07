// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const headers = { "Content-Type": "application/json; charset=utf-8" };
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });

function cuiabaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Cuiaba", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

async function dispatch(service: any, notification: any) {
  const url = Deno.env.get("GOOGLE_APPS_SCRIPT_URL") || "";
  const secret = Deno.env.get("GOOGLE_APPS_SCRIPT_SECRET") || "";
  try {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret, notificationId: notification.id, type: notification.event_type,
        to: notification.recipient_email, subject: notification.subject,
        studentName: notification.student_name, data: notification.template_data,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw new Error(result.error || `Google respondeu com HTTP ${response.status}.`);
    await service.from("email_notifications").update({
      status: "enviado", attempts: notification.attempts + 1, error_message: null,
      provider_response: result, sent_at: new Date().toISOString(),
    }).eq("id", notification.id);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await service.from("email_notifications").update({
      status: "falhou", attempts: notification.attempts + 1, error_message: message.slice(0, 1000),
    }).eq("id", notification.id);
    return false;
  }
}

Deno.serve(async request => {
  if (request.method !== "POST") return json(405, { success: false, error: "Método não permitido." });
  try {
    const input = await request.json();
    const expected = Deno.env.get("GOOGLE_APPS_SCRIPT_SECRET") || "";
    if (!expected || input.secret !== expected) return json(401, { success: false, error: "Não autorizado." });

    const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const today = cuiabaDate();
    const { data: internships, error } = await service.from("internships")
      .select("id,student_name,student_email,internship_number,course,expected_end_date")
      .eq("status", "em_andamento").lte("expected_end_date", today)
      .not("student_email", "is", null).order("expected_end_date", { ascending: true });
    if (error) throw error;

    const eligible = (internships || []).filter((item: any) => String(item.student_email || "").includes("@"));
    if (input.dry_run) return json(200, { success: true, dryRun: true, today, count: eligible.length, internships: eligible });

    let sent = 0, failed = 0, duplicates = 0;
    for (const internship of eligible) {
      const { data: existing } = await service.from("email_notifications").select("*")
        .eq("event_type", "previsao_termino").eq("reference_key", internship.id).maybeSingle();
      let notification = existing;
      if (existing?.status === "enviado") { duplicates++; continue; }
      if (!notification) {
        const { data, error: insertError } = await service.from("email_notifications").insert({
          event_type: "previsao_termino", reference_key: internship.id,
          recipient_email: internship.student_email, student_name: internship.student_name,
          subject: "A previsão de término do seu estágio foi atingida",
          template_data: {
            internshipNumber: internship.internship_number || "", course: internship.course || "",
            expectedEndDate: internship.expected_end_date,
            expectedEndDateFormatted: formatDate(internship.expected_end_date),
          },
        }).select("*").single();
        if (insertError) { failed++; continue; }
        notification = data;
      }
      if (await dispatch(service, notification)) sent++; else failed++;
    }
    return json(200, { success: true, today, eligible: eligible.length, sent, failed, duplicates });
  } catch (error) {
    console.error(error);
    return json(500, { success: false, error: error instanceof Error ? error.message : "Falha inesperada." });
  }
});
