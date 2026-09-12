-- v188: умное сравнение с каталогом
-- 1) pgvector + колонки эмбеддингов названий (каталог и предметы)
-- 2) item_feedback — обратная связь (правки полей, «не тот товар»)
-- 3) match_products — семантический поиск по каталогу
-- Выполнить один раз: Supabase → SQL Editor

create extension if not exists vector;

alter table parse_products add column if not exists name_embed vector(768);
alter table home_items    add column if not exists name_embed vector(768);

create index if not exists parse_products_name_embed_idx
  on parse_products using ivfflat (name_embed vector_cosine_ops) with (lists = 100);

create table if not exists item_feedback (
  id uuid primary key default gen_random_uuid(),
  item_id uuid,
  product_url text,
  verdict text,          -- 'good' | 'bad' | 'correction'
  field text,            -- 'name_es' | 'brand' | 'mpn' (для correction)
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);
create index if not exists item_feedback_item_idx on item_feedback (item_id, verdict);

-- семантический поиск: ближайшие товары каталога по вектору
create or replace function match_products(query_embedding vector(768), match_count int)
returns setof parse_products
language sql stable
as $$
  select * from parse_products
  where name_embed is not null
  order by name_embed <=> query_embedding
  limit match_count;
$$;
