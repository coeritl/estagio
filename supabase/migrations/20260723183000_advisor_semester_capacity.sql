-- Limite semestral de cinco orientações por docente.
alter table public.internship_advisors add column if not exists max_selections integer not null default 5 check (max_selections > 0);
update public.internship_advisors set max_selections=5;
create table if not exists public.advisor_assignments(id uuid primary key default gen_random_uuid(),advisor_id uuid not null references public.internship_advisors(id) on delete cascade,protocol text unique,semester_year integer not null,semester_half smallint not null check(semester_half in(1,2)),created_at timestamptz not null default now());
create index if not exists advisor_assignments_semester_idx on public.advisor_assignments(advisor_id,semester_year,semester_half);
alter table public.advisor_assignments enable row level security;
revoke all on table public.advisor_assignments from anon;
grant select,insert,update,delete on table public.advisor_assignments to authenticated;
drop policy if exists "Administradores consultam reservas de orientação" on public.advisor_assignments;
create policy "Administradores consultam reservas de orientação" on public.advisor_assignments for select to authenticated using(public.is_coeri_admin());
drop policy if exists "Administradores cadastram reservas de orientação" on public.advisor_assignments;
create policy "Administradores cadastram reservas de orientação" on public.advisor_assignments for insert to authenticated with check(public.is_coeri_admin());
drop policy if exists "Administradores atualizam reservas de orientação" on public.advisor_assignments;
create policy "Administradores atualizam reservas de orientação" on public.advisor_assignments for update to authenticated using(public.is_coeri_admin()) with check(public.is_coeri_admin());
drop policy if exists "Administradores excluem reservas de orientação" on public.advisor_assignments;
create policy "Administradores excluem reservas de orientação" on public.advisor_assignments for delete to authenticated using(public.is_coeri_admin());

create or replace function public.get_advisor_availability(p_start_date date default current_date)
returns table(id uuid,name text,areas text,display_order integer,max_selections integer,current_selections bigint,remaining_selections bigint,available boolean)
language sql stable security definer set search_path=public as $$
select a.id,a.name,a.areas,a.display_order,a.max_selections,count(s.id),greatest(a.max_selections-count(s.id),0),count(s.id)<a.max_selections
from public.internship_advisors a left join public.advisor_assignments s on s.advisor_id=a.id and s.semester_year=extract(year from coalesce(p_start_date,current_date))::integer and s.semester_half=case when extract(month from coalesce(p_start_date,current_date))<=6 then 1 else 2 end
where a.is_active=true group by a.id,a.name,a.areas,a.display_order,a.max_selections order by a.display_order,a.name;$$;
revoke all on function public.get_advisor_availability(date) from public;
grant execute on function public.get_advisor_availability(date) to anon,authenticated;

create or replace function public.reserve_advisor_slot(p_advisor_name text,p_protocol text,p_start_date date)
returns void language plpgsql security definer set search_path=public as $$
declare selected_advisor public.internship_advisors%rowtype;selected_year integer:=extract(year from p_start_date)::integer;selected_half smallint:=case when extract(month from p_start_date)<=6 then 1 else 2 end;occupied integer;
begin
if auth.role()<>'service_role' and not public.is_coeri_admin() then raise exception 'Acesso não autorizado';end if;
if exists(select 1 from public.advisor_assignments where protocol=p_protocol) then return;end if;
select * into selected_advisor from public.internship_advisors where is_active=true and lower(trim(name))=lower(trim(p_advisor_name)) for update;
if not found then raise exception 'ADVISOR_NOT_AVAILABLE';end if;
select count(*) into occupied from public.advisor_assignments where advisor_id=selected_advisor.id and semester_year=selected_year and semester_half=selected_half;
if occupied>=selected_advisor.max_selections then raise exception 'ADVISOR_CAPACITY_REACHED';end if;
insert into public.advisor_assignments(advisor_id,protocol,semester_year,semester_half) values(selected_advisor.id,p_protocol,selected_year,selected_half);
end;$$;
revoke all on function public.reserve_advisor_slot(text,text,date) from public;
grant execute on function public.reserve_advisor_slot(text,text,date) to authenticated,service_role;

create or replace function public.release_advisor_slot(p_protocol text)
returns void language plpgsql security definer set search_path=public as $$
begin if auth.role()<>'service_role' and not public.is_coeri_admin() then raise exception 'Acesso não autorizado';end if;delete from public.advisor_assignments where protocol=p_protocol;end;$$;
revoke all on function public.release_advisor_slot(text) from public;
grant execute on function public.release_advisor_slot(text) to authenticated,service_role;

insert into public.advisor_assignments(advisor_id,protocol,semester_year,semester_half)
select a.id,r.public_protocol,extract(year from r.start_date)::integer,case when extract(month from r.start_date)<=6 then 1 else 2 end from public.tce_requests r join public.internship_advisors a on lower(trim(a.name))=lower(trim(r.advisor_name)) where r.public_protocol is not null and r.start_date is not null on conflict(protocol) do nothing;

create or replace function public.process_tce_request(p_request_id uuid,p_internship_number text,p_partial_report_date date,p_final_report_date date,p_insurance_provider text) returns uuid
language plpgsql security definer set search_path=public as $$
declare r public.tce_requests%rowtype;new_id uuid;begin
if not public.is_coeri_admin() then raise exception 'Acesso não autorizado';end if;select * into r from public.tce_requests where id=p_request_id for update;if not found then raise exception 'Solicitação não encontrada';end if;
insert into public.internships(internship_number,public_protocol,student_name,student_cpf,student_sex,student_birth_date,student_email,student_whatsapp,course,company_name,start_date,expected_end_date,advisor_name,partial_report_date,final_report_date,insurance_provider,notes)
values(nullif(trim(p_internship_number),''),r.public_protocol,r.student_name,r.student_cpf,r.student_sex,r.student_birth_date,r.student_email,r.student_phone,r.student_course,r.company_name,r.start_date,r.expected_end_date,r.advisor_name,p_partial_report_date,p_final_report_date,p_insurance_provider,'Solicitação de TCE processada em '||to_char(now(),'DD/MM/YYYY')||'. Modalidade: '||r.internship_modality||'.') returning id into new_id;
if r.public_protocol is not null then update public.tce_protocol_statuses set status='tce_gerado',public_note='TCE gerado e enviado para assinaturas. Confira o e-mail e o WhatsApp informados. O remetente será o Autentique.',updated_at=now() where protocol=r.public_protocol;end if;delete from public.tce_requests where id=p_request_id;return new_id;end;$$;
revoke all on function public.process_tce_request(uuid,text,date,date,text) from public;grant execute on function public.process_tce_request(uuid,text,date,date,text) to authenticated;

create or replace function public.complete_internship(p_internship_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare r public.internships%rowtype;begin if not public.is_coeri_admin() then raise exception 'Acesso não autorizado';end if;select * into r from public.internships where id=p_internship_id for update;if not found then raise exception 'Estágio não encontrado';end if;if r.public_protocol is not null then update public.advisor_assignments set protocol=null where protocol=r.public_protocol;delete from public.tce_protocol_statuses where protocol=r.public_protocol;end if;delete from public.internships where id=p_internship_id;end;$$;
revoke all on function public.complete_internship(uuid) from public;grant execute on function public.complete_internship(uuid) to authenticated;