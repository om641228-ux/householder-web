-- Плановые платежи (v41): ручные записи в календаре обязательных платежей
-- (коммуналка, страховка, телефон, интернет, уборка, бассейн и т.п.)
-- Выполнить в SQL Editor проекта householder (Supabase).

create table if not exists planned_payments (
  id           bigserial primary key,
  owner_id     text,
  title        text not null,
  category     text,              -- utilities | insurance | phone | internet | cleaning | pool | other
  amount       numeric,
  day_of_month integer,           -- ожидаемый день месяца (1..31)
  note         text,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

notify pgrst, 'reload schema';
