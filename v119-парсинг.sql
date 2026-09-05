-- v119: Парсинг сайтов — источники и результаты
create table if not exists parse_sources (
  id uuid primary key default gen_random_uuid(),
  name text,
  url text not null,
  site text,
  robots_ok boolean,
  robots_note text,
  created_at timestamptz default now()
);

create table if not exists parse_results (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references parse_sources(id) on delete cascade,
  url text,
  title text,
  price numeric,
  currency text,
  image text,
  data jsonb,
  fetched_at timestamptz default now()
);

create index if not exists parse_results_source_idx on parse_results (source_id, fetched_at desc);

-- v119.1: тип источника и фильтр для sitemap
alter table parse_sources add column if not exists kind text default 'page';
alter table parse_sources add column if not exists filter text;

-- v120: автозапуск и отслеживание цены
alter table parse_sources add column if not exists auto_every_hours int default 0;
alter table parse_sources add column if not exists last_run_at timestamptz;
alter table parse_sources add column if not exists last_price numeric;
alter table parse_sources add column if not exists last_change text;

-- v121: каталог товаров из sitemap
create table if not exists parse_products (
  id uuid primary key default gen_random_uuid(),
  site text not null,
  url text not null,
  name text,
  image text,
  price numeric,
  currency text,
  price_at timestamptz,
  first_seen timestamptz default now(),
  last_seen timestamptz default now(),
  unique (site, url)
);
create index if not exists parse_products_name_idx on parse_products (name text_pattern_ops);

-- v122: артикулы и источник цены
alter table parse_products add column if not exists article text;
alter table parse_products add column if not exists price_source text;
create index if not exists parse_products_article_idx on parse_products (article);

-- v123: AI-оценка цены хранится ОТДЕЛЬНО от факта
alter table parse_products add column if not exists price_estimate numeric;
alter table parse_products add column if not exists price_estimate_at timestamptz;

-- v124: история изменения цены (для 📈📉)
alter table parse_products add column if not exists price_prev numeric;
alter table parse_products add column if not exists price_changed_at timestamptz;

-- v124.1: учёт неудачных попыток снятия цены (чтобы очередь не зацикливалась)
alter table parse_products add column if not exists price_attempts integer default 0;
alter table parse_products add column if not exists price_attempt_at timestamptz;
alter table parse_products add column if not exists price_fail_reason text;

-- v126: путь раздела товара (дерево каталога как на сайте)
alter table parse_products add column if not exists category text;
create index if not exists parse_products_category_idx on parse_products (category text_pattern_ops);

-- v128: производитель и оригинальный номер производителя (MPN)
alter table parse_products add column if not exists brand text;
alter table parse_products add column if not exists mpn text;
