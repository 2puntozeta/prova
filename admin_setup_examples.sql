-- CREA DITTA
insert into public.companies (name, vat_number)
values ('Ristorante Demo', 'IT12345678901');

-- VEDI ID DITTE
select * from public.companies order by created_at desc;

-- METTI TE COME SUPERVISOR GLOBALE
update public.profiles
set global_role = 'supervisor'
where email = 'EMAIL_SUPERVISOR';

-- COLLEGA IL SUPERVISOR ALLA DITTA
insert into public.company_users (user_id, company_id, role)
select p.id, 'COMPANY_ID'::uuid, 'supervisor'
from public.profiles p
where p.email = 'EMAIL_SUPERVISOR'
on conflict (user_id, company_id) do nothing;

-- COLLEGA IL CLIENTE ALLA SUA DITTA
insert into public.company_users (user_id, company_id, role)
select p.id, 'COMPANY_ID'::uuid, 'owner'
from public.profiles p
where p.email = 'EMAIL_CLIENTE'
on conflict (user_id, company_id) do nothing;