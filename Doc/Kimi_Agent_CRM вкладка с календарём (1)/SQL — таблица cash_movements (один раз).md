# SQL для вкладки Cash (выполнить один раз)

Supabase → SQL Editor → New query → вставить → Run:

```sql
create table cash_movements (
  id uuid primary key default gen_random_uuid(),
  owner_id text,
  operation_date date,
  counterparty text,
  concept text,
  amount numeric default 0,
  receipt_ids jsonb,
  note text,
  created_at timestamptz default now()
);
```

Cash — отдельная структура (наличные движения), НЕ связана с банковскими выписками и налогами.
`receipt_ids` — массив id привязанных фактур (jsonb), `amount` со знаком: минус = расход, плюс = приход.
