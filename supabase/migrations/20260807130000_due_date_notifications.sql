alter table public.email_notifications
  drop constraint if exists email_notifications_event_type_check;

alter table public.email_notifications
  add constraint email_notifications_event_type_check
  check (event_type in ('tce_recebido','tce_gerado','estagio_concluido','previsao_termino'));
