-- Portal somente leitura para as coordenações de curso.
create table if not exists public.course_coordination_access (
  email text not null,
  coordination_name text not null,
  course_key text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (email, course_key)
);

alter table public.course_coordination_access enable row level security;
revoke all on table public.course_coordination_access from anon, authenticated;
grant select, insert, update, delete on table public.course_coordination_access to authenticated;

drop policy if exists "COERI administra acessos das coordenacoes" on public.course_coordination_access;
create policy "COERI administra acessos das coordenacoes"
  on public.course_coordination_access for all to authenticated
  using (public.is_coeri_admin())
  with check (public.is_coeri_admin());

create or replace function public.coordination_course_key(value text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare normalized text := lower(coalesce(value, ''));
begin
  normalized := translate(normalized, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');
  if normalized like '%analise e desenvolvimento de sistemas%' then return 'ads'; end if;
  if normalized like '%engenharia de computacao%' then return 'engenharia_computacao'; end if;
  if normalized like '%engenharia de controle e automacao%' then return 'engenharia_controle_automacao'; end if;
  if normalized like '%eletrotecnica%' then return 'tecnico_eletrotecnica'; end if;
  if normalized like '%informatica%' then return 'tecnico_informatica'; end if;
  if normalized like '%automacao industrial%' then return 'tecnologia_automacao_industrial'; end if;
  if normalized like '%docencia%epct%' then return 'especializacao_docencia_epct'; end if;
  if normalized like '%administracao%' then return 'tecnico_administracao'; end if;
  return 'outro';
end;
$$;

revoke all on function public.coordination_course_key(text) from public;
grant execute on function public.coordination_course_key(text) to authenticated, service_role;

create or replace function public.is_course_coordinator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.course_coordination_access
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and is_active = true
  );
$$;

revoke all on function public.is_course_coordinator() from public;
grant execute on function public.is_course_coordinator() to authenticated;

create or replace function public.get_coordination_profile()
returns table(coordination_name text, email text, courses text[])
language sql
stable
security definer
set search_path = public
as $$
  select min(access.coordination_name), lower(access.email), array_agg(access.course_key order by access.course_key)
  from public.course_coordination_access access
  where lower(access.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and access.is_active = true
  group by lower(access.email);
$$;

revoke all on function public.get_coordination_profile() from public;
grant execute on function public.get_coordination_profile() to authenticated;

create or replace function public.get_coordination_dashboard()
returns table(
  internship_id uuid,
  student_name text,
  student_email text,
  course text,
  company_name text,
  advisor_name text,
  start_date date,
  expected_end_date date,
  partial_report_date date,
  final_report_date date,
  academic_status text,
  partial_delivered boolean,
  final_delivered boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    internship.id,
    internship.student_name,
    internship.student_email,
    internship.course,
    internship.company_name,
    internship.advisor_name,
    internship.start_date,
    internship.expected_end_date,
    internship.partial_report_date,
    internship.final_report_date,
    internship.academic_status,
    (internship.partial_report_received_at is not null or exists (
      select 1 from public.internship_report_submissions report
      where report.internship_id = internship.id and report.document_type = 'parcial'
    )),
    exists (
      select 1 from public.internship_report_submissions report
      where report.internship_id = internship.id and report.document_type = 'final'
    )
  from public.internships internship
  where internship.status = 'em_andamento'
    and exists (
      select 1 from public.course_coordination_access access
      where lower(access.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and access.is_active = true
        and access.course_key = public.coordination_course_key(internship.course)
    )
  order by internship.student_name;
$$;

revoke all on function public.get_coordination_dashboard() from public;
grant execute on function public.get_coordination_dashboard() to authenticated;

insert into public.course_coordination_access(email, coordination_name, course_key) values
  ('coinf.tl@ifms.edu.br', 'Coordenação de Informática', 'tecnico_informatica'),
  ('cocip.tl@ifms.edu.br', 'Coordenação de Eletrotécnica', 'tecnico_eletrotecnica'),
  ('coenc.tl@ifms.edu.br', 'Coordenação de Engenharia de Computação', 'engenharia_computacao'),
  ('cobau.tl@ifms.edu.br', 'Coordenação de Engenharia de Controle e Automação', 'engenharia_controle_automacao'),
  ('cotad.tl@ifms.edu.br', 'Coordenação de Análise e Desenvolvimento de Sistemas', 'ads'),
  ('cotai.tl@ifms.edu.br', 'Coordenação de Tecnologia em Automação Industrial', 'tecnologia_automacao_industrial')
on conflict (email, course_key) do update
set coordination_name = excluded.coordination_name, is_active = true;
