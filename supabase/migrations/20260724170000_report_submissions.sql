-- Recebimento privado de documentos de estágio.
create table if not exists public.internship_report_submissions (
  id uuid primary key default gen_random_uuid(),
  internship_id uuid not null references public.internships(id) on delete cascade,
  document_type text not null check (document_type in ('parcial','final','avaliacao_supervisor')),
  original_filename text not null,
  storage_path text not null unique,
  mime_type text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  student_class text not null,
  internship_period text not null,
  total_workload integer not null check (total_workload > 0 and total_workload <= 10000),
  status text not null default 'recebido' check (status in ('recebido','aceito','correcao_solicitada')),
  admin_note text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists internship_report_submissions_internship_idx
  on public.internship_report_submissions(internship_id, submitted_at desc);

alter table public.internship_report_submissions enable row level security;
revoke all on table public.internship_report_submissions from anon;
grant select, update, delete on table public.internship_report_submissions to authenticated;

drop policy if exists "Administradores consultam relatórios" on public.internship_report_submissions;
create policy "Administradores consultam relatórios" on public.internship_report_submissions
  for select to authenticated using (public.is_coeri_admin());
drop policy if exists "Administradores atualizam relatórios" on public.internship_report_submissions;
create policy "Administradores atualizam relatórios" on public.internship_report_submissions
  for update to authenticated using (public.is_coeri_admin()) with check (public.is_coeri_admin());
drop policy if exists "Administradores excluem relatórios" on public.internship_report_submissions;
create policy "Administradores excluem relatórios" on public.internship_report_submissions
  for delete to authenticated using (public.is_coeri_admin());

drop trigger if exists internship_report_submissions_updated_at on public.internship_report_submissions;
create trigger internship_report_submissions_updated_at
  before update on public.internship_report_submissions
  for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'internship-reports',
  'internship-reports',
  false,
  10485760,
  array['application/pdf']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Administradores baixam relatórios" on storage.objects;
create policy "Administradores baixam relatórios" on storage.objects
  for select to authenticated
  using (bucket_id = 'internship-reports' and public.is_coeri_admin());
drop policy if exists "Administradores excluem arquivos de relatórios" on storage.objects;
create policy "Administradores excluem arquivos de relatórios" on storage.objects
  for delete to authenticated
  using (bucket_id = 'internship-reports' and public.is_coeri_admin());

create or replace function public.delete_internship_report(p_report_id uuid)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  path text;
begin
  if not public.is_coeri_admin() then raise exception 'Acesso não autorizado'; end if;
  select storage_path into path
  from public.internship_report_submissions
  where id = p_report_id;
  if path is null then raise exception 'Documento não encontrado'; end if;
  delete from public.internship_report_submissions where id = p_report_id;
  return path;
end;
$$;
revoke all on function public.delete_internship_report(uuid) from public;
grant execute on function public.delete_internship_report(uuid) to authenticated;

