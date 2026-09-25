-- Inclui a avaliação do supervisor no panorama das coordenações.
drop function if exists public.get_coordination_dashboard();
create function public.get_coordination_dashboard()
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
  final_delivered boolean,
  supervisor_evaluation_delivered boolean
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
    ),
    exists (
      select 1 from public.internship_report_submissions report
      where report.internship_id = internship.id and report.document_type = 'avaliacao_supervisor'
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
