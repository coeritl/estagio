alter table public.internship_report_submissions
  add column if not exists contact_email text;

update public.internship_report_submissions submission
set contact_email = internship.student_email
from public.internships internship
where internship.id = submission.internship_id
  and submission.contact_email is null
  and internship.student_email is not null;

alter table public.email_notifications
  drop constraint if exists email_notifications_event_type_check;

alter table public.email_notifications
  add constraint email_notifications_event_type_check
  check (event_type in (
    'tce_recebido',
    'tce_gerado',
    'estagio_concluido',
    'previsao_termino',
    'relatorio_parcial',
    'relatorios_recebidos',
    'relatorio_correcao'
  ));
