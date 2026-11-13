begin;
alter table public.internship_agreements add column deleted_at timestamptz;
alter table public.internship_agreements add column deleted_by uuid;
-- Restritiva para permanecer válida mesmo se outras políticas de leitura forem adicionadas.
create policy "Convênios excluídos não são exibidos" on public.internship_agreements
  as restrictive for select to anon, authenticated using (deleted_at is null);

create function public.delete_internship_agreement(p_agreement_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_coeri_admin() then raise exception 'Acesso não autorizado'; end if;
  update public.internship_agreements
    set deleted_at = now(), deleted_by = auth.uid(), updated_at = now()
    where academic_agreement_id = p_agreement_id and deleted_at is null;
  if not found then raise exception 'Convênio não encontrado ou já excluído'; end if;
end;
$$;
revoke all on function public.delete_internship_agreement(text) from public;
grant execute on function public.delete_internship_agreement(text) to authenticated;

create or replace function public.get_agreement_tce_contact(p_agreement_id text)
returns table(company_email text, representative_name text, representative_role text)
language sql stable security definer set search_path = public as $$
  select c.company_email, c.representative_name, c.representative_role
  from public.internship_agreement_contacts c
  join public.internship_agreements a using (academic_agreement_id)
  where c.academic_agreement_id = p_agreement_id and a.deleted_at is null limit 1;
$$;
commit;
