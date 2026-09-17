-- ECO HOGAR v2.0.4 - Robustez al crear tarjetas desde un resumen PDF
-- Ejecutar UNA sola vez en Supabase > SQL Editor.
-- Es idempotente: se puede volver a ejecutar sin borrar datos.

alter table public.credit_cards
  add column if not exists issuer text null;

alter table public.credit_cards
  add column if not exists brand varchar(40) null;

alter table public.credit_cards
  add column if not exists card_last4 varchar(4) null;

create index if not exists idx_credit_cards_identity
  on public.credit_cards(household_id, brand, card_last4);

-- Aseguramos que un integrante del hogar pueda crear/editar tarjetas.
alter table public.credit_cards enable row level security;

drop policy if exists "eco_hogar_credit_cards_select_v204" on public.credit_cards;
create policy "eco_hogar_credit_cards_select_v204"
on public.credit_cards for select to authenticated
using (public.is_household_member(household_id));

drop policy if exists "eco_hogar_credit_cards_insert_v204" on public.credit_cards;
create policy "eco_hogar_credit_cards_insert_v204"
on public.credit_cards for insert to authenticated
with check (public.is_household_member(household_id));

drop policy if exists "eco_hogar_credit_cards_update_v204" on public.credit_cards;
create policy "eco_hogar_credit_cards_update_v204"
on public.credit_cards for update to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists "eco_hogar_credit_cards_delete_v204" on public.credit_cards;
create policy "eco_hogar_credit_cards_delete_v204"
on public.credit_cards for delete to authenticated
using (public.is_household_member(household_id));

-- Fuerza a PostgREST/Supabase a refrescar las columnas recién agregadas.
notify pgrst, 'reload schema';
