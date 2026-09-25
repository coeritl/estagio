alter table public.course_coordination_access
  add column if not exists must_change_password boolean not null default true;

drop function if exists public.get_coordination_profile();
create function public.get_coordination_profile()
returns table(coordination_name text, email text, courses text[], must_change_password boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    min(access.coordination_name),
    lower(access.email),
    array_agg(access.course_key order by access.course_key),
    bool_or(access.must_change_password)
  from public.course_coordination_access access
  where lower(access.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and access.is_active = true
  group by lower(access.email);
$$;

revoke all on function public.get_coordination_profile() from public;
grant execute on function public.get_coordination_profile() to authenticated;

create or replace function public.confirm_coordination_password_change()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.course_coordination_access
  set must_change_password = false
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and is_active = true;
  if not found then raise exception 'Coordenação não autorizada'; end if;
end;
$$;

revoke all on function public.confirm_coordination_password_change() from public;
grant execute on function public.confirm_coordination_password_change() to authenticated;
