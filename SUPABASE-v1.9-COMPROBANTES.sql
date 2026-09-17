-- ECO HOGAR v1.9
-- Ejecutar UNA sola vez en Supabase > SQL Editor.
-- Crea el espacio privado para comprobantes y políticas por hogar.

alter table public.transactions
add column if not exists receipt_url text;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'receipts',
  'receipts',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "eco_hogar_receipts_select" on storage.objects;
create policy "eco_hogar_receipts_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'receipts'
  and public.is_household_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "eco_hogar_receipts_insert" on storage.objects;
create policy "eco_hogar_receipts_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'receipts'
  and public.is_household_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "eco_hogar_receipts_update" on storage.objects;
create policy "eco_hogar_receipts_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'receipts'
  and public.is_household_member(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'receipts'
  and public.is_household_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "eco_hogar_receipts_delete" on storage.objects;
create policy "eco_hogar_receipts_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'receipts'
  and public.is_household_member(((storage.foldername(name))[1])::uuid)
);
