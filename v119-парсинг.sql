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
