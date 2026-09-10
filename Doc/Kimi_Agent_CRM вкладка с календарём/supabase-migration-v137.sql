-- v137: журнал парсинга разделов
create table if not exists parse_logs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  site text,
  url text,
  category text,
  total int default 0,
  with_photo int default 0,
  with_brand int default 0,
  with_mpn int default 0,
  with_price int default 0,
  sent int default 0
);
alter table parse_logs disable row level security;
create index if not exists parse_logs_created_idx on parse_logs (created_at desc);
notify pgrst, 'reload schema';
