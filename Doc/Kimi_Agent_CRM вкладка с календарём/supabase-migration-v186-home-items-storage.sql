-- v186: место хранения предмета (Дубай/Тенерифе · место · стеллаж · полка) + фото/видео места хранения
-- Выполнить один раз: Supabase → SQL Editor
alter table home_items add column if not exists location_city text;   -- 'Дубай' | 'Тенерифе' | …
alter table home_items add column if not exists storage_place text;   -- место (гараж, кладовая…)
alter table home_items add column if not exists storage_rack text;    -- стеллаж
alter table home_items add column if not exists storage_shelf text;   -- полка
alter table home_items add column if not exists storage_media jsonb not null default '[]'::jsonb; -- [{url, kind:'photo'|'video', at}]
