alter table public.internship_report_submissions
  add column if not exists contact_whatsapp text;

alter table public.internship_report_submissions
  drop constraint if exists internship_report_submissions_contact_whatsapp_check;

alter table public.internship_report_submissions
  add constraint internship_report_submissions_contact_whatsapp_check
  check (
    contact_whatsapp is null
    or contact_whatsapp ~ '^\([0-9]{2}\) [0-9]{5}-[0-9]{4}$'
  );
