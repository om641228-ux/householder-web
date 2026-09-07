-- Плановые платежи v44: частота (1/2/6/12 месяцев), контрагент из выписки, дата начала
-- Выполнить в SQL Editor проекта householder (Supabase).

alter table planned_payments add column if not exists freq_months integer not null default 1;
alter table planned_payments add column if not exists counterparty text;
alter table planned_payments add column if not exists start_date date;

notify pgrst, 'reload schema';
