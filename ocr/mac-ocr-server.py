#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Локальный OCR-сервер для Receipt Manager (householder-web).

Распознаёт страницы документов ЛОКАЛЬНО на вашем Mac через Apple Vision
(бесплатно, без интернета, без API-ключей), а сервер потом только
структурирует текст в чек/фактуру.

Установка (один раз):
    pip3 install ocrmac

Запуск (держать открытым, пока распознаёте документы):
    python3 mac-ocr-server.py

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
    print("Нужен пакет ocrmac. Установите:  pip3 install ocrmac")
    sys.exit(1)

# Языки распознавания: испанский (фактуры), русский, английский
LANGS = ["es-ES", "ru-RU", "en-US"]

# Расширение временного файла — по имени загруженного файла
def ext_of(name: str) -> str:
    e = os.path.splitext(name or "")[1].lower()
    return e if e in (".jpg", ".jpeg", ".png", ".webp", ".heic", ".tif", ".tiff", ".bmp", ".pdf") else ".jpg"


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

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
                # annotations: [(text, confidence, x, y, w, h), ...]
                text = "\n".join(a[0] for a in annotations if a and a[0])
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
