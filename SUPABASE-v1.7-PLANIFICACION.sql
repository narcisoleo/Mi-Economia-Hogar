-- ECO HOGAR v1.7 - Presupuestos mensuales y movimientos recurrentes
-- Ejecutar UNA VEZ en Supabase > SQL Editor.
-- Es seguro volver a ejecutarlo.

-- =========================================================
-- PRESUPUESTOS MENSUALES POR CATEGORIA PRINCIPAL
-- =========================================================
create table if not exists public.monthly_budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  month date not null,
  category_id uuid not null references public.categories(id) on delete cascade,
  amount numeric(14,2) not null check (amount >= 0),
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_budgets_month_first_day check (extract(day from month) = 1),
  constraint monthly_budgets_unique unique (household_id, month, category_id)
);

create index if not exists idx_monthly_budgets_household_month
  on public.monthly_budgets(household_id, month);

alter table public.monthly_budgets enable row level security;

drop policy if exists "eco_hogar_monthly_budgets_select_v17" on public.monthly_budgets;
create policy "eco_hogar_monthly_budgets_select_v17"
on public.monthly_budgets for select to authenticated
using (public.is_household_member(household_id));

drop policy if exists "eco_hogar_monthly_budgets_insert_v17" on public.monthly_budgets;
create policy "eco_hogar_monthly_budgets_insert_v17"
on public.monthly_budgets for insert to authenticated
with check (public.is_household_member(household_id));

drop policy if exists "eco_hogar_monthly_budgets_update_v17" on public.monthly_budgets;
create policy "eco_hogar_monthly_budgets_update_v17"
on public.monthly_budgets for update to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists "eco_hogar_monthly_budgets_delete_v17" on public.monthly_budgets;
create policy "eco_hogar_monthly_budgets_delete_v17"
on public.monthly_budgets for delete to authenticated
using (public.is_household_member(household_id));

-- =========================================================
-- REGLAS RECURRENTES (mensuales en v1.7)
-- =========================================================
create table if not exists public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid,
  name varchar(120) not null,
  transaction_type varchar(20) not null check (transaction_type in ('expense', 'income')),
  amount numeric(14,2) not null check (amount > 0),
  account_id uuid not null references public.accounts(id) on delete restrict,
  category_id uuid not null references public.categories(id) on delete restrict,
  responsible_person_id uuid references public.household_people(id) on delete set null,
  merchant varchar(160),
  description text,
  due_day smallint not null check (due_day between 1 and 31),
  start_month date not null,
  end_month date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_rules_start_first_day check (extract(day from start_month) = 1),
  constraint recurring_rules_end_first_day check (end_month is null or extract(day from end_month) = 1),
  constraint recurring_rules_end_after_start check (end_month is null or end_month >= start_month)
);

create index if not exists idx_recurring_rules_household_active
  on public.recurring_rules(household_id, active);

alter table public.recurring_rules enable row level security;

drop policy if exists "eco_hogar_recurring_rules_select_v17" on public.recurring_rules;
create policy "eco_hogar_recurring_rules_select_v17"
on public.recurring_rules for select to authenticated
using (public.is_household_member(household_id));

drop policy if exists "eco_hogar_recurring_rules_insert_v17" on public.recurring_rules;
create policy "eco_hogar_recurring_rules_insert_v17"
on public.recurring_rules for insert to authenticated
with check (public.is_household_member(household_id));

drop policy if exists "eco_hogar_recurring_rules_update_v17" on public.recurring_rules;
create policy "eco_hogar_recurring_rules_update_v17"
on public.recurring_rules for update to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists "eco_hogar_recurring_rules_delete_v17" on public.recurring_rules;
create policy "eco_hogar_recurring_rules_delete_v17"
on public.recurring_rules for delete to authenticated
using (public.is_household_member(household_id));

-- =========================================================
-- CONTROL DE GENERACION: evita duplicar un recurrente en el mismo mes
-- =========================================================
create table if not exists public.recurring_occurrences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  rule_id uuid not null references public.recurring_rules(id) on delete cascade,
  period_month date not null,
  transaction_id uuid references public.transactions(id) on delete set null,
  generated_at timestamptz not null default now(),
  constraint recurring_occurrences_month_first_day check (extract(day from period_month) = 1),
  constraint recurring_occurrences_unique unique (rule_id, period_month)
);

create index if not exists idx_recurring_occurrences_household_month
  on public.recurring_occurrences(household_id, period_month);

alter table public.recurring_occurrences enable row level security;

drop policy if exists "eco_hogar_recurring_occurrences_select_v17" on public.recurring_occurrences;
create policy "eco_hogar_recurring_occurrences_select_v17"
on public.recurring_occurrences for select to authenticated
using (public.is_household_member(household_id));

drop policy if exists "eco_hogar_recurring_occurrences_insert_v17" on public.recurring_occurrences;
create policy "eco_hogar_recurring_occurrences_insert_v17"
on public.recurring_occurrences for insert to authenticated
with check (public.is_household_member(household_id));

drop policy if exists "eco_hogar_recurring_occurrences_update_v17" on public.recurring_occurrences;
create policy "eco_hogar_recurring_occurrences_update_v17"
on public.recurring_occurrences for update to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists "eco_hogar_recurring_occurrences_delete_v17" on public.recurring_occurrences;
create policy "eco_hogar_recurring_occurrences_delete_v17"
on public.recurring_occurrences for delete to authenticated
using (public.is_household_member(household_id));

grant select, insert, update, delete on public.monthly_budgets to authenticated;
grant select, insert, update, delete on public.recurring_rules to authenticated;
grant select, insert, update, delete on public.recurring_occurrences to authenticated;

-- Comprobación rápida
select 'monthly_budgets' as tabla, count(*) as filas from public.monthly_budgets
union all
select 'recurring_rules', count(*) from public.recurring_rules
union all
select 'recurring_occurrences', count(*) from public.recurring_occurrences;
