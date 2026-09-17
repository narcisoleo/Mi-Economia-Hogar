-- ECO HOGAR v1.4
-- Ejecutar SOLO si la app informa un error de esquema al guardar transferencias.
-- Es seguro volver a ejecutar la creación de columna/índice.

alter table public.transactions
add column if not exists destination_account_id uuid
references public.accounts(id)
on delete set null;

create index if not exists idx_transactions_destination_account
on public.transactions(destination_account_id);

-- Una transferencia no necesita categoría ni responsable.
alter table public.transactions
alter column category_id drop not null;

alter table public.transactions
alter column responsible_user_id drop not null;
