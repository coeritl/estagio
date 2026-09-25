-- Suspensão reversível do acompanhamento, sem concluir ou excluir o estágio.
alter table public.internships drop constraint if exists internships_status_check;
alter table public.internships
  add constraint internships_status_check check (status in ('em_andamento', 'suspenso', 'concluido'));

alter table public.internships add column if not exists suspended_at timestamptz;
alter table public.internships add column if not exists suspended_by_email text;
alter table public.internships add column if not exists suspension_reason text;
create index if not exists internships_status_idx on public.internships(status);

create or replace function public.set_internship_suspension(
  p_internship_id uuid,
  p_suspend boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.internships%rowtype;
  actor_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  authorized boolean := false;
begin
  select * into target from public.internships where id = p_internship_id for update;
  if not found then raise exception 'Estágio não encontrado'; end if;

  authorized := public.is_coeri_admin() or exists (
    select 1 from public.course_coordination_access access
    where lower(access.email) = actor_email
      and access.is_active = true
      and access.course_key = public.coordination_course_key(target.course)
  );
  if not authorized then raise exception 'Acesso não autorizado'; end if;

  if p_suspend then
    if target.status <> 'em_andamento' then raise exception 'Somente estágios em andamento podem ser suspensos'; end if;
    update public.internships
       set status = 'suspenso', suspended_at = now(), suspended_by_email = actor_email,
           suspension_reason = nullif(trim(coalesce(p_reason, '')), '')
     where id = p_internship_id;
  else
    if target.status <> 'suspenso' then raise exception 'Somente estágios suspensos podem ser reativados'; end if;
    update public.internships
       set status = 'em_andamento', suspended_at = null, suspended_by_email = null, suspension_reason = null
     where id = p_internship_id;
  end if;
end;
$$;
revoke all on function public.set_internship_suspension(uuid, boolean, text) from public;
grant execute on function public.set_internship_suspension(uuid, boolean, text) to authenticated;

drop function if exists public.get_coordination_dashboard();
create function public.get_coordination_dashboard()
returns table(
  internship_id uuid, student_name text, student_email text, course text, company_name text,
  advisor_name text, start_date date, expected_end_date date, partial_report_date date,
  final_report_date date, academic_status text, partial_delivered boolean,
  final_delivered boolean, supervisor_evaluation_delivered boolean, status text,
  suspended_at timestamptz, suspended_by_email text, suspension_reason text
)
language sql stable security definer set search_path = public
as $$
  select internship.id, internship.student_name, internship.student_email, internship.course,
    internship.company_name, internship.advisor_name, internship.start_date,
    internship.expected_end_date, internship.partial_report_date, internship.final_report_date,
    internship.academic_status,
    (internship.partial_report_received_at is not null or exists (
      select 1 from public.internship_report_submissions report
      where report.internship_id = internship.id and report.document_type = 'parcial')),
    exists (select 1 from public.internship_report_submissions report
      where report.internship_id = internship.id and report.document_type = 'final'),
    exists (select 1 from public.internship_report_submissions report
      where report.internship_id = internship.id and report.document_type = 'avaliacao_supervisor'),
    internship.status, internship.suspended_at, internship.suspended_by_email, internship.suspension_reason
  from public.internships internship
  where internship.status in ('em_andamento', 'suspenso')
    and exists (
      select 1 from public.course_coordination_access access
      where lower(access.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and access.is_active = true
        and access.course_key = public.coordination_course_key(internship.course))
  order by internship.student_name;
$$;
revoke all on function public.get_coordination_dashboard() from public;
grant execute on function public.get_coordination_dashboard() to authenticated;

-- A suspensão também libera a vaga contabilizada no limite semestral do orientador.
create or replace function public.get_advisor_availability(p_start_date date default current_date)
returns table(id uuid,name text,areas text,display_order integer,max_selections integer,current_selections bigint,remaining_selections bigint,available boolean)
language sql stable security definer set search_path=public as $$
with occupancy as (
  select a.id,
    (select count(*) from public.advisor_assignments s where s.advisor_id=a.id
      and s.semester_year=extract(year from coalesce(p_start_date,current_date))::integer
      and s.semester_half=case when extract(month from coalesce(p_start_date,current_date))<=6 then 1 else 2 end
      and not exists (select 1 from public.internships si where si.public_protocol=s.protocol and si.status='suspenso'))
    +(select count(*) from public.internships i where i.status='em_andamento'
      and lower(trim(i.advisor_name))=lower(trim(a.name)) and i.start_date is not null
      and extract(year from i.start_date)::integer=extract(year from coalesce(p_start_date,current_date))::integer
      and (case when extract(month from i.start_date)<=6 then 1 else 2 end)=case when extract(month from coalesce(p_start_date,current_date))<=6 then 1 else 2 end
      and not exists(select 1 from public.advisor_assignments s where s.protocol is not null and s.protocol=i.public_protocol)) as occupied
  from public.internship_advisors a where a.is_active=true)
select a.id,a.name,a.areas,a.display_order,a.max_selections,o.occupied,
  greatest(a.max_selections-o.occupied,0),o.occupied<a.max_selections
from public.internship_advisors a join occupancy o on o.id=a.id order by a.display_order,a.name;
$$;
revoke all on function public.get_advisor_availability(date) from public;
grant execute on function public.get_advisor_availability(date) to anon,authenticated;

create or replace function public.reserve_advisor_slot(p_advisor_name text,p_protocol text,p_start_date date)
returns void language plpgsql security definer set search_path=public as $$
declare selected_advisor public.internship_advisors%rowtype;
  selected_year integer:=extract(year from p_start_date)::integer;
  selected_half smallint:=case when extract(month from p_start_date)<=6 then 1 else 2 end;
  occupied integer;
begin
  if auth.role()<>'service_role' and not public.is_coeri_admin() then raise exception 'Acesso não autorizado'; end if;
  if exists(select 1 from public.advisor_assignments where protocol=p_protocol) then return; end if;
  select * into selected_advisor from public.internship_advisors
    where is_active=true and lower(trim(name))=lower(trim(p_advisor_name)) for update;
  if not found then raise exception 'ADVISOR_NOT_AVAILABLE'; end if;
  select
    (select count(*) from public.advisor_assignments s where s.advisor_id=selected_advisor.id
      and s.semester_year=selected_year and s.semester_half=selected_half
      and not exists(select 1 from public.internships si where si.public_protocol=s.protocol and si.status='suspenso'))
    +(select count(*) from public.internships i where i.status='em_andamento'
      and lower(trim(i.advisor_name))=lower(trim(selected_advisor.name)) and i.start_date is not null
      and extract(year from i.start_date)::integer=selected_year
      and (case when extract(month from i.start_date)<=6 then 1 else 2 end)=selected_half
      and not exists(select 1 from public.advisor_assignments s where s.protocol is not null and s.protocol=i.public_protocol))
  into occupied;
  if occupied>=selected_advisor.max_selections then raise exception 'ADVISOR_CAPACITY_REACHED'; end if;
  insert into public.advisor_assignments(advisor_id,protocol,semester_year,semester_half)
  values(selected_advisor.id,p_protocol,selected_year,selected_half);
end;
$$;
revoke all on function public.reserve_advisor_slot(text,text,date) from public;
grant execute on function public.reserve_advisor_slot(text,text,date) to authenticated,service_role;
