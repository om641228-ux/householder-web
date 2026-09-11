-- v143: физическая колонка с артикулами позиций чека (для индексов/поиска)
alter table receipts add column if not exists articles text[];

-- разовое заполнение из jsonb-позиций
update receipts r
set articles = sub.arts
from (
  select r2.id, array_agg(distinct a order by a) as arts
  from receipts r2,
       lateral jsonb_array_elements(coalesce(r2.items, '[]'::jsonb)) it,
       lateral (select it->>'article' as a) x
  where r2.items is not null and jsonb_typeof(r2.items) = 'array'
    and x.a ~ '^\d{4,}$'
  group by r2.id
) sub
where r.id = sub.id;

-- быстрый поиск чеков по артикулу
create index if not exists receipts_articles_gin on receipts using gin (articles);

notify pgrst, 'reload schema';
