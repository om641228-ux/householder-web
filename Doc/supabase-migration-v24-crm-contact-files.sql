-- CRM v38: файлы контакта (фото / видео / аудио / текст / PDF)
-- Выполнить в SQL Editor проекта householder (Supabase).
-- Записи — массив объектов {url, kind: photo|video|audio|doc, name, ts, actor}.

alter table crm_contacts
  add column if not exists attachments jsonb not null default '[]';

notify pgrst, 'reload schema';
