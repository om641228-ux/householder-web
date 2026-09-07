-- ============================================================
-- Householder v32 (миграция v21): CRM — контрагенты, контакты,
-- задачи с таймлайном исполнения и подтверждением закрытия
-- ============================================================
-- ⚠️ ВАЖНО: выполняй в SQL Editor ТОЛЬКО проекта householder!
-- Проверь: Railway → householder-api → Variables → SUPABASE_URL
-- должен совпадать с URL проекта, где запускаешь этот SQL.
-- ============================================================
-- Модель статусов задачи (совпадает с фронтендом, вкладка «🤝 CRM»):
--   open            — в работе
--   pending_confirm — исполнитель отметил «✅ Выполнена», ждёт постановщика
--   closed          — постановщик подтвердил закрытие («👍»)
-- Возврат «↩ На доработку»: pending_confirm → open (событие 'returned' в timeline).
-- timeline — jsonb-массив событий: [{ts, actor, action, note}],
--   action: created | edited | comment | done | confirmed | returned
-- ============================================================

-- 1) Контрагенты (компании)
create table if not exists crm_counterparties (
  id          bigserial primary key,
  owner_id    text,
  name        text not null,
  type        text not null default 'client',  -- client | supplier | partner | other
  phone       text,
  email       text,
  address     text,
  comment     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

-- 2) Контакты (персоны, привязаны к контрагенту; при удалении контрагента — отвязываются)
create table if not exists crm_contacts (
  id              bigserial primary key,
  owner_id        text,
  counterparty_id bigint references crm_counterparties(id) on delete set null,
  name            text not null,
  position        text,
  phone           text,
  email           text,
  comment         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

-- 3) Задачи (задания исполнителям с подтверждением закрытия постановщиком)
create table if not exists crm_tasks (
  id              bigserial primary key,
  owner_id        text,
  title           text not null,
  description     text,
  counterparty_id bigint references crm_counterparties(id) on delete set null,
  contact_id      bigint references crm_contacts(id) on delete set null,
  assignee        text,                        -- исполнитель (пусто = закрыть может любой)
  created_by      text,                        -- постановщик (подтверждает закрытие)
  due_date        date,                        -- срок исполнения (календарь)
  priority        text not null default 'normal',  -- high | normal | low
  status          text not null default 'open',    -- open | pending_confirm | closed
  done_at         timestamptz,                 -- когда исполнитель отметил выполненной
  closed_at       timestamptz,                 -- когда постановщик подтвердил закрытие
  timeline        jsonb not null default '[]'::jsonb,  -- таймлайн исполнения
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

-- Индексы под типовые запросы вкладки CRM
create index if not exists crm_counterparties_owner_idx on crm_counterparties (owner_id);
create index if not exists crm_contacts_owner_idx        on crm_contacts (owner_id);
create index if not exists crm_contacts_cp_idx           on crm_contacts (counterparty_id);
create index if not exists crm_tasks_owner_status_idx    on crm_tasks (owner_id, status);
create index if not exists crm_tasks_due_date_idx        on crm_tasks (due_date);
create index if not exists crm_tasks_cp_idx              on crm_tasks (counterparty_id);

-- 4) Обновить кэш схемы PostgREST (иначе "Could not find the table ... in the schema cache")
notify pgrst, 'reload schema';

-- 5) Проверка (должно вернуть 3 таблицы = true и список ключевых колонок crm_tasks)
select t.table_name as check_item, true as ok
from information_schema.tables t
where t.table_schema = 'public'
  and t.table_name in ('crm_counterparties', 'crm_contacts', 'crm_tasks')
union all
select c.table_name || '.' || c.column_name, true
from information_schema.columns c
where c.table_name = 'crm_tasks'
  and c.column_name in ('assignee', 'created_by', 'due_date', 'priority', 'status', 'done_at', 'closed_at', 'timeline')
order by 1;
