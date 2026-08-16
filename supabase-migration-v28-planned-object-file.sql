-- v28: плановые платежи — объект, фактура (householder-web)
alter table planned_payments add column if not exists object_name text;
alter table planned_payments add column if not exists file_url text;
alter table planned_payments add column if not exists file_name text;
notify pgrst, 'reload schema';
