-- ============================================================
-- ECO HOGAR v2.2 - AUDITORIA DE SEGURIDAD (SOLO LECTURA)
-- No modifica datos ni políticas. Ejecutar en Supabase SQL Editor.
-- ============================================================

-- 1) Tablas públicas y estado de Row Level Security (RLS)
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relname;

-- 2) Políticas RLS activas
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
where schemaname = 'public'
order by tablename, policyname;

-- 3) Buckets de Storage. receipts y card-statements deben ser PRIVADOS.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
order by name;

-- 4) Políticas de Storage
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by policyname;

-- 5) Funciones SECURITY DEFINER: revisar que tengan search_path controlado.
select
  n.nspname as schema_name,
  p.proname as function_name,
  p.prosecdef as security_definer,
  pg_get_function_arguments(p.oid) as arguments,
  p.proconfig as function_config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef = true
order by p.proname;
