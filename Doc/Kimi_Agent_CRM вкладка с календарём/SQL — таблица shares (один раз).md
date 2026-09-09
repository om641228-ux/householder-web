# Таблица shares — выполнить ОДИН раз

Supabase → ваш проект → **SQL Editor** → New query → вставить и нажать Run:

```sql
create table shares (
  id text primary key,
  title text,
  items jsonb,
  created_by text,
  created_at timestamptz default now(),
  expires_at timestamptz
);
```

Всё. Таблица хранит публичные подборки файлов (ссылки вида `…/api/share/<id>`).
