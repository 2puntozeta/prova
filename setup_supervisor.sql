
-- 1) REGISTRA PRIMA IL TUO ACCOUNT SUPERVISOR DALL'APP
-- 2) POI ESEGUI QUESTE QUERY

-- Imposta il tuo account come supervisor globale
update public.profiles
set global_role = 'supervisor'
where email = 'TUA_EMAIL_SUPERVISOR';

-- Imposta l'email supervisor centrale usata per il collegamento automatico
insert into public.app_config (id, supervisor_email)
values (true, 'TUA_EMAIL_SUPERVISOR')
on conflict (id) do update
set supervisor_email = excluded.supervisor_email,
    updated_at = now();

-- Controllo rapido
select * from public.app_config;
select id, email, global_role from public.profiles order by created_at desc;
