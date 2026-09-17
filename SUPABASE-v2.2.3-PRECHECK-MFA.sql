-- ECO HOGAR v2.2.3
-- PRECHECK MFA DEL HOGAR
-- SOLO LECTURA: no modifica datos ni configuraciones.
-- Ejecutar en Supabase > SQL Editor.

select
  h.name as hogar,
  u.email,
  hm.user_id,
  exists (
    select 1
    from auth.mfa_factors f
    where f.user_id = hm.user_id
      and f.status = 'verified'
  ) as mfa_verificado,
  coalesce((
    select count(*)
    from auth.mfa_factors f
    where f.user_id = hm.user_id
      and f.status = 'verified'
  ), 0) as factores_verificados
from public.household_members hm
join public.households h on h.id = hm.household_id
join auth.users u on u.id = hm.user_id
order by h.name, u.email;
