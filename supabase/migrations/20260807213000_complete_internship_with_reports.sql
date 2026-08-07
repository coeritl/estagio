create or replace function public.complete_internship_with_reports(p_internship_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  target_protocol text;
  storage_paths text[];
begin
  if not public.is_coeri_admin() then
    raise exception 'Acesso não autorizado';
  end if;

  select public_protocol into target_protocol
  from public.internships
  where id = p_internship_id
  for update;

  if not found then
    raise exception 'Estágio não encontrado';
  end if;

  select coalesce(array_agg(storage_path), array[]::text[])
    into storage_paths
  from public.internship_report_submissions
  where internship_id = p_internship_id;

  delete from public.internship_report_submissions
  where internship_id = p_internship_id;

  if target_protocol is not null then
    update public.advisor_assignments set protocol = null where protocol = target_protocol;
    delete from public.tce_protocol_statuses where protocol = target_protocol;
  end if;

  delete from public.internships where id = p_internship_id;
  return storage_paths;
end;
$$;

revoke all on function public.complete_internship_with_reports(uuid) from public;
grant execute on function public.complete_internship_with_reports(uuid) to authenticated;
