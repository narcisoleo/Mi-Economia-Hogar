-- ECO HOGAR v1.6 - Tarjetas de credito
-- Ejecutar UNA VEZ en Supabase > SQL Editor.
-- Es seguro volver a ejecutarlo: usa IF NOT EXISTS / DROP POLICY IF EXISTS.

create table if not exists public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null
    references public.households(id)
    on delete cascade,
  account_id uuid not null unique
    references public.accounts(id)
    on delete cascade,
  credit_limit numeric(14,2) not null default 0,
  closing_day smallint null
    check (closing_day between 1 and 31),
  due_day smallint null
    check (due_day between 1 and 31),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_credit_cards_household
  on public.credit_cards(household_id);

alter table public.credit_cards enable row level security;

drop policy if exists "household_members_view_credit_cards"
  on public.credit_cards;
create policy "household_members_view_credit_cards"
  on public.credit_cards
  for select
  to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "household_members_insert_credit_cards"
  on public.credit_cards;
create policy "household_members_insert_credit_cards"
  on public.credit_cards
  for insert
  to authenticated
  with check (public.is_household_member(household_id));

drop policy if exists "household_members_update_credit_cards"
  on public.credit_cards;
create policy "household_members_update_credit_cards"
  on public.credit_cards
  for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists "household_members_delete_credit_cards"
  on public.credit_cards;
create policy "household_members_delete_credit_cards"
  on public.credit_cards
  for delete
  to authenticated
  using (public.is_household_member(household_id));

-- Intento de deteccion automatica de cuentas que ya fueron creadas
-- con tipo = credit_card. El bloque se adapta si la columna se llama
-- account_type o type. Si no existe ninguna de las dos, no hace nada.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'accounts'
      and column_name = 'account_type'
  ) then
    execute $q$
      insert into public.credit_cards (household_id, account_id)
      select household_id, id
      from public.accounts
      where account_type::text = 'credit_card'
      on conflict (account_id) do nothing
    $q$;
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'accounts'
      and column_name = 'type'
  ) then
    execute $q$
      insert into public.credit_cards (household_id, account_id)
      select household_id, id
      from public.accounts
      where type::text = 'credit_card'
      on conflict (account_id) do nothing
    $q$;
  end if;
end $$;

-- Fallback para la configuracion actual de ECO HOGAR: si la cuenta se
-- llama Naranja, se registra como tarjeta. Si no corresponde, puede
-- desactivarse luego desde la pantalla Tarjetas.
insert into public.credit_cards (household_id, account_id)
select household_id, id
from public.accounts
where lower(name) like '%naranja%'
on conflict (account_id) do nothing;
