-- ============================================================
-- Миграция v19: статус оплаты документа
-- (к оплате / оплачено / недоплачено)
--
-- ВАЖНО: выполнять в SQL Editor ПРАВИЛЬНОГО проекта Supabase —
-- проекта householder (НЕ recept-web!). Проверить можно так:
-- в Railway → householder-api → Variables → SUPABASE_URL —
-- хост вида https://XXXX.supabase.co — это и есть нужный проект.
-- ============================================================

alter table receipts add column if not exists payment_status text;

-- Допустимые значения (приложение пишет только их, иначе null):
--   'to_pay'    — К оплате
--   'paid'      — Оплачено
--   'underpaid' — Недоплачено

-- Принудительно обновить кэш схемы PostgREST.
-- БЕЗ этого после ALTER TABLE Supabase может ещё несколько минут
-- отвечать ошибкой "Could not find the 'payment_status' column
-- of 'receipts' in the schema cache".
notify pgrst, 'reload schema';

-- Проверка: должна вернуться ровно одна строка.
-- Если 0 строк — вы в другом проекте Supabase!
select column_name, data_type
from information_schema.columns
where table_name = 'receipts' and column_name = 'payment_status';
