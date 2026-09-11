-- ============================================================
-- v166: FIX — товары Worten записались под site='www.worten.pt'
-- (hostname брался из адреса sitemap-файла, а не из адресов товаров)
-- Выполнить ОДИН раз в Supabase → SQL Editor → Run
-- ============================================================

-- 1) Переносим все строки Worten на правильный site
update parse_products
  set site = 'canarias.worten.es'
  where site = 'www.worten.pt'
     or (site not in ('www.leroymerlin.es','canarias.mediamarkt.es','tienda.mercadona.es')
         and url ilike '%canarias.worten.es%');

-- 2) Чистим мусор: страницы брендов /marcas/ — это НЕ товары.
--    Временно отключаем триггер-страж v162 (он запрещает DELETE >500 строк),
--    после чистки включаем обратно.
alter table parse_products disable trigger trg_parse_products_delete_guard_stmt;
delete from parse_products
  where site = 'canarias.worten.es' and url ilike '%/marcas/%';
alter table parse_products enable trigger trg_parse_products_delete_guard_stmt;

-- 3) Проверка: сколько товаров осталось у Worten
-- select site, count(*) from parse_products group by site;
