-- Чистка кривых цен Leroy Merlin (расширение ≤1.27.2 ловило промо-блок — у сотен товаров одинаковая цена).
-- Зануляем ТОЛЬКО строки с характерной застрявшей парой цен; парсер дочитает их со страниц товаров.
-- Выполнить: Supabase → SQL Editor → Run.

-- Сначала посмотреть масштаб (SELECT):
select price, price_original, count(*) as cnt
from parse_products
where site = 'www.leroymerlin.es' and price is not null
group by price, price_original
having count(*) >= 20
order by cnt desc;

-- Если видишь одну-две пары с сотнями строк (напр. 129.99 / 216.99) — зануляем именно их:
update parse_products
set price = null, price_original = null, discount_pct = null, discount_abs = null
where site = 'www.leroymerlin.es'
  and price = 129.99 and price_original = 216.99;
