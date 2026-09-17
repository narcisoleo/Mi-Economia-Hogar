-- ECO HOGAR v1.6.1 - Calendario mensual de tarjetas
-- Ejecutar UNA VEZ en Supabase > SQL Editor.
-- Permite cargar fechas exactas de cierre y vencimiento por mes.

create table if not exists public.credit_card_cycles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null
    references public.households(id)
    on delete cascade,
  credit_card_id uuid not null
    references public.credit_cards(id)
    on delete cascade,
  period_month date not null,
  closing_date date not null,
  due_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_card_cycles_period_first_day
    check (extract(day from period_month) = 1),
  constraint credit_card_cycles_due_after_close
    check (due_date >= closing_date),
  constraint credit_card_cycles_unique_period
    unique (credit_card_id, period_month)
);

create index if not exists idx_credit_card_cycles_household
  on public.credit_card_cycles(household_id);

create index if not exists idx_credit_card_cycles_card_period
  on public.credit_card_cycles(credit_card_id, period_month desc);

alter table public.credit_card_cycles enable row level security;

drop policy if exists "household_members_view_credit_card_cycles"
  on public.credit_card_cycles;
create policy "household_members_view_credit_card_cycles"
  on public.credit_card_cycles
  for select
  to authenticated
  using (public.is_household_member(household_id));

drop policy if exists "household_members_insert_credit_card_cycles"
  on public.credit_card_cycles;
create policy "household_members_insert_credit_card_cycles"
  on public.credit_card_cycles
  for insert
  to authenticated
  with check (public.is_household_member(household_id));

drop policy if exists "household_members_update_credit_card_cycles"
  on public.credit_card_cycles;
create policy "household_members_update_credit_card_cycles"
  on public.credit_card_cycles
  for update
  to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists "household_members_delete_credit_card_cycles"
  on public.credit_card_cycles;
create policy "household_members_delete_credit_card_cycles"
  on public.credit_card_cycles
  for delete
  to authenticated
  using (public.is_household_member(household_id));
