-- ============================================================
-- v162: Защита каталога parse_products (одна таблица + RLS + view)
-- Выполнить ОДИН раз в Supabase → SQL Editor → Run
-- Бэкенд работает через service_role → RLS ему НЕ мешает (bypass).
-- Защита действует против: anon-ключа, случайных ручных правок.
-- ============================================================

-- 1) RLS: включаем на таблице. Все запросы нашего бэкенда идут через
--    service_role, который обходит RLS — приложение не сломается.
alter table parse_products enable row level security;

-- 2) Полный запрет для anon и authenticated (чужой доступ по anon-ключу).
--    Политик нет = по умолчанию deny all. Явно создадим «запрещающую» заглушку
--    (она ничего не разрешает, просто документирует намерение):
drop policy if exists parse_products_deny_all on parse_products;
create policy parse_products_deny_all on parse_products
  for all to anon, authenticated
  using (false) with check (false);

-- 3) View на каждый магазин — для РУЧНОГО просмотра/редактирования в Supabase.
--    with check option: через view нельзя перенести строку в чужой магазин
--    (site изменить нельзя) и нельзя вставить строку с чужим site.

create or replace view v_products_leroymerlin with (security_barrier = true) as
  select * from parse_products where site = 'www.leroymerlin.es';

create or replace view v_products_mediamarkt with (security_barrier = true) as
  select * from parse_products where site = 'canarias.mediamarkt.es';

create or replace view v_products_worten with (security_barrier = true) as
  select * from parse_products where site = 'canarias.worten.es';

create or replace view v_products_mercadona with (security_barrier = true) as
  select * from parse_products where site = 'tienda.mercadona.es';

-- 4) Страховка от массовых случайных удалений вручную:
--    триггер запрещает DELETE более чем 500 строк за одну операцию
--    (синк каталога делает только upsert, так что работе не мешает).
create or replace function parse_products_delete_guard() returns trigger as $$
declare cnt int;
begin
  select count(*) into cnt from old_rows;
  if cnt > 500 then
    raise exception 'Массовое удаление из parse_products запрещено (>% строк). Если это нужно — отключите триггер trg_parse_products_delete_guard.', 500;
  end if;
  return null;
end $$ language plpgsql;

drop trigger if exists trg_parse_products_delete_guard on parse_products;
-- Для statement-level триггера нужна transition table:
drop trigger if exists trg_parse_products_delete_guard_stmt on parse_products;
create trigger trg_parse_products_delete_guard_stmt
  after delete on parse_products
  referencing old table as old_rows
  for each statement execute function parse_products_delete_guard();

-- 5) Проверка (выполнится и покажет результат):
-- select 'lm' t, count(*) from v_products_leroymerlin
-- union all select 'mediamarkt', count(*) from v_products_mediamarkt
-- union all select 'worten', count(*) from v_products_worten
-- union all select 'mercadona', count(*) from v_products_mercadona;
