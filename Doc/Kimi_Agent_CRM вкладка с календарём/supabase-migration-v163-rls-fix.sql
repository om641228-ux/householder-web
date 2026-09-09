-- ============================================================
-- v163: FIX — RLS блокировал upsert бэкенда
-- («new row violates row-level security policy for table parse_products»)
-- Выполнить ОДИН раз в Supabase → SQL Editor → Run
-- ============================================================

-- 1) Убираем запрещающую политику v162
drop policy if exists parse_products_deny_all on parse_products;

-- 2) Разрешаем приложению полный доступ (как было до v162).
--    RLS остаётся ВКЛЮЧЁННЫМ — если позже захотите ужесточить доступ,
--    достаточно заменить эти политики, приложение не трогаем.
drop policy if exists parse_products_app_all on parse_products;
create policy parse_products_app_all on parse_products
  for all to anon, authenticated, service_role
  using (true) with check (true);

-- 3) View по магазинам и триггер-страж из v162 остаются в силе.
--    Если v162 не выполнялась — выполните сначала её (view и триггер),
--    потом этот файл. Проверка:
-- select 'lm' t, count(*) from v_products_leroymerlin
-- union all select 'mediamarkt', count(*) from v_products_mediamarkt
-- union all select 'worten', count(*) from v_products_worten
-- union all select 'mercadona', count(*) from v_products_mercadona;
