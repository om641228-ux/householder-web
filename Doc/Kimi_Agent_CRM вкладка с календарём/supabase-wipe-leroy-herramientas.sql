-- =============================================================
-- Обнуление раздела Leroy Merlin «Herramientas»
-- https://www.leroymerlin.es/productos/herramientas/
-- Запускать в Supabase → SQL Editor.
-- Шаг 1 — сначала SELECT (посмотреть, сколько строк затронет).
-- Шаг 2 — раскомментировать ОДИН из вариантов: DELETE или «мягкое» обнуление цен.
-- =============================================================

-- ШАГ 1. Предпросмотр: сколько строк в разделе
select category, count(*) as rows_cnt, min(last_seen) as oldest, max(last_seen) as newest
from parse_products
where site = 'www.leroymerlin.es'
  and (category ilike 'Herramientas%' or url like '%/productos/herramientas/%')
group by category
order by rows_cnt desc;

-- Общий итог
select count(*) as total_rows
from parse_products
where site = 'www.leroymerlin.es'
  and (category ilike 'Herramientas%' or url like '%/productos/herramientas/%');


-- ШАГ 2. ВАРИАНТ А — полное удаление раздела (расширение потом наполнит его заново чистыми ценами):
-- begin;
-- delete from parse_products
-- where site = 'www.leroymerlin.es'
--   and (category ilike 'Herramientas%' or url like '%/productos/herramientas/%');
-- commit;


-- ШАГ 2. ВАРИАНТ Б — оставить строки, но обнулить цены/скидки (история названий и ссылок сохранится):
-- begin;
-- update parse_products
-- set price = null,
--     price_original = null,
--     discount_pct = null,
--     discount_abs = null,
--     price_at = null
-- where site = 'www.leroymerlin.es'
--   and (category ilike 'Herramientas%' or url like '%/productos/herramientas/%');
-- commit;

-- Проверка после выполнения:
-- select count(*) from parse_products
-- where site = 'www.leroymerlin.es'
--   and (category ilike 'Herramientas%' or url like '%/productos/herramientas/%');
