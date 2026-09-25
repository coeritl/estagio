// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
const emailValue = (value: unknown) => String(value || "").trim().toLowerCase();
const allowedCourses = new Set(["ads", "engenharia_computacao", "engenharia_controle_automacao", "tecnico_eletrotecnica", "tecnico_informatica", "tecnologia_automacao_industrial", "especializacao_docencia_epct", "tecnico_administracao"]);
const temporaryPassword = () => `Coeri@${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}!`;

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json(405, { error: "Método não permitido." });
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Sessão ausente." });
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await service.auth.getUser(token);
  if (authError || !authData.user) return json(401, { error: "Sessão inválida." });
  const { data: admin } = await service.from("admin_users").select("user_id").eq("user_id", authData.user.id).maybeSingle();
  if (!admin) return json(403, { error: "Acesso restrito à COERI." });

  try {
    const input = await request.json();
    const action = String(input.action || "list");
    if (action === "list") {
      const [{ data: access, error: accessError }, usersResult] = await Promise.all([
        service.from("course_coordination_access").select("*").order("coordination_name"),
        service.auth.admin.listUsers({ page: 1, perPage: 1000 })
      ]);
      if (accessError || usersResult.error) throw accessError || usersResult.error;
      const users = new Map(usersResult.data.users.map(user => [emailValue(user.email), user]));
      const grouped = new Map();
      for (const row of access || []) {
        const email = emailValue(row.email);
        const current = grouped.get(email) || { email, coordination_name: row.coordination_name, courses: [], is_active: false, must_change_password: false };
        current.courses.push(row.course_key);
        current.is_active ||= row.is_active;
        current.must_change_password ||= row.must_change_password;
        grouped.set(email, current);
      }
      return json(200, { users: [...grouped.values()].map(item => {
        const authUser = users.get(item.email);
        return { ...item, auth_exists: Boolean(authUser), auth_id: authUser?.id || null, last_sign_in_at: authUser?.last_sign_in_at || null, created_at: authUser?.created_at || null };
      }) });
    }

    const email = emailValue(input.email);
    if (!/^[^\s@]+@ifms\.edu\.br$/i.test(email)) return json(400, { error: "Informe um e-mail institucional @ifms.edu.br." });
    if (action === "save") {
      const name = String(input.coordination_name || "").trim().slice(0, 180);
      const courses = [...new Set((Array.isArray(input.courses) ? input.courses : []).filter(course => allowedCourses.has(course)))];
      if (!name || !courses.length) return json(400, { error: "Informe o nome da coordenação e ao menos um curso." });
      const { data: listed, error: listError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listError) throw listError;
      let authUser = listed.users.find(user => emailValue(user.email) === email);
      let password: string | null = null;
      if (!authUser) {
        password = temporaryPassword();
        const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
        if (created.error) throw created.error;
        authUser = created.data.user;
      }
      const existing = await service.from("course_coordination_access").select("course_key").eq("email", email);
      if (existing.error) throw existing.error;
      const remove = (existing.data || []).map(row => row.course_key).filter(course => !courses.includes(course));
      if (remove.length) {
        const removed = await service.from("course_coordination_access").delete().eq("email", email).in("course_key", remove);
        if (removed.error) throw removed.error;
      }
      const rows = courses.map(course_key => ({ email, coordination_name: name, course_key, is_active: input.is_active !== false, must_change_password: password ? true : Boolean(input.must_change_password) }));
      const saved = await service.from("course_coordination_access").upsert(rows, { onConflict: "email,course_key" });
      if (saved.error) throw saved.error;
      return json(200, { success: true, temporary_password: password });
    }
    if (action === "toggle") {
      const updated = await service.from("course_coordination_access").update({ is_active: Boolean(input.is_active) }).eq("email", email);
      if (updated.error) throw updated.error;
      return json(200, { success: true });
    }
    if (action === "reset_password") {
      const { data: listed, error: listError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listError) throw listError;
      const authUser = listed.users.find(user => emailValue(user.email) === email);
      if (!authUser) return json(404, { error: "O usuário ainda não existe no Authentication." });
      const password = temporaryPassword();
      const reset = await service.auth.admin.updateUserById(authUser.id, { password });
      if (reset.error) throw reset.error;
      const access = await service.from("course_coordination_access").update({ must_change_password: true, is_active: true }).eq("email", email);
      if (access.error) throw access.error;
      return json(200, { success: true, temporary_password: password });
    }
    return json(400, { error: "Ação inválida." });
  } catch (error) {
    console.error(error);
    return json(500, { error: error instanceof Error ? error.message : "Não foi possível administrar o usuário." });
  }
});
