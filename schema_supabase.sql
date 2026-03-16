
create extension if not exists pgcrypto;

create table if not exists public.app_config (
  id boolean primary key default true,
  supervisor_email text not null,
  updated_at timestamptz not null default now(),
  constraint single_row check (id = true)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text default '',
  phone text default '',
  global_role text not null default 'user' check (global_role in ('user','supervisor')),
  created_at timestamptz not null default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  vat_number text default '',
  phone text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.company_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','manager','staff','supervisor')),
  created_at timestamptz not null default now(),
  unique (user_id, company_id)
);

create table if not exists public.daily_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  data date not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (company_id, data)
);

create table if not exists public.cash_state (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('contanti','pos','allianz','postepay')),
  amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, kind)
);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  data date not null,
  cassa text not null check (cassa in ('contanti','pos','allianz','postepay')),
  tipo text not null check (tipo in ('entrata','uscita')),
  importo numeric(12,2) not null check (importo >= 0),
  descrizione text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  nome text not null,
  aliases text[] not null default '{}',
  sospeso_iniziale numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, nome)
);

create table if not exists public.supplier_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  data date not null,
  tipo text not null check (tipo in ('fattura','pagamento')),
  importo numeric(12,2) not null check (importo >= 0),
  nota text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  nome text not null,
  ruolo text default '',
  dovuto_mensile numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, nome)
);

create table if not exists public.employee_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  data date not null,
  tipo text not null check (tipo in ('pagamento','extra','acconto')),
  importo numeric(12,2) not null check (importo >= 0),
  nota text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  data date not null,
  nome text not null,
  adulti integer not null default 0,
  bambini integer not null default 0,
  tipo text not null check (tipo in ('ristorante','pizzeria','menu_fisso','giro_pizza','banchetto')),
  importo numeric(12,2) not null default 0,
  ora text default '',
  note text default '',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
declare
  _company_id uuid;
  _supervisor_id uuid;
  _company_name text;
  _vat text;
  _phone text;
  _supervisor_email text;
begin
  _company_name := coalesce(new.raw_user_meta_data->>'company_name', '');
  _vat := coalesce(new.raw_user_meta_data->>'vat_number', '');
  _phone := coalesce(new.raw_user_meta_data->>'phone', '');

  insert into public.profiles (id, email, phone)
  values (new.id, new.email, _phone)
  on conflict (id) do nothing;

  if _company_name <> '' then
    insert into public.companies (name, vat_number, phone)
    values (_company_name, _vat, _phone)
    returning id into _company_id;

    insert into public.company_users (user_id, company_id, role)
    values (new.id, _company_id, 'owner')
    on conflict (user_id, company_id) do nothing;

    select supervisor_email into _supervisor_email
    from public.app_config
    where id = true;

    if _supervisor_email is not null then
      select id into _supervisor_id
      from public.profiles
      where lower(email) = lower(_supervisor_email)
      limit 1;

      if _supervisor_id is not null then
        insert into public.company_users (user_id, company_id, role)
        values (_supervisor_id, _company_id, 'supervisor')
        on conflict (user_id, company_id) do nothing;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_member_of_company(_company_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.company_users cu
    where cu.company_id = _company_id
      and cu.user_id = auth.uid()
  );
$$;

create or replace function public.can_manage_company(_company_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.company_users cu
    where cu.company_id = _company_id
      and cu.user_id = auth.uid()
      and cu.role in ('owner','manager','supervisor')
  );
$$;

alter table public.app_config enable row level security;
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_users enable row level security;
alter table public.daily_records enable row level security;
alter table public.cash_state enable row level security;
alter table public.cash_movements enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_movements enable row level security;
alter table public.employees enable row level security;
alter table public.employee_movements enable row level security;
alter table public.bookings enable row level security;

drop policy if exists p_app_config_supervisor on public.app_config;
create policy p_app_config_supervisor on public.app_config
for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.global_role = 'supervisor')
);

drop policy if exists p_profiles_self on public.profiles;
create policy p_profiles_self on public.profiles
for select using (auth.uid() = id);

drop policy if exists p_companies_select on public.companies;
create policy p_companies_select on public.companies
for select using (public.is_member_of_company(id));

drop policy if exists p_company_users_select_self on public.company_users;
create policy p_company_users_select_self on public.company_users
for select using (user_id = auth.uid());

drop policy if exists p_daily_records_all on public.daily_records;
create policy p_daily_records_all on public.daily_records
for all using (public.is_member_of_company(company_id))
with check (public.can_manage_company(company_id));

drop policy if exists p_cash_state_all on public.cash_state;
create policy p_cash_state_all on public.cash_state
for all using (public.is_member_of_company(company_id))
with check (public.can_manage_company(company_id));

drop policy if exists p_cash_movements_all on public.cash_movements;
create policy p_cash_movements_all on public.cash_movements
for all using (public.is_member_of_company(company_id))
with check (public.can_manage_company(company_id));

drop policy if exists p_suppliers_all on public.suppliers;
create policy p_suppliers_all on public.suppliers
for all using (public.is_member_of_company(company_id))
with check (public.can_manage_company(company_id));

drop policy if exists p_supplier_movements_all on public.supplier_movements;
create policy p_supplier_movements_all on public.supplier_movements
for all using (public.is_member_of_company(company_id))
with check (public.can_manage_company(company_id));

drop policy if exists p_employees_all on public.employees;
create policy p_employees_all on public.employees
for all using (public.is_member_of_company(company_id))
with check (public.can_manage_company(company_id));

drop policy if exists p_employee_movements_all on public.employee_movements;
create policy p_employee_movements_all on public.employee_movements
for all using (public.is_member_of_company(company_id))
with check (public.can_manage_company(company_id));

drop policy if exists p_bookings_all on public.bookings;
create policy p_bookings_all on public.bookings
for all using (public.is_member_of_company(company_id))
with check (public.can_manage_company(company_id));
