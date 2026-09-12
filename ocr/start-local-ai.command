#!/bin/zsh
# start-local-ai.command — двойной клик: поднимает Ollama + OCR + 2 туннеля
# и держит лаунчер на 127.0.0.1:8790 для кнопки «🚀 Запустить локальный AI» в браузере.
#
# Установка один раз:
#   1) положите local-ai-launcher.py рядом с этим файлом (например в ~/ocr)
#   2) chmod +x start-local-ai.command
#   3) двойной клик по файлу

cd "$(dirname "$0")"

echo "=== Локальный AI для householder-web ==="

# проверки окружения
command -v ollama      >/dev/null || { echo "❌ нет ollama — brew install ollama"; read -k 1; exit 1; }
command -v cloudflared >/dev/null || { echo "❌ нет cloudflared — brew install cloudflared"; read -k 1; exit 1; }
[ -f local-ai-launcher.py ] || { echo "❌ local-ai-launcher.py не найден рядом со скриптом"; read -k 1; exit 1; }

# модель эмбеддингов (если ещё не скачана — скачаем после старта сервера в фоне)
(
  sleep 8
  ollama list 2>/dev/null | grep -q nomic-embed-text || ollama pull nomic-embed-text
) &

exec python3 local-ai-launcher.py
