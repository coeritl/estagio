alter table public.internships
  add column if not exists partial_report_received_at timestamptz;

update public.internships i
set partial_report_received_at = source.first_submission
from (
  select internship_id, min(submitted_at) as first_submission
  from public.internship_report_submissions
  where document_type = 'parcial'
  group by internship_id
) source
where i.id = source.internship_id
  and i.partial_report_received_at is null;

alter table public.email_notifications
  drop constraint if exists email_notifications_event_type_check;

alter table public.email_notifications
  add constraint email_notifications_event_type_check
  check (event_type in ('tce_recebido','tce_gerado','estagio_concluido','previsao_termino','relatorio_parcial'));

