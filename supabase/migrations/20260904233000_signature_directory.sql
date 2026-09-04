alter table public.internship_advisors
  add column if not exists email text;

create table if not exists public.coeri_signature_settings (
  id text primary key default 'default' check (id = 'default'),
  director_name text not null default '',
  director_email text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.coeri_signature_settings (id)
values ('default')
on conflict (id) do nothing;

alter table public.coeri_signature_settings enable row level security;
grant select, insert, update on table public.coeri_signature_settings to authenticated;

drop policy if exists "Administradores consultam configuracoes de assinatura" on public.coeri_signature_settings;
create policy "Administradores consultam configuracoes de assinatura" on public.coeri_signature_settings
  for select to authenticated using (public.is_coeri_admin());
drop policy if exists "Administradores cadastram configuracoes de assinatura" on public.coeri_signature_settings;
create policy "Administradores cadastram configuracoes de assinatura" on public.coeri_signature_settings
  for insert to authenticated with check (public.is_coeri_admin());
drop policy if exists "Administradores atualizam configuracoes de assinatura" on public.coeri_signature_settings;
create policy "Administradores atualizam configuracoes de assinatura" on public.coeri_signature_settings
  for update to authenticated using (public.is_coeri_admin()) with check (public.is_coeri_admin());

drop trigger if exists coeri_signature_settings_updated_at on public.coeri_signature_settings;
create trigger coeri_signature_settings_updated_at before update on public.coeri_signature_settings
  for each row execute function public.set_updated_at();
