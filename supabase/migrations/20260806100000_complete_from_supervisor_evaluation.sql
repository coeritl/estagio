create or replace function public.accept_supervisor_evaluation_and_complete(p_report_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  target_internship_id uuid;
  target_document_type text;
  target_protocol text;
  storage_paths text[];
begin
  if not public.is_coeri_admin() then
    raise exception 'Acesso não autorizado';
  end if;

  select internship_id, document_type
    into target_internship_id, target_document_type
  from public.internship_report_submissions
  where id = p_report_id
  for update;

  if target_internship_id is null then
    raise exception 'Documento não encontrado';
  end if;
  if target_document_type <> 'avaliacao_supervisor' then
    raise exception 'Somente a avaliação do supervisor pode concluir o estágio';
  end if;

  select public_protocol into target_protocol
  from public.internships
  where id = target_internship_id
  for update;

  if not found then
    raise exception 'Estágio não encontrado';
  end if;

  select coalesce(array_agg(storage_path), array[]::text[])
    into storage_paths
  from public.internship_report_submissions
  where internship_id = target_internship_id;

  update public.internship_report_submissions
  set status = 'aceito', reviewed_at = now()
  where id = p_report_id;

  delete from public.internship_report_submissions
  where internship_id = target_internship_id;

  if target_protocol is not null then
    delete from public.tce_protocol_statuses where protocol = target_protocol;
  end if;

  delete from public.internships where id = target_internship_id;
  return storage_paths;
end;
$$;

revoke all on function public.accept_supervisor_evaluation_and_complete(uuid) from public;
grant execute on function public.accept_supervisor_evaluation_and_complete(uuid) to authenticated;
