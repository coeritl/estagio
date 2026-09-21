create table if not exists public.autentique_documents (
  document_id text primary key,
  protocol text not null unique references public.tce_protocol_statuses(protocol) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.autentique_documents enable row level security;
revoke all on table public.autentique_documents from anon, authenticated;
