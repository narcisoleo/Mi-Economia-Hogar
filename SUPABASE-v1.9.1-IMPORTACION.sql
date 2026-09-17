-- ECO HOGAR v1.9.1
-- Ejecutar UNA sola vez en Supabase > SQL Editor.
-- Corrige la restricción de input_source para permitir importaciones CSV
-- y deja el campo preparado para futuras fuentes como OCR/IA/API.

alter table public.transactions
  drop constraint if exists input_source_check;

alter table public.transactions
  add constraint input_source_check
  check (
    input_source is null
    or char_length(trim(input_source)) between 1 and 30
  );
