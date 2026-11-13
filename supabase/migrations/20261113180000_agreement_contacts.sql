create table public.internship_agreement_contacts (
  academic_agreement_id text primary key references public.internship_agreements(academic_agreement_id) on delete cascade,
  company_email text,
  representative_name text,
  representative_role text,
  synced_at timestamptz not null default now()
);
alter table public.internship_agreement_contacts enable row level security;
revoke all on public.internship_agreement_contacts from anon, authenticated;
grant select on public.internship_agreement_contacts to authenticated;
grant all on public.internship_agreement_contacts to service_role;
create policy "COERI consulta contatos de convênios" on public.internship_agreement_contacts
  for select to authenticated using (public.is_coeri_admin());
-- Consulta individual para preencher o TCE; a tabela não é pública.
create function public.get_agreement_tce_contact(p_agreement_id text)
returns table(company_email text, representative_name text, representative_role text)
language sql stable security definer set search_path = public as $$
  select c.company_email, c.representative_name, c.representative_role
  from public.internship_agreement_contacts c
  where c.academic_agreement_id = p_agreement_id limit 1;
$$;
revoke all on function public.get_agreement_tce_contact(text) from public;
grant execute on function public.get_agreement_tce_contact(text) to anon, authenticated;
alter table public.tce_requests add column company_representative_name text;
alter table public.tce_requests add column company_representative_role text;
