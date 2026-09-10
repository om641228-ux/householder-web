-- v111.1 (FIX): Изолированные области графа (scopes)
-- Исправление: системная область «Все документы» с нулевым id создаётся ДО внешнего ключа.
-- Идемпотентно — можно выполнять поверх неудачного запуска v111.
-- Выполнить ЦЕЛИКОМ в Supabase SQL Editor (проект householder!)

create table if not exists graph_scopes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  filter jsonb not null default '{}'::jsonb,   -- {objects:[], docTypes:[], excludeNames:[], ibans:[]}
  created_at timestamptz not null default now()
);
alter table graph_scopes disable row level security;

-- Системная область «Все документы» (обязательна ПЕРЕД добавлением FK)
insert into graph_scopes (id, name, filter)
values ('00000000-0000-0000-0000-000000000000', 'Все документы', '{}'::jsonb)
on conflict (id) do nothing;

-- entities: та же сущность может существовать в разных областях
alter table entities add column if not exists scope_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table entities drop constraint if exists entities_scope_id_fkey;
alter table entities add constraint entities_scope_id_fkey
  foreign key (scope_id) references graph_scopes(id) on delete cascade;
alter table entities drop constraint if exists entities_type_value_key;
create unique index if not exists entities_type_value_scope_uidx on entities(type, value, scope_id);

-- doc_entities
alter table doc_entities add column if not exists scope_id uuid not null default '00000000-0000-0000-0000-000000000000';
create index if not exists idx_doc_entities_scope on doc_entities(scope_id);

-- doc_links: одна пара может существовать в разных областях
alter table doc_links add column if not exists scope_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table doc_links drop constraint if exists doc_links_doc_a_doc_b_link_type_key;
create unique index if not exists doc_links_pair_scope_uidx on doc_links(doc_a, doc_b, link_type, scope_id);
create index if not exists idx_doc_links_scope on doc_links(scope_id);

-- entity_links (иерархия)
alter table entity_links add column if not exists scope_id uuid not null default '00000000-0000-0000-0000-000000000000';
alter table entity_links drop constraint if exists entity_links_entity_a_entity_b_link_type_key;
create unique index if not exists entity_links_pair_scope_uidx on entity_links(entity_a, entity_b, link_type, scope_id);

notify pgrst, 'reload schema';
