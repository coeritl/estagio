-- Oculta notificações antigas sem apagar a chave de idempotência usada pelos envios automáticos.
alter table public.email_notifications
  add column if not exists archived_at timestamptz;

create index if not exists email_notifications_visible_idx
  on public.email_notifications (created_at desc)
  where archived_at is null;

-- A limpeza anterior removeu registros já enviados. Reconstitui somente os avisos
-- de término dos estágios que continuam ativos e cuja data já foi atingida.
insert into public.email_notifications (
  event_type,
  reference_key,
  recipient_email,
  student_name,
  subject,
  template_data,
  status,
  attempts,
  provider_response,
  sent_at
)
select
  'previsao_termino',
  i.id::text,
  i.student_email,
  i.student_name,
  'A previsão de término do seu estágio foi atingida',
  jsonb_build_object(
    'internshipNumber', coalesce(i.internship_number, ''),
    'course', coalesce(i.course, ''),
    'expectedEndDate', i.expected_end_date,
    'expectedEndDateFormatted', to_char(i.expected_end_date, 'DD/MM/YYYY')
  ),
  'enviado',
  1,
  jsonb_build_object('restoredAfterCleanup', true),
  now()
from public.internships i
where i.status = 'em_andamento'
  and i.expected_end_date is not null
  and i.expected_end_date <= (now() at time zone 'America/Cuiaba')::date
  and nullif(trim(i.student_email), '') is not null
on conflict (event_type, reference_key) do nothing;

