-- ============================================================
-- ECO HOGAR v2.2.4 - RECUPERAR ACCESO TRAS HARDENING v2.2.3
-- ============================================================
-- Este script SOLO elimina las políticas MFA restrictivas agregadas por
-- v2.2.3, que en este proyecto provocaron que household_members quedara
-- invisible aun con una sesión que ya reportaba AAL2.
--
-- NO borra hogares, usuarios, movimientos, cuentas, tarjetas, categorías,
-- presupuestos, archivos ni factores MFA.
--
-- Se mantienen:
--   * RLS de todas las tablas.
--   * Políticas is_household_member(...).
--   * Bucket receipts privado.
--   * MFA de Supabase y el control MFA de la aplicación/proxy.
--   * La limpieza de políticas duplicadas hecha por v2.2.3.
-- ============================================================

begin;

do $do$
declare
  r record;
begin
  for r in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      'eco_hogar_require_mfa_if_enrolled',
      r.table_name
    );
  end loop;
end
$do$;

drop policy if exists "eco_hogar_receipts_require_mfa_if_enrolled"
on storage.objects;

commit;

-- CONTROL: ambos conteos deben devolver 0.
select
  'public_mfa_restrictive_policies' as control,
  count(*)::bigint as cantidad
from pg_policies
where schemaname = 'public'
  and policyname = 'eco_hogar_require_mfa_if_enrolled'

union all

select
  'storage_mfa_restrictive_policies' as control,
  count(*)::bigint as cantidad
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname = 'eco_hogar_receipts_require_mfa_if_enrolled';
