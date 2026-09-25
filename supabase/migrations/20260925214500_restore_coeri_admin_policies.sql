-- Garante que a conta administrativa enxergue e administre todas as áreas do painel.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'internships', 'tce_requests', 'internship_report_submissions',
    'tce_protocol_statuses', 'internship_agreements', 'internship_advisors',
    'email_notifications', 'coeri_signature_settings', 'advisor_assignments'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'Acesso integral da COERI', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_coeri_admin()) with check (public.is_coeri_admin())',
      'Acesso integral da COERI', table_name
    );
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
  end loop;
end;
$$;
