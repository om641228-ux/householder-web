-- ============================================================
-- Householder v24: банковские выписки и автопривязка фактур
-- ============================================================
-- ⚠️ ВАЖНО: выполняй в SQL Editor ТОЛЬКО проекта householder!
-- Проверь: Railway → householder-api → Variables → SUPABASE_URL
-- должен совпадать с URL проекта, где запускаешь этот SQL.
-- ============================================================

-- 1) Таблица движений по банковскому счёту (строки выписки)
create table if not exists bank_movements (
  id                 bigserial primary key,
  owner_id           text,
  iban               text,
  account_name       text,
  operation_date     date,
  value_date         date,
  prefix             text,
  concept            text,
  counterparty       text,
  amount             numeric(14,2) not null,  -- <0 платёж, >0 поступление
  balance            numeric(14,2),
  entry_number       bigint,                  -- Nro. Apunte из выписки
  import_batch       text,
  matched_receipt_id bigint,                  -- привязанная фактура/чек (без FK намеренно)
  match_status       text not null default 'unmatched',  -- unmatched | auto | manual | rejected
  match_score        integer,
  matched_at         timestamptz,
  created_at         timestamptz not null default now()
);

-- Дедупликация при повторном импорте: (iban, номер движения)
create unique index if not exists bank_movements_iban_apunte_uidx
  on bank_movements (iban, entry_number);

-- 2) Новые поля у документов
alter table receipts add column if not exists bank_movement_id bigint;
alter table receipts add column if not exists paid_date date;

-- 3) Обновить кэш схемы PostgREST (иначе "Could not find the column ... in the schema cache")
notify pgrst, 'reload schema';

-- 4) Проверка (должно вернуть: bank_movements = есть, bank_movement_id, paid_date, payment_status = true)
select 'bank_movements' as check_item, count(*) >= 0 as ok from bank_movements
union all
select c.column_name, true
from information_schema.columns c
where c.table_name = 'receipts'
  and c.column_name in ('bank_movement_id', 'paid_date', 'payment_status')
order by 1;
