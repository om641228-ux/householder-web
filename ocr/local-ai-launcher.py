#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
local-ai-launcher.py — лаунчер локального AI для householder-web.
Слушает http://127.0.0.1:8790 и по кнопке из браузера (или двойному клику
по start-local-ai.command) поднимает:
  1) Ollama (OLLAMA_HOST=0.0.0.0, порт 11434)
  2) mac-ocr-server.py (порт 8787)
  3) cloudflared-туннель -> Ollama
  4) cloudflared-туннель -> OCR
и возвращает адреса туннелей JSON-ом.

Эндпоинты:
  GET  /status  -> {"ollama": true/false, "ocr": true/false, "ollama_url": ..., "ocr_url": ...}
  POST /start   -> поднять всё недостающее, вернуть {"ok": true, "ollama_url": ..., "ocr_url": ...}
"""

import json, os, re, subprocess, sys, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ====== НАСТРОЙКИ ======
# Папка лаунчера = папка с mac-ocr-server.py (положите лаунчер рядом с ним).
# Дополнительно проверяем ~/ocr на случай другого расположения.
_LAUNCHER_DIR = os.path.dirname(os.path.abspath(__file__))


def _find_ocr():
    for d in [_LAUNCHER_DIR, os.path.expanduser("~/ocr"), os.path.expanduser("~/householder-web/ocr")]:
        script = os.path.join(d, "mac-ocr-server.py")
        if os.path.exists(script):
            return d, script
    return _LAUNCHER_DIR, os.path.join(_LAUNCHER_DIR, "mac-ocr-server.py")


OCR_DIR, OCR_SCRIPT = _find_ocr()
# python из venv рядом со скриптом; если нет — системный python3
_venv_py = os.path.join(OCR_DIR, "venv", "bin", "python")
OCR_PY = _venv_py if os.path.exists(_venv_py) else "/usr/bin/env python3"
OLLAMA_PORT = 11434
OCR_PORT = 8787
LAUNCHER_PORT = 8790
LOG_DIR = os.path.join(OCR_DIR, "logs")
# ==============================================================

os.makedirs(LOG_DIR, exist_ok=True)
STATE = {"ollama_url": None, "ocr_url": None, "procs": []}
TUNNEL_RE = re.compile(r"https://[a-z0-9\-]+\.trycloudflare\.com")


def http_alive(url, timeout=3):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return 200 <= r.status < 500
    except Exception:
        return False


def ollama_up():
    return http_alive(f"http://127.0.0.1:{OLLAMA_PORT}/api/tags")


def ocr_up():
    return http_alive(f"http://127.0.0.1:{OCR_PORT}/")


def spawn(cmd, log_name, env=None):
    log = open(os.path.join(LOG_DIR, log_name), "ab", buffering=0)
    e = dict(os.environ)
    if env:
        e.update(env)
    p = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, env=e, start_new_session=True)
    STATE["procs"].append(p)
    return p, log


def start_ollama():
    if ollama_up():
        return True
    spawn(["ollama", "serve"], "ollama.log", env={"OLLAMA_HOST": "0.0.0.0"})
    for _ in range(30):
        if ollama_up():
            return True
        time.sleep(1)
    return False


def start_ocr():
    if ocr_up():
        return True
    if not os.path.exists(OCR_SCRIPT):
        return False
    if " " in OCR_PY:  # '/usr/bin/env python3'
        cmd = OCR_PY.split() + [OCR_SCRIPT]
    elif os.path.exists(OCR_PY):
        cmd = [OCR_PY, OCR_SCRIPT]
    else:
        cmd = [sys.executable, OCR_SCRIPT]
    spawn(cmd, "ocr.log")
    for _ in range(30):
        if ocr_up():
            return True
        time.sleep(1)
    return False


def start_tunnel(port, log_name, wait_sec=45):
    """Запустить cloudflared и вытащить выданный https://....trycloudflare.com из лога."""
    p, log = spawn(["cloudflared", "tunnel", "--url", f"http://127.0.0.1:{port}"], log_name)
    path = os.path.join(LOG_DIR, log_name)
    t0 = time.time()
    while time.time() - t0 < wait_sec:
        try:
            with open(path, "rb") as f:
                m = TUNNEL_RE.findall(f.read().decode("utf-8", "ignore"))
            if m:
                url = m[-1]
                if http_alive(url + "/api/tags" if port == OLLAMA_PORT else url + "/", timeout=6):
                    return url
                return url  # отдаём даже без проверки — прогрев может занять время
        except Exception:
            pass
        time.sleep(1)
    return None


def start_all():
    ok_ollama = start_ollama()
    ok_ocr = start_ocr()
    if ok_ollama and not STATE["ollama_url"]:
        STATE["ollama_url"] = start_tunnel(OLLAMA_PORT, "tunnel-ollama.log")
    if ok_ocr and not STATE["ocr_url"]:
        STATE["ocr_url"] = start_tunnel(OCR_PORT, "tunnel-ocr.log")
    return {
        "ok": bool(ok_ollama or ok_ocr),
        "ollama": ok_ollama, "ocr": ok_ocr,
        "ollama_url": STATE["ollama_url"],
        "ocr_url": STATE["ocr_url"],
        "ocr_dir": OCR_DIR, "ocr_script_found": os.path.exists(OCR_SCRIPT),
    }


class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(200, {"ok": True})

    def do_GET(self):
        if self.path.startswith("/start"):
            self._send(200, start_all())
        elif self.path.startswith("/status"):
            self._send(200, {
                "ollama": ollama_up(), "ocr": ocr_up(),
                "ollama_url": STATE["ollama_url"], "ocr_url": STATE["ocr_url"],
            })
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.startswith("/start"):
            self._send(200, start_all())  # синхронно: адреса сразу в ответе
        else:
            self._send(404, {"error": "not found"})

    def log_message(self, *a):
        pass


def watchdog():
    while True:
        time.sleep(60)
        try:
            if not ollama_up():
                start_ollama()
            if not ocr_up():
                start_ocr()
            if STATE["ollama_url"] and not http_alive(STATE["ollama_url"] + "/api/tags", timeout=8):
                STATE["ollama_url"] = None
            if STATE["ocr_url"] and not http_alive(STATE["ocr_url"] + "/", timeout=8):
                STATE["ocr_url"] = None
            if ollama_up() and not STATE["ollama_url"]:
                STATE["ollama_url"] = start_tunnel(OLLAMA_PORT, "tunnel-ollama.log")
            if ocr_up() and not STATE["ocr_url"]:
                STATE["ocr_url"] = start_tunnel(OCR_PORT, "tunnel-ocr.log")
        except Exception:
            pass


def main():
    print(f"local-ai-launcher слушает http://127.0.0.1:{LAUNCHER_PORT}")
    print("Кнопка в приложении householder-web вызовет /start.")
    print("Запускаю сервисы сразу…")
    print(json.dumps(start_all(), ensure_ascii=False, indent=2))
    threading.Thread(target=watchdog, daemon=True).start()
    print("Сторож запущен: упавшие сервисы/туннели переподнимаются автоматически.")
    print("Ctrl+C остановит только лаунчер — Ollama/OCR/туннели продолжат работать.")
    try:
        ThreadingHTTPServer(("127.0.0.1", LAUNCHER_PORT), H).serve_forever()
    except KeyboardInterrupt:
        print("\nЛаунчер остановлен. Сервисы работают в фоне. Повторный запуск подхватит их.")


if __name__ == "__main__":
    main()
