-- ECO HOGAR v2.0 - Lectura de resúmenes de tarjeta
-- Ejecutar UNA sola vez en Supabase > SQL Editor.
-- Guarda el PDF analizado, metadatos del resumen y vincula movimientos importados.

create table if not exists public.credit_card_statement_imports (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  credit_card_id uuid not null references public.credit_cards(id) on delete cascade,
  created_by uuid null references public.profiles(id) on delete set null,
  file_path text null,
  original_filename text null,
  issuer text null,
  brand text null,
  card_last4 varchar(4) null,
  closing_date date not null,
  due_date date null,
  previous_closing_date date null,
  previous_due_date date null,
  next_closing_date date null,
  next_due_date date null,
  statement_balance numeric(14,2) null,
  minimum_payment numeric(14,2) null,
  purchase_limit numeric(14,2) null,
  total_purchases numeric(14,2) null,
  parsed_data jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint credit_card_statement_imports_unique unique (credit_card_id, closing_date)
);

create index if not exists idx_cc_statement_imports_household
  on public.credit_card_statement_imports(household_id, closing_date desc);

alter table public.credit_card_statement_imports enable row level security;

drop policy if exists "household_members_view_cc_statement_imports" on public.credit_card_statement_imports;
create policy "household_members_view_cc_statement_imports"
on public.credit_card_statement_imports for select to authenticated
using (public.is_household_member(household_id));

drop policy if exists "household_members_insert_cc_statement_imports" on public.credit_card_statement_imports;
create policy "household_members_insert_cc_statement_imports"
on public.credit_card_statement_imports for insert to authenticated
with check (public.is_household_member(household_id));

drop policy if exists "household_members_update_cc_statement_imports" on public.credit_card_statement_imports;
create policy "household_members_update_cc_statement_imports"
on public.credit_card_statement_imports for update to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists "household_members_delete_cc_statement_imports" on public.credit_card_statement_imports;
create policy "household_members_delete_cc_statement_imports"
on public.credit_card_statement_imports for delete to authenticated
using (public.is_household_member(household_id));

create table if not exists public.credit_card_future_installments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  credit_card_id uuid not null references public.credit_cards(id) on delete cascade,
  statement_import_id uuid not null references public.credit_card_statement_imports(id) on delete cascade,
  period_month date not null,
  amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  constraint cc_future_installments_unique unique (statement_import_id, period_month)
);

create index if not exists idx_cc_future_installments_household_period
  on public.credit_card_future_installments(household_id, period_month);

alter table public.credit_card_future_installments enable row level security;

drop policy if exists "household_members_view_cc_future_installments" on public.credit_card_future_installments;
create policy "household_members_view_cc_future_installments"
on public.credit_card_future_installments for select to authenticated
using (public.is_household_member(household_id));

drop policy if exists "household_members_insert_cc_future_installments" on public.credit_card_future_installments;
create policy "household_members_insert_cc_future_installments"
on public.credit_card_future_installments for insert to authenticated
with check (public.is_household_member(household_id));

drop policy if exists "household_members_update_cc_future_installments" on public.credit_card_future_installments;
create policy "household_members_update_cc_future_installments"
on public.credit_card_future_installments for update to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

drop policy if exists "household_members_delete_cc_future_installments" on public.credit_card_future_installments;
create policy "household_members_delete_cc_future_installments"
on public.credit_card_future_installments for delete to authenticated
using (public.is_household_member(household_id));

alter table public.transactions
  add column if not exists statement_import_id uuid null
    references public.credit_card_statement_imports(id) on delete set null;

alter table public.transactions
  add column if not exists source_line_key text null;

create unique index if not exists transactions_statement_line_unique
  on public.transactions(statement_import_id, source_line_key)
  where statement_import_id is not null and source_line_key is not null;
