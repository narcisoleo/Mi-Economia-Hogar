-- ECO HOGAR v1.3
-- Ejecutar solamente si Editar o Eliminar devuelve un error de permisos/RLS.

alter table public.transactions enable row level security;

drop policy if exists "eco_hogar_v13_update_transactions" on public.transactions;
create policy "eco_hogar_v13_update_transactions"
on public.transactions
for update
to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists "eco_hogar_v13_delete_transactions" on public.transactions;
create policy "eco_hogar_v13_delete_transactions"
on public.transactions
for delete
to authenticated
using (public.is_household_member(household_id));
