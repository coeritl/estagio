create table if not exists public.email_notifications (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('tce_recebido','tce_gerado','estagio_concluido')),
  reference_key text not null,
  recipient_email text not null,
  student_name text not null,
  subject text not null,
  template_data jsonb not null default '{}'::jsonb,
  status text not null default 'pendente' check (status in ('pendente','enviado','falhou')),
  attempts integer not null default 0,
  error_message text,
  provider_response jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_type, reference_key)
);

create index if not exists email_notifications_created_idx
  on public.email_notifications(created_at desc);
create index if not exists email_notifications_status_idx
  on public.email_notifications(status, created_at desc);

alter table public.email_notifications enable row level security;
revoke all on table public.email_notifications from anon;
grant select on table public.email_notifications to authenticated;

drop policy if exists "Administradores consultam notificações" on public.email_notifications;
create policy "Administradores consultam notificações"
  on public.email_notifications for select to authenticated
  using (public.is_coeri_admin());

drop trigger if exists email_notifications_updated_at on public.email_notifications;
create trigger email_notifications_updated_at
  before update on public.email_notifications
  for each row execute function public.set_updated_at();
