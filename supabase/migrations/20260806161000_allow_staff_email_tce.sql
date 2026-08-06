alter table public.tce_requests
  drop constraint if exists tce_requests_student_email_check;

alter table public.tce_requests
  add constraint tce_requests_student_email_check check (
    position('@' in student_email) > 1
    and split_part(lower(trim(student_email)), '@', 2)
      in ('estudante.ifms.edu.br', 'ifms.edu.br')
  );
