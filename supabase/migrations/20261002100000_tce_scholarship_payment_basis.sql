alter table public.tce_requests
  add column if not exists scholarship_payment_basis text;

update public.tce_requests
set scholarship_payment_basis = 'mensal'
where is_paid = true and scholarship_payment_basis is null;

alter table public.tce_requests
  drop constraint if exists tce_requests_scholarship_payment_basis_check;

alter table public.tce_requests
  add constraint tce_requests_scholarship_payment_basis_check
  check (
    scholarship_payment_basis is null
    or scholarship_payment_basis in ('mensal', 'hora')
  );
