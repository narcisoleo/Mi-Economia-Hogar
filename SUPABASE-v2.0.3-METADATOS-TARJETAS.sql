-- ECO HOGAR v2.0.3 - Identidad de tarjetas + soporte de limpieza
-- Ejecutar UNA sola vez en Supabase > SQL Editor.
-- No elimina datos. Solo agrega metadatos para reconocer mejor cada tarjeta.

alter table public.credit_cards
  add column if not exists issuer text null;

alter table public.credit_cards
  add column if not exists brand varchar(40) null;

alter table public.credit_cards
  add column if not exists card_last4 varchar(4) null;

create index if not exists idx_credit_cards_identity
  on public.credit_cards(household_id, brand, card_last4);
