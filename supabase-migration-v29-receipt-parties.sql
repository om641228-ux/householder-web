-- v29: стороны и краткая суть документа прямо в receipts
-- Зачем: карточки договоров/фактур/КП показывают party_a/party_b/summary;
-- раньше они жили только в детальных таблицах (contract_documents/proposals).
-- Без этой миграции бэкенд просто пропустит новые поля (filterRecordByColumns),
-- а GET /api/receipts подмешает значения из детальных таблиц для старых записей.
alter table receipts add column if not exists party_a text;
alter table receipts add column if not exists party_b text;
alter table receipts add column if not exists summary text;
