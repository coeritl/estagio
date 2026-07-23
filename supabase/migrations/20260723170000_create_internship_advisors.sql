-- Cadastro dinâmico de professores orientadores.
create table if not exists public.internship_advisors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  areas text not null,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.internship_advisors enable row level security;
grant select on table public.internship_advisors to anon, authenticated;
grant insert, update, delete on table public.internship_advisors to authenticated;

drop policy if exists "Consulta pública de orientadores ativos" on public.internship_advisors;
create policy "Consulta pública de orientadores ativos" on public.internship_advisors
  for select to anon using (is_active = true);
drop policy if exists "Administradores consultam orientadores" on public.internship_advisors;
create policy "Administradores consultam orientadores" on public.internship_advisors
  for select to authenticated using (public.is_coeri_admin());
drop policy if exists "Administradores cadastram orientadores" on public.internship_advisors;
create policy "Administradores cadastram orientadores" on public.internship_advisors
  for insert to authenticated with check (public.is_coeri_admin());
drop policy if exists "Administradores atualizam orientadores" on public.internship_advisors;
create policy "Administradores atualizam orientadores" on public.internship_advisors
  for update to authenticated using (public.is_coeri_admin()) with check (public.is_coeri_admin());
drop policy if exists "Administradores excluem orientadores" on public.internship_advisors;
create policy "Administradores excluem orientadores" on public.internship_advisors
  for delete to authenticated using (public.is_coeri_admin());

drop trigger if exists internship_advisors_updated_at on public.internship_advisors;
create trigger internship_advisors_updated_at before update on public.internship_advisors
  for each row execute function public.set_updated_at();

insert into public.internship_advisors (name, areas, display_order)
select seed.name, seed.areas, seed.display_order
from (values
  ('Alex Fernando Araújo','Informática · TADS · Engenharia da Computação',10),
  ('Ápio Carniello e Silva','Informática · TADS · Engenharia da Computação',20),
  ('Jose Roberto Campos','Análise e Desenvolvimento de Sistemas',30),
  ('Maraísa da Silva Guerra Asseiss','Informática · TADS · Engenharia da Computação',40),
  ('Marco Aurelio Ferreira','Informática · TADS · Engenharia da Computação',50),
  ('Leonardo Castelli Rister','Eletrotécnica · TAI · Eng. Controle e Automação',60),
  ('Diogo Ramalho de Oliveira','Eletrotécnica · TAI · Eng. Controle e Automação',70),
  ('Fernando Honório da Silva','Eletrotécnica · TAI · Eng. Controle e Automação',80),
  ('Marcus Felipe Calori Jorgetto','Engenharia de Controle e Automação',90),
  ('Kader Carvalho Assad','Técnico em Administração',100)
) as seed(name,areas,display_order)
where not exists (select 1 from public.internship_advisors);