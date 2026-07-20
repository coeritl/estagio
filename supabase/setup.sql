-- Execute este arquivo no SQL Editor do NOVO projeto Supabase da COERI.
-- Depois, crie o usuário administrativo em Authentication > Users e execute
-- apenas a instrução INSERT indicada no final deste arquivo.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.internships (
  id uuid primary key default gen_random_uuid(),
  internship_number text not null unique,
  student_name text not null,
  student_email text not null,
  student_whatsapp text not null,
  course text not null,
  company_name text not null,
  status text not null default 'em_andamento' check (status in ('em_andamento', 'concluido')),
  expected_end_date date not null,
  partial_report_date date not null,
  final_report_date date not null,
  insurance_provider text not null check (insurance_provider in ('IFMS', 'Empresa concedente')),
  notes text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
alter table public.internships enable row level security;

create or replace function public.is_coeri_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

revoke all on function public.is_coeri_admin() from public;
grant execute on function public.is_coeri_admin() to authenticated;

drop policy if exists "Administradores consultam estágios" on public.internships;
create policy "Administradores consultam estágios" on public.internships for select to authenticated using (public.is_coeri_admin());
drop policy if exists "Administradores cadastram estágios" on public.internships;
create policy "Administradores cadastram estágios" on public.internships for insert to authenticated with check (public.is_coeri_admin());
drop policy if exists "Administradores atualizam estágios" on public.internships;
create policy "Administradores atualizam estágios" on public.internships for update to authenticated using (public.is_coeri_admin()) with check (public.is_coeri_admin());
drop policy if exists "Administradores excluem estágios" on public.internships;
create policy "Administradores excluem estágios" on public.internships for delete to authenticated using (public.is_coeri_admin());

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists internships_updated_at on public.internships;
create trigger internships_updated_at before update on public.internships for each row execute function public.set_updated_at();

-- Após criar o login da COERI em Authentication > Users, execute:
-- insert into public.admin_users (user_id)
-- select id from auth.users where email = 'coeri.tl@ifms.edu.br';
