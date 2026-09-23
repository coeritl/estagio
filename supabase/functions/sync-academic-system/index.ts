// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8" },
});
const text = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);
const normalize = (value: unknown) => text(value, 500).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
const nullable = (value: unknown, max = 500) => text(value, max) || null;

function validSecret(request: Request) {
  const received = request.headers.get("x-academic-sync-secret") || "";
  const expected = Deno.env.get("ACADEMIC_SYNC_SECRET") || "";
  return expected.length >= 32 && received.length === expected.length && received === expected;
}

function academicFields(item: any) {
  return {
    academic_system_id: text(item.academic_system_id, 80),
    student_name: text(item.student_name, 180).toLocaleUpperCase("pt-BR"),
    course: text(item.course, 180),
    company_name: text(item.company_name, 300) || "NÃO INFORMADA NO SISTEMA ACADÊMICO",
    start_date: nullable(item.start_date, 10),
    expected_end_date: nullable(item.expected_end_date, 10),
    advisor_name: nullable(item.advisor_name, 180),
    internship_type: nullable(item.internship_type, 80),
    academic_workload: nullable(item.academic_workload, 40),
    academic_status: nullable(item.academic_status, 80),
    course_status: nullable(item.course_status, 120),
    academic_activity_status: nullable(item.academic_activity_status, 120),
    closure_date: nullable(item.closure_date, 10),
  };
}

function studentFields(student: any) {
  if (!student || typeof student !== "object") return {};
  const sex = text(student.student_sex, 20);
  return Object.fromEntries(Object.entries({
    student_cpf: nullable(student.student_cpf, 20),
    student_sex: ["Feminino", "Masculino", "Outro"].includes(sex) ? sex : null,
    student_birth_date: nullable(student.student_birth_date, 10),
    student_email: nullable(student.student_email, 254)?.toLowerCase() || null,
    student_whatsapp: nullable(student.student_whatsapp, 60),
    academic_enrollment: nullable(student.academic_enrollment, 80),
    academic_ra: nullable(student.academic_ra, 80),
  }).filter(([, value]) => value !== null));
}

Deno.serve(async request => {
  if (request.method !== "POST") return json(405, { error: "Método não permitido." });
  if (!validSecret(request)) return json(401, { error: "Sincronizador não autorizado." });
  try {
    const input = await request.json();
    const agreements = Array.isArray(input.agreements) ? input.agreements.slice(0, 1000) : [];
    const internships = Array.isArray(input.internships) ? input.internships.slice(0, 500) : [];
    const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const agreementPayload = [...new Map(agreements.map((item: any) => ({
      academic_agreement_id: text(item.academic_agreement_id, 80),
      description: text(item.description, 1000),
      start_date: nullable(item.start_date, 10),
      end_date: nullable(item.end_date, 10),
      agreement_number: nullable(item.agreement_number, 120),
      external_institution: text(item.external_institution, 500),
      imported_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })).filter((item: any) => item.academic_agreement_id && item.description && item.external_institution)
      .map((item: any) => [item.academic_agreement_id, item])).values()];
    if (agreementPayload.length) {
      const { error } = await service.from("internship_agreements").upsert(agreementPayload, { onConflict: "academic_agreement_id" });
      if (error) throw error;
    }

    const { data: current, error: currentError } = await service.from("internships").select("*").eq("status", "em_andamento");
    if (currentError) throw currentError;
    const summary = { agreements: agreementPayload.length, inserted: 0, updated: 0, unchanged: 0, review: [] as any[] };
    for (const item of internships) {
      const payload = { ...academicFields(item), ...studentFields(item.student) };
      if (!payload.academic_system_id || !payload.student_name || !payload.course) {
        summary.review.push({ id: payload.academic_system_id, student: payload.student_name, reason: "Dados acadêmicos obrigatórios ausentes" });
        continue;
      }
      let existing = current?.find(record => String(record.academic_system_id || "") === payload.academic_system_id);
      if (!existing) {
        const candidates = (current || []).filter(record => !record.academic_system_id && normalize(record.student_name) === normalize(payload.student_name));
        if (candidates.length === 1) existing = candidates[0];
        if (candidates.length > 1) {
          summary.review.push({ id: payload.academic_system_id, student: payload.student_name, reason: "Mais de um acompanhamento sem ID possui este nome" });
          continue;
        }
      }
      if (existing) {
        const changed = Object.entries(payload).some(([key, value]) => String(existing[key] ?? "") !== String(value ?? ""));
        if (!changed) { summary.unchanged++; continue; }
        const timestamps = {
          academic_imported_at: new Date().toISOString(),
          ...(item.student && typeof item.student === "object" ? { academic_student_imported_at: new Date().toISOString() } : {}),
        };
        const { error } = await service.from("internships").update({ ...payload, ...timestamps }).eq("id", existing.id);
        if (error) throw error;
        Object.assign(existing, payload, timestamps);
        summary.updated++;
      } else {
        const now = new Date().toISOString();
        const { data, error } = await service.from("internships").insert({
          ...payload,
          status: "em_andamento",
          academic_imported_at: now,
          ...(item.student && typeof item.student === "object" ? { academic_student_imported_at: now } : {}),
        }).select("*").single();
        if (error) throw error;
        current?.push(data);
        summary.inserted++;
      }
    }
    return json(200, summary);
  } catch (error) {
    console.error(error);
    return json(500, { error: error instanceof Error ? error.message : "Falha na sincronização acadêmica." });
  }
});
