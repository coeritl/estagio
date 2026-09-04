-- A lista pública é fornecida pela função get_advisor_availability,
-- que não retorna e-mails. O acesso direto completo fica restrito à COERI.
revoke select on table public.internship_advisors from anon;
grant select on table public.internship_advisors to authenticated;
