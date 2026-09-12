-- v178: база домашних предметов (модуль «📦 Предметы»)
-- Выполнить ОДИН РАЗ в Supabase → SQL Editor.
-- Предмет = фото → AI-распознавание (название + % схожести, производитель, номер производителя),
-- привязка к чеку и поиск похожих товаров в базах магазинов (parse_products).

create table if not exists home_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id text,                       -- кто добавил (как в receipts)

  -- AI-распознавание
  name_ru text,                       -- «Тестер розеток»
  name_original text,                 -- «Smart Socket Tester» (как на корпусе)
  category text,                      -- «инструмент», «электрика», …
  confidence numeric,                 -- 0..1 — % схожести наименования
  brand text,                         -- «NJTY» (null, если не определён)
  brand_confidence numeric,           -- 0..1
  mpn text,                           -- «T 003» — номер производителя (null, если не читается)
  mpn_confidence numeric,             -- 0..1
  ai_model text,                      -- какой моделью распознано (gemini-2.5-flash, …)
  ai_raw jsonb,                       -- сырой ответ AI (для отладки)

  -- привязки
  receipt_id uuid,                    -- ссылка на чек покупки (receipts.id)
  photo_url text,                     -- фото предмета (bucket receipt-images, папка items/)

  -- ручная правка
  edited boolean not null default false,  -- true, если пользователь поправил поля руками
  notes text
);

create index if not exists home_items_created_idx on home_items (created_at desc);
create index if not exists home_items_user_idx on home_items (user_id);
create index if not exists home_items_brand_idx on home_items (brand);
create index if not exists home_items_mpn_idx on home_items (mpn);
create index if not exists home_items_receipt_idx on home_items (receipt_id);

-- updated_at автоматически
create or replace function home_items_touch() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

drop trigger if exists home_items_touch_trg on home_items;
create trigger home_items_touch_trg before update on home_items
  for each row execute function home_items_touch();

-- RLS: как остальные таблицы проекта — доступ через backend (service key),
-- анонимным прямым доступом не пользуемся.
alter table home_items enable row level security;

drop policy if exists home_items_service_all on home_items;
create policy home_items_service_all on home_items
  for all using (true) with check (true);
