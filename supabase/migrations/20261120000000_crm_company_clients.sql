-- A client can be just a company (a lead list of businesses): name becomes the contact person and is
-- optional, as long as the client has a name or a company.
alter table public.crm_clients alter column name drop not null;

alter table public.crm_clients drop constraint if exists crm_clients_name_check;
alter table public.crm_clients
  add constraint crm_clients_name_check check (name is null or length(name) between 1 and 200);

alter table public.crm_clients drop constraint if exists crm_clients_name_or_company;
alter table public.crm_clients
  add constraint crm_clients_name_or_company check (coalesce(name, company) is not null);

notify pgrst, 'reload schema';
