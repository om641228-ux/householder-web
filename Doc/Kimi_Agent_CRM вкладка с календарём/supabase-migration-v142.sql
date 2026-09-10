-- v142: артикул магазина в позициях чеков.
-- Колонка НЕ нужна: позиции хранятся в receipts.items (jsonb), поле article
-- сохраняется внутри JSON автоматически при новых распознаваниях.
-- Этот VIEW — для удобного просмотра/фильтрации артикулов прямо в Supabase:
create or replace view receipts_items as
select
  r.id as receipt_id,
  r.store_name,
  r.receipt_date,
  it->>'article' as article,
  it->>'name' as name,
  it->>'name_ru' as name_ru,
  nullif(it->>'quantity','')::numeric as quantity,
  nullif(it->>'price','')::numeric as price,
  nullif(it->>'total','')::numeric as total
from receipts r
cross join lateral jsonb_array_elements(coalesce(r.items, '[]'::jsonb)) it
where r.items is not null and jsonb_typeof(r.items) = 'array';
