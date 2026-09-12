# SQL — таблица activity_log (v94), выполнить ОДИН РАЗ

Supabase → SQL Editor → New query → вставить → Run:

```sql
create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  user_name text,
  section text,
  action text,
  details text,
  ip text,
  user_agent text,
  created_at timestamptz default now()
);
create index if not exists activity_log_created_idx on activity_log (created_at desc);
```

Без этого журнал не будет сохраняться (остальное приложение работать не перестанет — ошибки логирования гасятся).
