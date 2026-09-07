-- v107: граф связей документов — выполнить один раз в Supabase SQL Editor
create table if not exists entities (
  id uuid primary key default gen_random_uuid(),
  type text not null,            -- company | person | iban | tax_id | invoice_no | contract_no | cups | meter | amount_date
  value text not null,           -- нормализованное значение
  label text,                    -- как показывать
  created_at timestamptz default now(),
  unique(type, value)
);
create table if not exists doc_entities (
  doc_id text not null,          -- id записи в receipts (text — чтобы не зависеть от типа колонки)
  entity_id uuid not null references entities(id) on delete cascade,
  role text default 'mention',   -- issuer | counterparty | subject | account | amount | mention
  primary key (doc_id, entity_id, role)
);
create table if not exists doc_links (
  id uuid primary key default gen_random_uuid(),
  doc_a text not null,
  doc_b text not null,
  link_type text not null,       -- same_counterparty | same_account | invoice_match | contract_match | same_supply | same_amount_date | ...
  confidence numeric default 1,
  evidence text,                 -- основание (значение сущности)
  created_by text default 'rule',-- rule (авто) | ai | user
  created_at timestamptz default now(),
  unique(doc_a, doc_b, link_type)
);
create index if not exists doc_entities_entity_idx on doc_entities(entity_id);
create index if not exists doc_entities_doc_idx on doc_entities(doc_id);
create index if not exists doc_links_a_idx on doc_links(doc_a);
create index if not exists doc_links_b_idx on doc_links(doc_b);
