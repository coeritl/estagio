insert into public.course_coordination_access(email, coordination_name, course_key, is_active, must_change_password)
values ('muriel.teixeira@ifms.edu.br', 'Coordenação de teste · ADS', 'ads', true, true)
on conflict (email, course_key) do update
set coordination_name = excluded.coordination_name,
    is_active = true,
    must_change_password = true;
