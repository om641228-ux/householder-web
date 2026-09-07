-- Документы (v40): вкладка «Документы» — разделы Дома / Авто / Личное,
-- файлы любых типов (фото, видео, аудио, текст, PDF и др.)
-- Выполнить в SQL Editor проекта householder (Supabase).
-- attachments — массив объектов {url, kind: photo|video|audio|doc|file, name, ts, actor}

create table if not exists doc_sections (
  category     text primary key,           -- home | auto | personal
  attachments  jsonb not null default '[]',
  updated_at   timestamptz
);

insert into doc_sections (category) values ('home'), ('auto'), ('personal')
on conflict (category) do nothing;

notify pgrst, 'reload schema';
