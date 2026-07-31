-- ============================================================
-- Полная SQL схема для новой Supabase: receipt-manager
-- Выполните в SQL Editor (Supabase Dashboard → SQL Editor → New query)
-- ============================================================

-- 1. Таблица чеков (полная структура совместимая с App.js)
CREATE TABLE IF NOT EXISTS receipts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Основные поля
  store_name TEXT,
  store_name_ru TEXT,
  total_amount NUMERIC,
  subtotal NUMERIC,
  tax_amount NUMERIC,
  tax_rate TEXT,
  currency TEXT DEFAULT 'EUR',

  -- Даты
  purchase_date DATE,
  receipt_date TEXT,
  receipt_time TEXT,

  -- Дополнительные поля чека
  receipt_address TEXT,
  phone TEXT,
  card_last4 TEXT,
  payment_method TEXT,
  discount_amount NUMERIC,
  loyalty_card TEXT,

  -- Товары и распознавание
  items JSONB DEFAULT '[]',
  recognized_text TEXT,
  raw_text TEXT,

  -- Фото (два поля для совместимости)
  photo_url TEXT,        -- новое поле (Supabase Storage)
  photo_path TEXT,       -- путь в Storage для удаления
  image_url TEXT,        -- старое поле (для обратной совместимости)

  -- Метаданные
  document_type TEXT DEFAULT 'receipt',
  object TEXT DEFAULT 'other',
  recognition_method TEXT,

  -- Пользователь
  owner_id TEXT,
  owner_name TEXT,

  -- Предупреждения и заметки
  warning TEXT,
  notes TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Индексы для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_receipts_owner ON receipts(owner_id);
CREATE INDEX IF NOT EXISTS idx_receipts_created ON receipts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_store ON receipts(store_name);
CREATE INDEX IF NOT EXISTS idx_receipts_object ON receipts(object);
CREATE INDEX IF NOT EXISTS idx_receipts_type ON receipts(document_type);

-- 3. Включить RLS (Row Level Security)
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;

-- 4. Политика для service_role (backend) — полный доступ
CREATE POLICY "Allow all for service_role" ON receipts
FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. Политика для anon (чтение)
CREATE POLICY "Allow select for anon" ON receipts
FOR SELECT TO anon USING (true);

-- 6. Storage Bucket для фото
--    Перейдите вручную: Storage → New bucket → Name: receipt-photos → Public: ON

-- 7. Политики Storage (выполните после создания bucket)
CREATE POLICY "Allow public read photos" ON storage.objects
FOR SELECT TO anon USING (bucket_id = 'receipt-images');

CREATE POLICY "Allow uploads for service_role" ON storage.objects
FOR INSERT TO service_role WITH CHECK (bucket_id = 'receipt-images');

CREATE POLICY "Allow deletes for service_role" ON storage.objects
FOR DELETE TO service_role USING (bucket_id = 'receipt-images');
