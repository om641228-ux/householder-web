# Receipt Manager Backend

Node.js/Express API для распознавания чеков через AI.

## Запуск локально

```bash
npm install
npm run dev
```

## Переменные окружения

Скопируйте `.env.example` в `.env` и заполните:

```bash
cp .env.example .env
```

## Деплой на Railway

1. Подключите репозиторий к Railway
2. Добавьте переменные окружения из `.env.example`
3. Railway автоматически запустит `npm start`

## API Endpoints

- `POST /api/login` - авторизация
- `POST /api/upload` - загрузка чека
- `GET /api/receipts` - список чеков
- `POST /api/export-excel` - экспорт в Excel
- `POST /api/reprocess-receipt` - перераспознавание
