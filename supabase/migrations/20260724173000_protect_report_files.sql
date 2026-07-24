-- Impede que a conclusão do estágio deixe arquivos órfãos no Storage.
-- O coordenador deve baixar e apagar os documentos antes de remover o estágio.
alter table public.internship_report_submissions
  drop constraint if exists internship_report_submissions_internship_id_fkey;
alter table public.internship_report_submissions
  add constraint internship_report_submissions_internship_id_fkey
  foreign key (internship_id) references public.internships(id) on delete restrict;

