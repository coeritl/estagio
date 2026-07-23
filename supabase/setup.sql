-- Execute este arquivo no SQL Editor do NOVO projeto Supabase da COERI.
-- Depois, crie o usuário administrativo em Authentication > Users e execute
-- apenas a instrução INSERT indicada no final deste arquivo.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.internships (
  id uuid primary key default gen_random_uuid(),
  internship_number text unique,
  public_protocol text unique,
  student_name text not null,
  student_cpf text,
  student_sex text check (student_sex in ('Feminino', 'Masculino', 'Outro')),
  student_birth_date date,
  student_email text,
  student_whatsapp text,
  course text not null,
  company_name text not null,
  status text not null default 'em_andamento' check (status in ('em_andamento', 'concluido')),
  expected_end_date date,
  partial_report_date date,
  final_report_date date,
  partial_reminder_sent_at timestamptz,
  final_reminder_sent_at timestamptz,
  insurance_provider text check (insurance_provider in ('IFMS', 'Empresa concedente')),
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tce_requests (
  id uuid primary key default gen_random_uuid(),
  public_protocol text unique,
  request_type text not null check (request_type in ('externo', 'interno')),
  student_name text not null,
  student_cpf text not null,
  student_sex text not null check (student_sex in ('Feminino', 'Masculino', 'Outro')),
  student_birth_date date not null,
  student_email text not null check (
    position('@' in student_email) > 1
    and split_part(lower(trim(student_email)), '@', 2) = 'estudante.ifms.edu.br'
  ),
  student_course text not null,
  student_period text not null,
  student_phone text not null,
  is_minor boolean not null default false,
  guardian_name text,
  guardian_email text,
  guardian_cpf text,
  guardian_phone text,
  company_name text not null,
  company_cnpj text not null,
  company_email text not null,
  company_phone text not null,
  internship_modality text not null check (internship_modality in ('Obrigatório', 'Não obrigatório')),
  advisor_name text not null,
  is_paid boolean not null default false,
  scholarship_amount numeric(10,2),
  weekly_schedule text not null,
  start_date date not null,
  expected_end_date date not null,
  internship_sector text not null,
  activity_plan text not null check (char_length(activity_plan) >= 50),
  supervisor_name text not null,
  supervisor_email text not null,
  supervisor_phone text not null,
  supervisor_education text not null,
  supervisor_experience text not null,
  requires_epi boolean not null,
  epi_types text not null,
  privacy_consent boolean not null check (privacy_consent is true),
  acknowledgment_start boolean not null check (acknowledgment_start is true),
  acknowledgment_reports boolean not null check (acknowledgment_reports is true),
  acknowledgment_changes boolean not null check (acknowledgment_changes is true),
  status text not null default 'novo' check (status in ('novo', 'em_analise')),
  created_at timestamptz not null default now()
);

create table if not exists public.tce_protocol_statuses (
  protocol text primary key,
  status text not null default 'recebido' check (status in ('recebido', 'em_processamento', 'tce_gerado', 'pendente_correcao', 'tce_negado')),
  public_note text,
  document_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.internships add column if not exists partial_reminder_sent_at timestamptz;
alter table public.internships add column if not exists final_reminder_sent_at timestamptz;
alter table public.internships add column if not exists public_protocol text unique;
alter table public.internships add column if not exists academic_system_id text unique;
alter table public.internships add column if not exists start_date date;
alter table public.internships add column if not exists advisor_name text;
alter table public.internships add column if not exists internship_type text;
alter table public.internships add column if not exists academic_workload text;
alter table public.internships add column if not exists academic_status text;
alter table public.internships add column if not exists course_status text;
alter table public.internships add column if not exists academic_activity_status text;
alter table public.internships add column if not exists closure_date date;
alter table public.internships add column if not exists academic_imported_at timestamptz;
alter table public.internships add column if not exists academic_enrollment text;
alter table public.internships add column if not exists academic_ra text;
alter table public.internships add column if not exists academic_student_imported_at timestamptz;
alter table public.tce_requests add column if not exists supervisor_phone text;
alter table public.tce_requests add column if not exists public_protocol text unique;
alter table public.tce_requests add column if not exists other_benefits text;
alter table public.tce_protocol_statuses add column if not exists document_url text;
alter table public.tce_protocol_statuses drop constraint if exists tce_protocol_statuses_status_check;
alter table public.tce_protocol_statuses add constraint tce_protocol_statuses_status_check check (status in ('recebido', 'em_processamento', 'tce_gerado', 'pendente_correcao', 'tce_negado'));

alter table public.admin_users enable row level security;
alter table public.internships enable row level security;
alter table public.tce_requests enable row level security;
alter table public.tce_protocol_statuses enable row level security;

revoke all on table public.tce_requests from anon;
grant select, update, delete on table public.tce_requests to authenticated;
revoke all on table public.tce_protocol_statuses from anon;
grant select, insert, update, delete on table public.tce_protocol_statuses to authenticated;

create or replace function public.is_coeri_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

revoke all on function public.is_coeri_admin() from public;
grant execute on function public.is_coeri_admin() to authenticated;

drop policy if exists coeri_admin_select on public.internships;
drop policy if exists coeri_admin_insert on public.internships;
drop policy if exists coeri_admin_update on public.internships;
drop policy if exists coeri_admin_delete on public.internships;
drop policy if exists "Administradores consultam estágios" on public.internships;
create policy "Administradores consultam estágios" on public.internships for select to authenticated using (public.is_coeri_admin());
drop policy if exists "Administradores cadastram estágios" on public.internships;
create policy "Administradores cadastram estágios" on public.internships for insert to authenticated with check (public.is_coeri_admin());
drop policy if exists "Administradores atualizam estágios" on public.internships;
create policy "Administradores atualizam estágios" on public.internships for update to authenticated using (public.is_coeri_admin()) with check (public.is_coeri_admin());
drop policy if exists "Administradores excluem estágios" on public.internships;
create policy "Administradores excluem estágios" on public.internships for delete to authenticated using (public.is_coeri_admin());

-- Não há política pública de INSERT. O formulário envia os dados exclusivamente
-- pela Edge Function submit-tce, que valida o CAPTCHA e usa a service role.
-- Assim, visitantes não conseguem consultar nem gravar diretamente nesta tabela.
drop policy if exists "Estudantes enviam solicitações de TCE" on public.tce_requests;
drop policy if exists "Administradores consultam solicitações de TCE" on public.tce_requests;
create policy "Administradores consultam solicitações de TCE" on public.tce_requests for select to authenticated using (public.is_coeri_admin());
drop policy if exists "Administradores atualizam solicitações de TCE" on public.tce_requests;
create policy "Administradores atualizam solicitações de TCE" on public.tce_requests for update to authenticated using (public.is_coeri_admin()) with check (public.is_coeri_admin());
drop policy if exists "Administradores excluem solicitações de TCE" on public.tce_requests;
create policy "Administradores excluem solicitações de TCE" on public.tce_requests for delete to authenticated using (public.is_coeri_admin());

drop policy if exists "Administradores consultam status de TCE" on public.tce_protocol_statuses;
create policy "Administradores consultam status de TCE" on public.tce_protocol_statuses for select to authenticated using (public.is_coeri_admin());
drop policy if exists "Administradores cadastram status de TCE" on public.tce_protocol_statuses;
create policy "Administradores cadastram status de TCE" on public.tce_protocol_statuses for insert to authenticated with check (public.is_coeri_admin());
drop policy if exists "Administradores atualizam status de TCE" on public.tce_protocol_statuses;
create policy "Administradores atualizam status de TCE" on public.tce_protocol_statuses for update to authenticated using (public.is_coeri_admin()) with check (public.is_coeri_admin());
drop policy if exists "Administradores excluem status de TCE" on public.tce_protocol_statuses;
create policy "Administradores excluem status de TCE" on public.tce_protocol_statuses for delete to authenticated using (public.is_coeri_admin());


create table if not exists public.internship_agreements (
  academic_agreement_id text primary key,
  description text not null,
  start_date date,
  end_date date,
  agreement_number text,
  external_institution text not null,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.internship_agreements enable row level security;
grant select on table public.internship_agreements to anon;
grant select, insert, update, delete on table public.internship_agreements to authenticated;
drop policy if exists "Consulta pública de convênios" on public.internship_agreements;
create policy "Consulta pública de convênios" on public.internship_agreements for select to anon, authenticated using (true);
drop policy if exists "Administradores cadastram convênios" on public.internship_agreements;
create policy "Administradores cadastram convênios" on public.internship_agreements for insert to authenticated with check (public.is_coeri_admin());
drop policy if exists "Administradores atualizam convênios" on public.internship_agreements;
create policy "Administradores atualizam convênios" on public.internship_agreements for update to authenticated using (public.is_coeri_admin()) with check (public.is_coeri_admin());
drop policy if exists "Administradores excluem convênios" on public.internship_agreements;
create policy "Administradores excluem convênios" on public.internship_agreements for delete to authenticated using (public.is_coeri_admin());create or replace function public.process_tce_request(
  p_request_id uuid,
  p_internship_number text,
  p_partial_report_date date,
  p_final_report_date date,
  p_insurance_provider text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.tce_requests%rowtype;
  new_id uuid;
begin
  if not public.is_coeri_admin() then raise exception 'Acesso não autorizado'; end if;
  select * into r from public.tce_requests where id = p_request_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  insert into public.internships (
    internship_number, public_protocol, student_name, student_cpf, student_sex, student_birth_date,
    student_email, student_whatsapp, course, company_name, expected_end_date,
    partial_report_date, final_report_date, insurance_provider, notes
  ) values (
    nullif(trim(p_internship_number), ''), r.public_protocol, r.student_name, r.student_cpf, r.student_sex, r.student_birth_date,
    r.student_email, r.student_phone, r.student_course, r.company_name, r.expected_end_date,
    p_partial_report_date, p_final_report_date, p_insurance_provider,
    'Solicitação de TCE processada em ' || to_char(now(), 'DD/MM/YYYY') || '. Modalidade: ' || r.internship_modality || '.'
  ) returning id into new_id;
  if r.public_protocol is not null then
    update public.tce_protocol_statuses
    set status = 'tce_gerado',
        public_note = 'TCE gerado e enviado para assinaturas. Confira o e-mail e o WhatsApp informados. O remetente será o Autentique.',
        updated_at = now()
    where protocol = r.public_protocol;
  end if;
  delete from public.tce_requests where id = p_request_id;
  return new_id;
end;
$$;

revoke all on function public.process_tce_request(uuid,text,date,date,text) from public;
grant execute on function public.process_tce_request(uuid,text,date,date,text) to authenticated;

create or replace function public.complete_internship(p_internship_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.internships%rowtype;
begin
  if not public.is_coeri_admin() then raise exception 'Acesso não autorizado'; end if;
  select * into r from public.internships where id = p_internship_id for update;
  if not found then raise exception 'Estágio não encontrado'; end if;
  if r.public_protocol is not null then
    delete from public.tce_protocol_statuses where protocol = r.public_protocol;
  end if;
  delete from public.internships where id = p_internship_id;
end;
$$;

revoke all on function public.complete_internship(uuid) from public;
grant execute on function public.complete_internship(uuid) to authenticated;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists internships_updated_at on public.internships;
create trigger internships_updated_at before update on public.internships for each row execute function public.set_updated_at();

drop trigger if exists tce_protocol_statuses_updated_at on public.tce_protocol_statuses;
create trigger tce_protocol_statuses_updated_at before update on public.tce_protocol_statuses for each row execute function public.set_updated_at();

-- Após criar o login da COERI em Authentication > Users, execute:
-- insert into public.admin_users (user_id)
-- select id from auth.users where email = 'coeri.tl@ifms.edu.br';
