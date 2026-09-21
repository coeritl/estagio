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

function normalized(value: unknown) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function courseCoordinator(course: unknown) {
  const value = normalized(course);
  if (value.includes("tecnico") && value.includes("informatica")) return "coinf.tl@ifms.edu.br";
  if (value.includes("eletrotecnica")) return "cocip.tl@ifms.edu.br";
  if (value.includes("engenharia") && value.includes("computacao")) return "coenc.tl@ifms.edu.br";
  if (value.includes("engenharia") && value.includes("controle") && value.includes("automacao")) return "cobau.tl@ifms.edu.br";
  if (value.includes("analise") && value.includes("desenvolvimento") && value.includes("sistemas")) return "cotad.tl@ifms.edu.br";
  if (value.includes("automacao industrial")) return "cotai.tl@ifms.edu.br";
  return "";
}

function fortnightKey(today: string) {
  const [year, month, day] = today.split("-").map(Number);
  return `${year}-${String(month).padStart(2, "0")}-${day <= 14 ? "01" : "02"}`;
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
      .select("id,student_name,student_email,internship_number,course,advisor_name,expected_end_date,partial_report_date,partial_report_received_at,partial_reminder_sent_at,internship_report_submissions(document_type,status)")
      .eq("status", "em_andamento")
      .order("expected_end_date", { ascending: true });
    if (error) throw error;

    const valid = (internships || []).filter((item: any) => String(item.student_email || "").includes("@"));
    const jobs = valid.flatMap((internship: any) => {
      const result = [];
      if (internship.expected_end_date && internship.expected_end_date <= today) result.push({ type: "previsao_termino", internship });
      if (internship.partial_report_date && internship.partial_report_date <= today && !internship.partial_report_received_at && !internship.partial_reminder_sent_at) result.push({ type: "relatorio_parcial", internship });
      return result;
    });
    if (input.dry_run) return json(200, { success: true, dryRun: true, today, count: jobs.length, jobs: jobs.map(job => ({ type: job.type, internship_id: job.internship.id })) });

    let sent = 0, failed = 0, duplicates = 0;
    for (const job of jobs) {
      const internship = job.internship;
      const isPartial = job.type === "relatorio_parcial";
      const { data: existing } = await service.from("email_notifications").select("*")
        .eq("event_type", job.type).eq("reference_key", internship.id).maybeSingle();
      let notification = existing;
      if (existing?.status === "enviado") {
        if (isPartial && !internship.partial_reminder_sent_at) await service.from("internships").update({ partial_reminder_sent_at: existing.sent_at || new Date().toISOString() }).eq("id", internship.id);
        duplicates++; continue;
      }
      if (!notification) {
        const { data, error: insertError } = await service.from("email_notifications").insert({
          event_type: job.type, reference_key: internship.id,
          recipient_email: internship.student_email, student_name: internship.student_name,
          subject: isPartial ? "Chegou o momento de entregar seu relatório parcial" : "A previsão de término do seu estágio foi atingida",
          template_data: {
            internshipNumber: internship.internship_number || "", course: internship.course || "",
            expectedEndDate: internship.expected_end_date || "",
            expectedEndDateFormatted: internship.expected_end_date ? formatDate(internship.expected_end_date) : "",
            partialReportDate: internship.partial_report_date || "",
            partialReportDateFormatted: internship.partial_report_date ? formatDate(internship.partial_report_date) : "",
          },
        }).select("*").single();
        if (insertError) { failed++; continue; }
        notification = data;
      }
      if (await dispatch(service, notification)) {
        sent++;
        if (isPartial) await service.from("internships").update({ partial_reminder_sent_at: new Date().toISOString() }).eq("id", internship.id);
      } else failed++;
    }
    const { data: advisors, error: advisorError } = await service.from("internship_advisors")
      .select("id,name,email").not("email", "is", null).eq("is_active", true);
    if (advisorError) throw advisorError;

    const advisorGroups = new Map<string, any>();
    for (const internship of internships || []) {
      const advisor = (advisors || []).find((item: any) => normalized(item.name) === normalized(internship.advisor_name));
      if (!advisor?.email || !String(advisor.email).includes("@")) continue;
      const submissions = internship.internship_report_submissions || [];
      const hasValid = (type: string) => submissions.some((item: any) => item.document_type === type && item.status !== "correcao_solicitada");
      const pending = [];
      if (internship.partial_report_date && internship.partial_report_date <= today && !hasValid("parcial")) pending.push("Relatório parcial");
      if (internship.expected_end_date && internship.expected_end_date <= today) {
        if (!hasValid("final")) pending.push("Relatório final");
        if (!hasValid("avaliacao_supervisor")) pending.push("Avaliação do estagiário pelo supervisor");
      }
      if (!pending.length) continue;
      const group = advisorGroups.get(advisor.id) || { advisor, students: [], coordinators: new Set<string>() };
      group.students.push({
        name: internship.student_name,
        internshipNumber: internship.internship_number || "",
        course: internship.course || "",
        partialReportDate: internship.partial_report_date ? formatDate(internship.partial_report_date) : "",
        expectedEndDate: internship.expected_end_date ? formatDate(internship.expected_end_date) : "",
        pending,
      });
      const coordinator = courseCoordinator(internship.course);
      if (coordinator) group.coordinators.add(coordinator);
      advisorGroups.set(advisor.id, group);
    }

    let advisorSent = 0, advisorFailed = 0, advisorDuplicates = 0;
    const period = fortnightKey(today);
    for (const group of advisorGroups.values()) {
      const referenceKey = `${group.advisor.id}:${period}`;
      const { data: existing } = await service.from("email_notifications").select("*")
        .eq("event_type", "orientador_pendencias").eq("reference_key", referenceKey).maybeSingle();
      let notification = existing;
      if (existing?.status === "enviado") { advisorDuplicates++; continue; }
      if (!notification) {
        const { data, error: insertError } = await service.from("email_notifications").insert({
          event_type: "orientador_pendencias", reference_key: referenceKey,
          recipient_email: group.advisor.email, student_name: group.advisor.name,
          subject: `Orientandos com documentos de estágio pendentes (${group.students.length})`,
          template_data: {
            advisorName: group.advisor.name,
            ccEmails: Array.from(group.coordinators),
            students: group.students,
            reportsUrl: "https://coeri.tl.ifms.edu.br/relatorios",
          },
        }).select("*").single();
        if (insertError) { advisorFailed++; continue; }
        notification = data;
      }
      if (await dispatch(service, notification)) advisorSent++; else advisorFailed++;
    }

    return json(200, {
      success: true, today, eligible: jobs.length, sent, failed, duplicates,
      advisor_notifications: { eligible: advisorGroups.size, sent: advisorSent, failed: advisorFailed, duplicates: advisorDuplicates },
    });
  } catch (error) {
    console.error(error);
    return json(500, { success: false, error: error instanceof Error ? error.message : "Falha inesperada." });
  }
});
