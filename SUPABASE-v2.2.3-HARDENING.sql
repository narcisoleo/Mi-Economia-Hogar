-- ============================================================
-- ECO HOGAR v2.2.3 - HARDENING DE BASE + MFA EN RLS
-- ============================================================
-- Objetivos:
-- 1) Limpiar políticas duplicadas conocidas de versiones anteriores.
-- 2) Endurecer SECURITY DEFINER conocido con search_path vacío.
-- 3) Exigir AAL2 en la base A LOS USUARIOS QUE YA ACTIVARON MFA.
--    Un usuario que todavía no activó MFA puede seguir usando AAL1.
--    Cuando active un factor verificado, esta misma política le exigirá AAL2
--    automáticamente, sin volver a ejecutar este script.
-- 4) Aplicar la misma protección al bucket privado receipts.
--
-- IMPORTANTE: este script NO borra movimientos, cuentas, tarjetas ni archivos.
-- Es idempotente: puede ejecutarse nuevamente sin duplicar políticas.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- A. LIMPIEZA DE POLÍTICAS DUPLICADAS CONOCIDAS
-- Conservamos las políticas más actuales/completeas.
-- ------------------------------------------------------------

-- ACCOUNTS: conservar eco_hogar_*_v163 (incluye DELETE).
drop policy if exists "household_members_create_accounts" on public.accounts;
drop policy if exists "household_members_update_accounts" on public.accounts;
drop policy if exists "household_members_view_accounts" on public.accounts;

-- CREDIT_CARDS: conservar eco_hogar_*_v204.
drop policy if exists "eco_hogar_credit_cards_delete_v163" on public.credit_cards;
drop policy if exists "eco_hogar_credit_cards_insert_v163" on public.credit_cards;
drop policy if exists "eco_hogar_credit_cards_select_v163" on public.credit_cards;
drop policy if exists "eco_hogar_credit_cards_update_v163" on public.credit_cards;

drop policy if exists "household_members_delete_credit_cards" on public.credit_cards;
drop policy if exists "household_members_insert_credit_cards" on public.credit_cards;
drop policy if exists "household_members_update_credit_cards" on public.credit_cards;
drop policy if exists "household_members_view_credit_cards" on public.credit_cards;

-- ------------------------------------------------------------
-- B. SECURITY DEFINER
-- Esta función usa public.accounts de forma explícita, por lo que puede usar
-- search_path vacío sin romper la validación del trigger.
-- ------------------------------------------------------------
alter function public.validate_credit_card_account_type() set search_path = '';

-- is_household_member necesita ser invocable por usuarios autenticados,
-- pero no por anon/PUBLIC.
revoke all on function public.is_household_member(uuid) from public;
revoke all on function public.is_household_member(uuid) from anon;
grant execute on function public.is_household_member(uuid) to authenticated;

-- Las funciones trigger no necesitan exposición directa a clientes.
revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;

revoke all on function public.validate_credit_card_account_type() from public;
revoke all on function public.validate_credit_card_account_type() from anon;
revoke all on function public.validate_credit_card_account_type() from authenticated;

-- ------------------------------------------------------------
-- C. MFA A NIVEL BASE DE DATOS
-- Patrón oficial de Supabase: si el usuario tiene un factor MFA verificado,
-- únicamente se acepta JWT AAL2. Si aún no tiene factor, AAL1 o AAL2 pasan.
-- AS RESTRICTIVE hace que esta condición se combine con las políticas RLS
-- existentes del hogar mediante AND.
-- ------------------------------------------------------------
do $do$
declare
  r record;
  policy_name constant text := 'eco_hogar_require_mfa_if_enrolled';
  expr constant text := $expr$
    array[(select auth.jwt()->>'aal')] <@ (
      select case
        when count(id) > 0 then array['aal2']
        else array['aal1','aal2']
      end
      from auth.mfa_factors
      where (select auth.uid()) = user_id
        and status = 'verified'
    )
  $expr$;
begin
  for r in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity = true
  loop
    execute format('drop policy if exists %I on public.%I', policy_name, r.table_name);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (%s) with check (%s)',
      policy_name,
      r.table_name,
      expr,
      expr
    );
  end loop;
end
$do$;

-- ------------------------------------------------------------
-- D. MFA PARA COMPROBANTES PRIVADOS
-- Solo afecta al bucket receipts. Otros buckets futuros no quedan bloqueados
-- accidentalmente por esta política.
-- ------------------------------------------------------------
drop policy if exists "eco_hogar_receipts_require_mfa_if_enrolled" on storage.objects;

create policy "eco_hogar_receipts_require_mfa_if_enrolled"
on storage.objects
as restrictive
for all
to authenticated
using (
  bucket_id <> 'receipts'
  or (
    array[(select auth.jwt()->>'aal')] <@ (
      select case
        when count(id) > 0 then array['aal2']
        else array['aal1','aal2']
      end
      from auth.mfa_factors
      where (select auth.uid()) = user_id
        and status = 'verified'
    )
  )
)
with check (
  bucket_id <> 'receipts'
  or (
    array[(select auth.jwt()->>'aal')] <@ (
      select case
        when count(id) > 0 then array['aal2']
        else array['aal1','aal2']
      end
      from auth.mfa_factors
      where (select auth.uid()) = user_id
        and status = 'verified'
    )
  )
);

commit;

-- ------------------------------------------------------------
-- E. CONTROL POST-HARDENING
-- ------------------------------------------------------------
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  count(p.policyname) filter (where p.policyname = 'eco_hogar_require_mfa_if_enrolled') as mfa_policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p
  on p.schemaname = n.nspname
 and p.tablename = c.relname
where n.nspname = 'public'
  and c.relkind = 'r'
group by n.nspname, c.relname, c.relrowsecurity
order by c.relname;
