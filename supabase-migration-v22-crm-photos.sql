-- ============================================================
-- Householder v35 (миграция v22): CRM — фотоотчёт по задачам
-- (фото «до» и «после» выполнения)
-- ============================================================
-- ⚠️ ВАЖНО: выполняй в SQL Editor ТОЛЬКО проекта householder!
-- Проверь: Railway → householder-api → Variables → SUPABASE_URL
-- должен совпадать с URL проекта, где запускаешь этот SQL.
-- Выполнять ПОСЛЕ supabase-migration-v21-crm.sql.
-- ============================================================
-- photos_before / photos_after — jsonb-массивы URL на изображения
-- в Supabase Storage (bucket receipt-images, папка crm/).
-- Загрузка/удаление — через API:
--   POST   /api/crm/tasks/:id/photos?kind=before|after  (multipart, поле photos)
--   DELETE /api/crm/tasks/:id/photos                    (body: {kind, url})
-- Каждая операция дописывает событие в timeline задачи:
--   action: photo | photo_del
-- ============================================================

-- 1) Колонки фотоотчёта в задачах
alter table crm_tasks
  add column if not exists photos_before jsonb not null default '[]'::jsonb;
alter table crm_tasks
  add column if not exists photos_after  jsonb not null default '[]'::jsonb;

-- 2) Обновить кэш схемы PostgREST (иначе "Could not find the column ... in the schema cache")
notify pgrst, 'reload schema';

-- 3) Проверка (должно вернуть 2 строки = true)
select c.table_name || '.' || c.column_name as check_item, true as ok
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'crm_tasks'
  and c.column_name in ('photos_before', 'photos_after')
order by 1;
