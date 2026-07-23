-- Métricas administrativas seguras para a tela de manutenção.
create or replace function public.get_maintenance_metrics()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare
  db_bytes bigint;
  last_change timestamptz;
begin
  if not public.is_coeri_admin() then raise exception 'Acesso não autorizado'; end if;
  db_bytes:=pg_database_size(current_database());
  select max(value) into last_change from (values
    ((select max(updated_at) from public.internships)),
    ((select max(created_at) from public.tce_requests)),
    ((select max(updated_at) from public.tce_protocol_statuses)),
    ((select max(updated_at) from public.internship_agreements)),
    ((select max(updated_at) from public.internship_advisors)),
    ((select max(created_at) from public.advisor_assignments))
  ) as activity(value);
  return jsonb_build_object(
    'checked_at',now(),
    'database_bytes',db_bytes,
    'database_pretty',pg_size_pretty(db_bytes),
    'database_limit_bytes',524288000,
    'database_percent',round((db_bytes::numeric/524288000::numeric)*100,2),
    'last_change_at',last_change,
    'active_internships',(select count(*) from public.internships where status='em_andamento'),
    'new_tce_requests',(select count(*) from public.tce_requests),
    'protocol_statuses',(select count(*) from public.tce_protocol_statuses),
    'agreements',(select count(*) from public.internship_agreements),
    'advisors',(select count(*) from public.internship_advisors),
    'advisor_assignments',(select count(*) from public.advisor_assignments)
  );
end;$$;
revoke all on function public.get_maintenance_metrics() from public;
grant execute on function public.get_maintenance_metrics() to authenticated;