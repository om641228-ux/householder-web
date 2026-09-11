-- ============================================================
-- v167: чистка Worten — оставить ТОЛЬКО товары (/produtos/…-NNNNNNN)
-- SEO/бренд/инфо-страницы без артикула удаляем.
-- Выполнить ОДИН раз в Supabase → SQL Editor → Run
-- ============================================================

alter table parse_products disable trigger trg_parse_products_delete_guard_stmt;

delete from parse_products
  where site = 'canarias.worten.es'
    and (article is null or url !~ '/produtos/.+-\d{5,}$');

alter table parse_products enable trigger trg_parse_products_delete_guard_stmt;

-- Проверка:
-- select count(*) as tovarov, count(article) as s_artikulom from parse_products where site = 'canarias.worten.es';
