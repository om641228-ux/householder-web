-- v136: цена без скидки + скидка (%, абсолют) для parse_products
alter table parse_products
  add column if not exists price_original numeric,
  add column if not exists discount_pct numeric,
  add column if not exists discount_abs numeric;
notify pgrst, 'reload schema';
