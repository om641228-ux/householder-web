-- v109: Иерархия сущностей (entity → entity)
-- belongs_to: идентификатор/реквизит (IBAN, налоговый №, № фактуры, договор, доверенность, CUPS, счётчик) → владелец (компания/персона)
-- represents: персона → представляет компанию (встретились в одном документе)
-- Выполнить ОДИН РАЗ в Supabase SQL Editor (проект householder!)

create table if not exists entity_links (
  id uuid primary key default gen_random_uuid(),
  entity_a uuid not null references entities(id) on delete cascade,
  entity_b uuid not null references entities(id) on delete cascade,
  link_type text not null,             -- belongs_to | represents
  confidence real not null default 0.8,
  evidence text,
  created_by text not null default 'rule',  -- rule | ai | user
  created_at timestamptz not null default now(),
  unique(entity_a, entity_b, link_type)
);

alter table entity_links disable row level security;

create index if not exists idx_entity_links_a on entity_links(entity_a);
create index if not exists idx_entity_links_b on entity_links(entity_b);

notify pgrst, 'reload schema';
