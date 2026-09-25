-- Permite identificar e auditar solicitações feitas por uma coordenação de curso.
alter table public.tce_requests
  add column if not exists submission_origin text not null default 'estudante',
  add column if not exists submitted_by_email text;

alter table public.internship_report_submissions
  add column if not exists submission_origin text not null default 'estudante',
  add column if not exists submitted_by_email text;

alter table public.tce_requests drop constraint if exists tce_requests_submission_origin_check;
alter table public.tce_requests add constraint tce_requests_submission_origin_check
  check (submission_origin in ('estudante', 'coordenacao'));

alter table public.internship_report_submissions drop constraint if exists internship_reports_submission_origin_check;
alter table public.internship_report_submissions add constraint internship_reports_submission_origin_check
  check (submission_origin in ('estudante', 'coordenacao'));

create or replace function public.get_coordination_recent_submissions()
returns table(
  item_type text,
  item_id uuid,
  student_name text,
  detail text,
  submitted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with current_email as (
    select lower(coalesce(auth.jwt() ->> 'email', '')) as email
  ), items as (
    select
      'tce'::text as item_type,
      request.id as item_id,
      request.student_name,
      coalesce(request.public_protocol, 'Protocolo não informado')::text as detail,
      request.created_at as submitted_at
    from public.tce_requests request, current_email
    where request.submission_origin = 'coordenacao'
      and lower(request.submitted_by_email) = current_email.email
    union all
    select
      'relatorio'::text,
      submission.id,
      internship.student_name,
      case submission.document_type
        when 'parcial' then 'Relatório parcial'
        when 'final' then 'Relatório final'
        when 'avaliacao_supervisor' then 'Avaliação do supervisor'
        else submission.document_type
      end,
      submission.submitted_at
    from public.internship_report_submissions submission
    join public.internships internship on internship.id = submission.internship_id
    cross join current_email
    where submission.submission_origin = 'coordenacao'
      and lower(submission.submitted_by_email) = current_email.email
  )
  select items.item_type, items.item_id, items.student_name, items.detail, items.submitted_at
  from items
  order by items.submitted_at desc
  limit 20;
$$;

revoke all on function public.get_coordination_recent_submissions() from public;
grant execute on function public.get_coordination_recent_submissions() to authenticated;
