create table if not exists public.internship_agreements (
  academic_agreement_id text primary key,
  description text not null,
  start_date date,
  end_date date,
  agreement_number text,
  external_institution text not null,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.internship_agreements enable row level security;
grant select on table public.internship_agreements to anon;
grant select, insert, update, delete on table public.internship_agreements to authenticated;
drop policy if exists "Consulta pública de convênios" on public.internship_agreements;
create policy "Consulta pública de convênios" on public.internship_agreements for select to anon, authenticated using (true);
drop policy if exists "Administradores cadastram convênios" on public.internship_agreements;
create policy "Administradores cadastram convênios" on public.internship_agreements for insert to authenticated with check (public.is_coeri_admin());
drop policy if exists "Administradores atualizam convênios" on public.internship_agreements;
create policy "Administradores atualizam convênios" on public.internship_agreements for update to authenticated using (public.is_coeri_admin()) with check (public.is_coeri_admin());
drop policy if exists "Administradores excluem convênios" on public.internship_agreements;
create policy "Administradores excluem convênios" on public.internship_agreements for delete to authenticated using (public.is_coeri_admin());