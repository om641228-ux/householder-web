# Таблица app_users — выполнить ОДИН раз

Supabase → ваш проект → **SQL Editor** → New query → вставить и нажать Run:

```sql
create table app_users (
  id text primary key,            -- логин (латиница)
  name text,                      -- отображаемое имя
  salt text,
  pass_hash text,
  role text default 'viewer',     -- admin / manager / buchhalter / viewer
  sections jsonb,                 -- ["home","auto","personal"] или NULL = все
  objects jsonb,                  -- ["Kit","Maria",...] или NULL = все
  disabled boolean default false,
  created_at timestamptz default now()
);
```

После этого зайдите в приложение под **admin** → новая вкладка **«👥 Доступ»** →
добавьте пользователей с паролями и ролями.

⚠️ Встроенные пароли из кода (admin, user1…user10) продолжают работать.
Когда все перейдут на личные пароли — скажите, уберу встроенные из кода.
