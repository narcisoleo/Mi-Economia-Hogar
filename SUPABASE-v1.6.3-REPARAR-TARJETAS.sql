-- ECO HOGAR v1.6.3 - Reparación de tarjetas y permisos
-- Ejecutar UNA VEZ en Supabase > SQL Editor.
-- Es seguro volver a ejecutarlo.
--
-- Corrige el caso de versiones v1.6/v1.6.1 donde una configuración de
-- tarjeta podía haber quedado vinculada a una cuenta bancaria normal.
-- También garantiza permisos para crear tarjetas directamente desde la app.

-- =========================================================
-- PERMISOS ACCOUNTS
-- =========================================================
alter table public.accounts enable row level security;

drop policy if exists "eco_hogar_accounts_select_v163" on public.accounts;
create policy "eco_hogar_accounts_select_v163"
on public.accounts for select to authenticated
using (public.is_household_member(household_id));

drop policy if exists "eco_hogar_accounts_insert_v163" on public.accounts;
create policy "eco_hogar_accounts_insert_v163"
on public.accounts for insert to authenticated
with check (public.is_household_member(household_id));

drop policy if exists "eco_hogar_accounts_update_v163" on public.accounts;
create policy "eco_hogar_accounts_update_v163"
on public.accounts for update to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists "eco_hogar_accounts_delete_v163" on public.accounts;
create policy "eco_hogar_accounts_delete_v163"
on public.accounts for delete to authenticated
using (public.is_household_member(household_id));

-- =========================================================
-- PERMISOS CREDIT_CARDS
-- =========================================================
alter table public.credit_cards enable row level security;

drop policy if exists "eco_hogar_credit_cards_select_v163" on public.credit_cards;
create policy "eco_hogar_credit_cards_select_v163"
on public.credit_cards for select to authenticated
using (public.is_household_member(household_id));

drop policy if exists "eco_hogar_credit_cards_insert_v163" on public.credit_cards;
create policy "eco_hogar_credit_cards_insert_v163"
on public.credit_cards for insert to authenticated
with check (public.is_household_member(household_id));

drop policy if exists "eco_hogar_credit_cards_update_v163" on public.credit_cards;
create policy "eco_hogar_credit_cards_update_v163"
on public.credit_cards for update to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists "eco_hogar_credit_cards_delete_v163" on public.credit_cards;
create policy "eco_hogar_credit_cards_delete_v163"
on public.credit_cards for delete to authenticated
using (public.is_household_member(household_id));

-- =========================================================
-- MIGRAR CONFIGURACIONES VIEJAS MAL VINCULADAS
-- =========================================================
-- Ejemplo:
--   Banco Provincia Leonardo        account_type = bank
--   credit_cards -> apuntaba a esa cuenta (incorrecto)
--
-- Resultado:
--   Banco Provincia Leonardo        account_type = bank
--   Tarjeta Banco Provincia Leonardo account_type = credit_card
--   límite y calendario se copian a la tarjeta nueva.

do $$
declare
  r record;
  v_target_account_id uuid;
  v_target_card_id uuid;
  v_target_name text;
begin
  for r in
    select
      cc.id as source_card_id,
      cc.household_id,
      cc.credit_limit,
      cc.closing_day,
      cc.due_day,
      a.id as source_account_id,
      a.owner_user_id,
      a.name as source_account_name,
      a.institution,
      a.currency
    from public.credit_cards cc
    join public.accounts a on a.id = cc.account_id
    where coalesce(a.account_type, '') <> 'credit_card'
  loop
    v_target_account_id := null;
    v_target_card_id := null;

    v_target_name := case
      when lower(r.source_account_name) like 'tarjeta %'
        then r.source_account_name
      else 'Tarjeta ' || r.source_account_name
    end;

    select a2.id
      into v_target_account_id
    from public.accounts a2
    where a2.household_id = r.household_id
      and a2.owner_user_id is not distinct from r.owner_user_id
      and a2.account_type = 'credit_card'
      and lower(a2.name) = lower(v_target_name)
      and a2.active = true
    limit 1;

    if v_target_account_id is null then
      insert into public.accounts (
        household_id,
        owner_user_id,
        name,
        account_type,
        institution,
        currency,
        initial_balance,
        active
      ) values (
        r.household_id,
        r.owner_user_id,
        v_target_name,
        'credit_card',
        r.institution,
        coalesce(r.currency, 'ARS'),
        0,
        true
      ) returning id into v_target_account_id;
    end if;

    select cc2.id
      into v_target_card_id
    from public.credit_cards cc2
    where cc2.account_id = v_target_account_id
    limit 1;

    if v_target_card_id is null then
      insert into public.credit_cards (
        household_id,
        account_id,
        credit_limit,
        closing_day,
        due_day,
        active,
        updated_at
      ) values (
        r.household_id,
        v_target_account_id,
        coalesce(r.credit_limit, 0),
        r.closing_day,
        r.due_day,
        true,
        now()
      ) returning id into v_target_card_id;
    else
      update public.credit_cards
      set
        credit_limit = case
          when coalesce(credit_limit, 0) = 0 then coalesce(r.credit_limit, 0)
          else credit_limit
        end,
        closing_day = coalesce(closing_day, r.closing_day),
        due_day = coalesce(due_day, r.due_day),
        active = true,
        updated_at = now()
      where id = v_target_card_id;
    end if;

    -- Si existe el calendario mensual, copiar los períodos del registro viejo.
    if to_regclass('public.credit_card_cycles') is not null then
      insert into public.credit_card_cycles (
        household_id,
        credit_card_id,
        period_month,
        closing_date,
        due_date,
        created_at,
        updated_at
      )
      select
        c.household_id,
        v_target_card_id,
        c.period_month,
        c.closing_date,
        c.due_date,
        c.created_at,
        now()
      from public.credit_card_cycles c
      where c.credit_card_id = r.source_card_id
      on conflict (credit_card_id, period_month)
      do update set
        closing_date = excluded.closing_date,
        due_date = excluded.due_date,
        updated_at = now();

      delete from public.credit_card_cycles
      where credit_card_id = r.source_card_id;
    end if;

    delete from public.credit_cards
    where id = r.source_card_id;
  end loop;
end $$;

-- =========================================================
-- VALIDACIÓN PARA FUTURO
-- =========================================================
create or replace function public.validate_credit_card_account_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
begin
  select account_type into v_type
  from public.accounts
  where id = new.account_id;

  if v_type is distinct from 'credit_card' then
    raise exception 'La configuración de tarjeta solo puede vincularse a una cuenta account_type=credit_card.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_credit_card_account_type on public.credit_cards;
create trigger trg_validate_credit_card_account_type
before insert or update of account_id
on public.credit_cards
for each row
execute function public.validate_credit_card_account_type();

-- Ya no usamos create_credit_card_account RPC desde la app v1.6.3.
-- Si existía de una versión anterior puede quedar sin problema.

-- =========================================================
-- COMPROBACIÓN
-- =========================================================
select
  a.name,
  a.account_type,
  a.owner_user_id,
  cc.credit_limit,
  cc.id as credit_card_id
from public.accounts a
left join public.credit_cards cc on cc.account_id = a.id
where a.active = true
order by a.owner_user_id nulls first, a.account_type, a.name;
