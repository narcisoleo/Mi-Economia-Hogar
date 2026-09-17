-- ============================================================
-- ECO HOGAR v2.2.3 - AUDITORÍA FINAL ANTES DE PUBLICAR
-- SOLO LECTURA. No modifica datos.
-- ============================================================

-- 1) VISTAS / MATERIALIZED VIEWS EN PUBLIC
select
  n.nspname as schema_name,
  c.relname as object_name,
  case c.relkind when 'v' then 'view' when 'm' then 'materialized_view' else c.relkind::text end as object_type,
  pg_get_userbyid(c.relowner) as owner,
  c.reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('v','m')
order by c.relname;

-- 2) GRANTS DE TABLAS A ANON / AUTHENTICATED
select
  table_schema,
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon','authenticated')
order by table_name, grantee, privilege_type;

-- 3) FUNCIONES SECURITY DEFINER + CONFIGURACIÓN + ACL
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prosecdef as security_definer,
  p.proconfig as function_config,
  p.proacl as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef = true
order by p.proname;

-- 4) POLÍTICAS MFA RESTRICTIVAS
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where
  (schemaname = 'public' and policyname = 'eco_hogar_require_mfa_if_enrolled')
  or (schemaname = 'storage' and policyname = 'eco_hogar_receipts_require_mfa_if_enrolled')
order by schemaname, tablename;

-- 5) BUCKETS
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
order by name;
