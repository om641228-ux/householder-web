#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Локальный OCR-сервер для Receipt Manager (householder-web).

Распознаёт страницы документов ЛОКАЛЬНО на вашем Mac через Apple Vision
(бесплатно, без интернета, без API-ключей), а сервер потом только
структурирует текст в чек/фактуру.

Установка (один раз). На новых macOS (Homebrew-Python) обычный
«pip3 install ocrmac» ЗАПРЕЩЁН (ошибка PEP 668 externally-managed-environment).
Поэтому ставим в отдельное окружение venv:

    cd ~/householder-web/ocr
    python3 -m venv venv
    ./venv/bin/pip install ocrmac

Запуск (держать открытым, пока распознаёте документы):
    ./venv/bin/python mac-ocr-server.py

(Если venv не хотите — альтернатива: pip3 install --user ocrmac
 и запуск обычным python3 mac-ocr-server.py)

Проверка: открыть в браузере http://127.0.0.1:8787/ — должно быть «ok».

После запуска в веб-приложении выберите модель
«🖥 Mac OCR (локально, Vision)» на вкладке «Выбор модели».
"""

import json
import os
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

HOST = "127.0.0.1"
PORT = 8787

try:
    from ocrmac import ocrmac
except ImportError:
    print("Нужен пакет ocrmac. На macOS с Homebrew-Python ставьте так:")
    print("    python3 -m venv venv && ./venv/bin/pip install ocrmac")
    print("и запускайте:  ./venv/bin/python mac-ocr-server.py")
    print("(либо: pip3 install --user ocrmac — и обычный запуск python3)")
    sys.exit(1)

# Языки распознавания: испанский (фактуры), русский, английский
LANGS = ["es-ES", "ru-RU", "en-US"]

# Расширение временного файла — по имени загруженного файла
def ext_of(name: str) -> str:
    e = os.path.splitext(name or "")[1].lower()
    return e if e in (".jpg", ".jpeg", ".png", ".webp", ".heic", ".tif", ".tiff", ".bmp", ".pdf") else ".jpg"


def sort_annotations(annotations):
    """v52.5: Apple Vision отдаёт блоки в произвольном порядке — у двухколоночных
    фактур строки колонок перемешиваются, и LLM теряет связи метка→сумма
    (симптом: «4.75 AED», нет даты, 0 товаров). Собираем строки: группируем
    блоки по y (координаты Vision — снизу вверх), внутри строки — слева направо,
    колонки разделяем отступом."""
    items = []
    for a in annotations:
        try:
            text = a[0]
            if len(a) >= 6:
                # плоский формат: (text, confidence, x, y, w, h)
                x, y, h = float(a[2]), float(a[3]), float(a[5])
            else:
                # формат ocrmac: (text, confidence, (x, y, w, h)) — рамка вложенным кортежем
                box = a[2]
                x, y, h = float(box[0]), float(box[1]), float(box[3])
        except (IndexError, TypeError, ValueError):
            continue
        if text and str(text).strip():
            items.append((y, x, h, str(text)))
    if not items:
        return ""
    heights = sorted(t[2] for t in items)
    med = heights[len(heights) // 2] or 0.02
    thresh = max(med * 0.6, 0.005)
    items.sort(key=lambda t: -t[0])  # сверху вниз (y в Vision растёт вверх)
    lines = []
    for y, x, h, text in items:
        if lines and abs(lines[-1][0] - y) <= thresh:
            lines[-1][1].append((x, text))
        else:
            lines.append([y, [(x, text)]])
    out = []
    for _y, parts in lines:
        parts.sort(key=lambda p: p[0])  # слева направо
        out.append("   ".join(t for _, t in parts))
    return "\n".join(out)


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # v52.2: Chrome Private Network Access (preflight с https-страницы к 127.0.0.1)
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # тихий режим

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/ocr"):
            self._json(405, {"error": "Используйте POST с файлом в теле запроса"})
        else:
            self._json(200, {"status": "ok", "service": "mac-ocr-server", "port": PORT})

    def do_POST(self):
        if not self.path.startswith("/ocr"):
            self._json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                self._json(400, {"error": "пустое тело запроса"})
                return
            if length > 60 * 1024 * 1024:
                self._json(413, {"error": "файл больше 60 МБ"})
                return
            data = self.rfile.read(length)

            # имя файла — из query (?name=...), чтобы сохранить расширение (важно для PDF)
            name = "page.jpg"
            if "?" in self.path:
                from urllib.parse import urlparse, parse_qs
                qs = parse_qs(urlparse(self.path).query)
                name = (qs.get("name") or [name])[0]

            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext_of(name))
            try:
                tmp.write(data)
                tmp.close()
                annotations = ocrmac.OCR(tmp.name, language_preference=LANGS, recognition_level="accurate").recognize()
                # annotations — порядок произвольный, сортируем в порядок чтения;
                # страховка: если сортировка дала пусто (нестандартный формат блоков) — простая склейка
                text = sort_annotations(annotations)
                if not text.strip() and annotations:
                    text = "\n".join(str(a[0]) for a in annotations if a and a[0])
                self._json(200, {"text": text, "blocks": len(annotations)})
                print(f"OK  {name}: {len(annotations)} блоков, {len(text)} симв.")
            finally:
                try:
                    os.unlink(tmp.name)
                except OSError:
                    pass
        except Exception as e:
            self._json(500, {"error": str(e)})
            print(f"ERR {e}")


if __name__ == "__main__":
    print(f"mac-ocr-server слушает http://{HOST}:{PORT}  (языки: {', '.join(LANGS)})")
    print("Остановка: Ctrl+C")
    HTTPServer((HOST, PORT), Handler).serve_forever()
