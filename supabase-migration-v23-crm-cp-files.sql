-- ============================================================
-- Householder v36 (миграция v23): CRM — файлы контрагента
-- (фото / видео / аудио) + медиа в фотоотчёте задач
-- ============================================================
-- ⚠️ ВАЖНО: выполняй в SQL Editor ТОЛЬКО проекта householder!
-- Проверь: Railway → householder-api → Variables → SUPABASE_URL
-- должен совпадать с URL проекта, где запускаешь этот SQL.
-- Выполнять ПОСЛЕ supabase-migration-v21-crm.sql и
-- supabase-migration-v22-crm-photos.sql.
-- ============================================================
-- attachments — jsonb-массив объектов:
--   [{url, kind: photo|video|audio, name, ts, actor}]
-- Файлы лежат в Supabase Storage (bucket receipt-images, папка crm_cp/).
-- Загрузка/удаление — через API:
--   POST   /api/crm/counterparties/:id/files   (multipart, поле files)
--   DELETE /api/crm/counterparties/:id/files   (body: {url})
-- Примечание: photos_before/photos_after в crm_tasks (миграция v22)
-- теперь тоже могут содержать объекты {url, kind, name, ts, actor}
-- (видео/аудио в отчёте «до/после») — колонки менять не нужно, jsonb.
-- ============================================================

-- 1) Файлы контрагента
alter table crm_counterparties
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- 2) Обновить кэш схемы PostgREST (иначе "Could not find the column ... in the schema cache")
notify pgrst, 'reload schema';

-- 3) Проверка (должна вернуть 1 строку = true)
select c.table_name || '.' || c.column_name as check_item, true as ok
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'crm_counterparties'
  and c.column_name = 'attachments';
