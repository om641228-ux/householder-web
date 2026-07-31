-- ============================================================
-- Исправление RLS и Storage для receipt-manager
-- Выполните ВСЕ запросы в SQL Editor
-- ============================================================

-- 1. Отключить RLS (временно, для проверки) или настроить правильно
-- Вариант A: Отключить RLS полностью (небезопасно, но для теста)
-- ALTER TABLE receipts DISABLE ROW LEVEL SECURITY;

-- Вариант B: Правильная политика для service_role (рекомендуется)
-- Сначала удаляем старые политики
DROP POLICY IF EXISTS "Allow all for service_role" ON receipts;
DROP POLICY IF EXISTS "Allow select for anon" ON receipts;
DROP POLICY IF EXISTS "Allow public read" ON receipts;

-- Включаем RLS
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;

-- Политика: service_role может ВСЁ (INSERT, SELECT, UPDATE, DELETE)
CREATE POLICY "service_role_all" ON receipts
FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Политика: anon может читать (для фронтенда)
CREATE POLICY "anon_select" ON receipts
FOR SELECT TO anon USING (true);

-- Политика: authenticated может всё (если используете Supabase Auth)
CREATE POLICY "authenticated_all" ON receipts
FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- Storage Policies (для bucket receipt-images)
-- ============================================================

-- Удаляем старые политики storage
DROP POLICY IF EXISTS "Allow public read photos" ON storage.objects;
DROP POLICY IF EXISTS "Allow uploads for service_role" ON storage.objects;
DROP POLICY IF EXISTS "Allow deletes for service_role" ON storage.objects;

-- Чтение: разрешить всем (фронтенд показывает фото)
CREATE POLICY "public_read_images" ON storage.objects
FOR SELECT TO anon USING (bucket_id = 'receipt-images');

-- Загрузка: service_role (backend загружает)
CREATE POLICY "service_role_upload_images" ON storage.objects
FOR INSERT TO service_role WITH CHECK (bucket_id = 'receipt-images');

-- Удаление: service_role
CREATE POLICY "service_role_delete_images" ON storage.objects
FOR DELETE TO service_role USING (bucket_id = 'receipt-images');

-- Обновление: service_role
CREATE POLICY "service_role_update_images" ON storage.objects
FOR UPDATE TO service_role USING (bucket_id = 'receipt-images');
