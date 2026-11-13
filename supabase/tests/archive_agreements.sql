-- Teste transacional: nenhum registro de teste permanece no banco.
begin;
insert into public.internship_agreements(academic_agreement_id, description, external_institution)
values ('coeri-test-archive-1d0b90b3', 'Teste de exclusão', 'Instituição de teste');
insert into public.internship_agreement_contacts(academic_agreement_id, company_email)
values ('coeri-test-archive-1d0b90b3', 'teste@example.com');
update public.internship_agreements set deleted_at = now()
where academic_agreement_id = 'coeri-test-archive-1d0b90b3';
-- Mesmo upsert usado pelo robô, sem modificar os campos de exclusão.
insert into public.internship_agreements(academic_agreement_id, description, external_institution)
values ('coeri-test-archive-1d0b90b3', 'Atualizado pelo robô', 'Instituição de teste')
on conflict(academic_agreement_id) do update set description = excluded.description;
do $$ begin
  if not exists(select 1 from public.internship_agreements where academic_agreement_id = 'coeri-test-archive-1d0b90b3' and deleted_at is not null)
  then raise exception 'Falha: sincronização desfez a exclusão'; end if;
end $$;
set local role anon;
do $$ begin
  if exists(select 1 from public.internship_agreements where academic_agreement_id = 'coeri-test-archive-1d0b90b3')
  then raise exception 'Falha: convênio excluído continua público'; end if;
  if exists(select 1 from public.get_agreement_tce_contact('coeri-test-archive-1d0b90b3'))
  then raise exception 'Falha: contato de convênio excluído continua disponível'; end if;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin
    perform public.delete_internship_agreement('coeri-test-archive-1d0b90b3');
    raise exception 'Falha: exclusão permitida sem usuário COERI';
  exception when raise_exception then
    if sqlerrm <> 'Acesso não autorizado' then raise; end if;
  end;
end $$;
reset role;
rollback;
