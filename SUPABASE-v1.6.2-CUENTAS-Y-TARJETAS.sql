-- ECO HOGAR v1.6.2 - Cuentas y tarjetas separadas
-- Ejecutar UNA VEZ en Supabase > SQL Editor.
--
-- Objetivos:
-- 1) permitir crear nuevas cuentas desde la app;
-- 2) crear nuevas tarjetas como cuentas account_type = 'credit_card';
-- 3) impedir que una cuenta bancaria normal vuelva a configurarse como tarjeta;
-- 4) migrar automáticamente configuraciones de tarjeta v1.6/v1.6.1 que se
--    hayan asociado por error a una cuenta bancaria (ej. Banco Provincia).

-- =========================================================
-- RLS PARA ALTAS/MODIFICACIONES DE CUENTAS DESDE LA APP
-- =========================================================
alter table public.accounts enable row level security;

drop policy if exists "eco_hogar_accounts_select_v162" on public.accounts;
create policy "eco_hogar_accounts_select_v162"
on public.accounts
for select
to authenticated
using (public.is_household_member(household_id));

drop policy if exists "eco_hogar_accounts_insert_v162" on public.accounts;
create policy "eco_hogar_accounts_insert_v162"
on public.accounts
for insert
to authenticated
with check (public.is_household_member(household_id));

drop policy if exists "eco_hogar_accounts_update_v162" on public.accounts;
create policy "eco_hogar_accounts_update_v162"
on public.accounts
for update
to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists "eco_hogar_accounts_delete_v162" on public.accounts;
create policy "eco_hogar_accounts_delete_v162"
on public.accounts
for delete
to authenticated
using (public.is_household_member(household_id));

-- =========================================================
-- MIGRAR TARJETAS QUE FUERON ASOCIADAS A UNA CUENTA NO CARD
-- =========================================================
-- La cuenta bancaria original NO se modifica ni se elimina.
-- Se crea una cuenta de tarjeta separada con el prefijo "Tarjeta ",
-- se copian límite/calendario y luego se elimina solo la configuración
-- errónea de credit_cards vinculada a la cuenta bancaria.

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
      )
      returning id into v_target_account_id;
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
        r.credit_limit,
        r.closing_day,
        r.due_day,
        true,
        now()
      )
      returning id into v_target_card_id;
    else
      update public.credit_cards
      set
        credit_limit = case
          when coalesce(credit_limit, 0) = 0 then r.credit_limit
          else credit_limit
        end,
        closing_day = coalesce(closing_day, r.closing_day),
        due_day = coalesce(due_day, r.due_day),
        active = true,
        updated_at = now()
      where id = v_target_card_id;
    end if;

    -- Copiar calendario mensual, conservando la fecha más reciente si ya existía.
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

    delete from public.credit_cards
    where id = r.source_card_id;
  end loop;
end $$;

-- =========================================================
-- VALIDACIÓN: CREDIT_CARDS SOLO PUEDE APUNTAR A CREDIT_CARD
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
  select account_type
    into v_type
  from public.accounts
  where id = new.account_id;

  if v_type is distinct from 'credit_card' then
    raise exception 'La cuenta seleccionada no es una tarjeta de crédito. Creá una tarjeta separada desde Tarjetas > Agregar tarjeta.';
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

-- =========================================================
-- FUNCIÓN TRANSACCIONAL PARA CREAR UNA NUEVA TARJETA
-- Crea account + credit_cards en una sola operación.
-- =========================================================
create or replace function public.create_credit_card_account(
  p_household_id uuid,
  p_owner_user_id uuid,
  p_name text,
  p_institution text default null,
  p_credit_limit numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  if not public.is_household_member(p_household_id) then
    raise exception 'No tenés permiso para crear una tarjeta en este hogar.';
  end if;

  if p_owner_user_id is not null and not exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = p_owner_user_id
  ) then
    raise exception 'El titular seleccionado no pertenece a este hogar.';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception 'El nombre de la tarjeta es obligatorio.';
  end if;

  if coalesce(p_credit_limit, 0) < 0 then
    raise exception 'El límite no puede ser negativo.';
  end if;

  if exists (
    select 1
    from public.accounts a
    where a.household_id = p_household_id
      and a.owner_user_id is not distinct from p_owner_user_id
      and lower(a.name) = lower(trim(p_name))
      and a.active = true
  ) then
    raise exception 'Ya existe una cuenta o tarjeta activa con ese nombre para ese titular.';
  end if;

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
    p_household_id,
    p_owner_user_id,
    trim(p_name),
    'credit_card',
    nullif(trim(coalesce(p_institution, '')), ''),
    'ARS',
    0,
    true
  )
  returning id into v_account_id;

  insert into public.credit_cards (
    household_id,
    account_id,
    credit_limit,
    active
  ) values (
    p_household_id,
    v_account_id,
    coalesce(p_credit_limit, 0),
    true
  );

  return v_account_id;
end;
$$;

grant execute on function public.create_credit_card_account(uuid, uuid, text, text, numeric)
to authenticated;

-- =========================================================
-- VERIFICACIÓN OPCIONAL
-- =========================================================
-- Después de ejecutar, podés correr esta consulta para comprobar tipos:
-- select name, account_type, owner_user_id, active
-- from public.accounts
-- where household_id = 'TU-HOUSEHOLD-ID'
-- order by owner_user_id, account_type, name;
