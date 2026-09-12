# Запуск локального AI на Mac (Ollama + OCR)

## Сервисы

| Сервис | Порт | Зачем |
|---|---|---|
| Ollama (`nomic-embed-text`) | 11434 | эмбеддинги для семантического поиска (Ход 4) |
| mac-ocr-server.py | 8787 | локальный OCR ценников/фото (Apple Vision) |

Бэкенд в облаке (Railway) → каждому сервису нужен свой туннель cloudflared.

## Запуск: 4 окна терминала

### Окно 1 — Ollama
```bash
OLLAMA_HOST=0.0.0.0 ollama serve
```
Ждём `Listening on [::]:11434`.
(Один раз, в другом окне: `ollama pull nomic-embed-text`)

### Окно 2 — OCR-сервер
```bash
cd ~/ocr
./venv/bin/python mac-ocr-server.py
```
Ждём `mac-ocr-server слушает http://127.0.0.1:8787`.

### Окно 3 — туннель Ollama
```bash
cloudflared tunnel --url http://127.0.0.1:11434
```
Адрес `https://xxxx.trycloudflare.com` → в приложении: **🔬 → Ход 4 → «Адрес локального AI»**.

### Окно 4 — туннель OCR
```bash
cloudflared tunnel --url http://127.0.0.1:8787
```
Второй адрес → диалог **«Адрес Mac OCR-сервера»** в приложении.

⚠️ Не перепутать: 11434 → Ход 4 (эмбеддинги); 8787 → диалог OCR.

## Проверка

```bash
curl http://127.0.0.1:11434/api/tags | grep nomic   # Ollama
curl http://127.0.0.1:8787/                          # OCR
curl https://ОЛЛАМА-АДРЕС.trycloudflare.com/api/tags # туннель Ollama
curl https://OCR-АДРЕС.trycloudflare.com/            # туннель OCR
```

## Правила

1. Все 4 окна держать открытыми, пока работаете.
2. Перезапуск cloudflared = новый адрес → обновить в приложении.
3. «Failed to fetch» в приложении = туннель/сервис упал → перезапустить, обновить адрес.
4. Брандмауэр macOS: разрешить ollama и cloudflared при первом запросе.
