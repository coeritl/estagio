alter table public.tce_requests
  add column if not exists insurance_provider text,
  add column if not exists insurance_company_name text,
  add column if not exists insurance_policy_number text;

alter table public.tce_requests
  drop constraint if exists tce_requests_insurance_provider_check;

alter table public.tce_requests
  add constraint tce_requests_insurance_provider_check
  check (
    insurance_provider is null
    or insurance_provider in ('IFMS', 'Empresa concedente')
  );

alter table public.tce_requests
  drop constraint if exists tce_requests_company_insurance_details;

alter table public.tce_requests
  add constraint tce_requests_company_insurance_details
  check (
    insurance_provider is null
    or insurance_provider <> 'Empresa concedente'
    or (
      nullif(trim(insurance_company_name), '') is not null
      and nullif(trim(insurance_policy_number), '') is not null
    )
  );
