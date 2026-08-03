alter table public.tce_requests
  add column if not exists insurance_coverage_amount numeric(14,2);

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
      and insurance_coverage_amount > 0
    )
  );
