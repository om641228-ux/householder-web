#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Локальный AI (Ollama) для выделения БРЕНДА и ОРИГИНАЛЬНОГО НОМЕРА производителя
в выгруженном каталоге. Всё работает на вашем компьютере, ничего не уходит в сеть.

УСТАНОВКА (один раз, Mac):
  1) Установите Ollama:  https://ollama.com/download  (или: brew install ollama)
  2) В Терминале:        ollama pull qwen2.5:7b-instruct
     (слабый Mac — поставьте qwen2.5:3b-instruct, он легче)
  3) Ollama должен быть запущен (иконка в меню-баре или: ollama serve)

ЗАПУСК:
  python3 ai-бренды-mpn.py каталог.csv бренды.csv
  python3 ai-бренды-mpn.py каталог.csv бренды.csv --model qwen2.5:3b-instruct
  python3 ai-бренды-mpn.py каталог.csv бренды.csv --all     # перезаполнить даже заполненные

РЕЗУЛЬТАТ: «каталог-ai.csv» рядом + файл «новые-бренды.csv» (бренды, которых нет
в справочнике — добавьте их в справочник, если они настоящие).

ЛОГИКА:
  - AI получает пачку из 10 названий + список брендов справочника и возвращает JSON
    {бренд, mpn} для каждого. Бренд проверяется по справочнику (точно/нечётко).
  - MPN — это модель/артикул ПРОИЗВОДИТЕЛЯ (GBH 2-26, DHP453, UP2500), НЕ 8-значный
    артикул Leroy и НЕ характеристики (710W, 18V, 40x40).
  - Прогресс печатается в консоль; при прерывании просто запустите снова —
    уже заполненные строки пропускаются (если не задан --all).
"""

import csv, re, sys, os, json, time, urllib.request, urllib.error

OLLAMA = os.environ.get('OLLAMA_URL', 'http://localhost:11434')
MODEL = 'qwen2.5:7b-instruct'
BATCH = 10

PROMPT = """Eres un experto en catálogos de ferretería. Para cada nombre de producto extrae:
- "brand": la MARCA del fabricante (no el tipo de producto, no "Leroy Merlin"). Si coincide con una de la LISTA DE MARCAS, escríbela EXACTAMENTE como en la lista. Si la marca no está en la lista pero es claramente una marca real, escríbela igualmente. Si no hay marca, null.
- "mpn": el código/modelo del FABRICANTE (ej: "GBH 2-26", "DHP453", "UP2500", "TC-PG 55/E5"). NO es el artículo de 8 dígitos de Leroy, NO son características (vatios 710W, voltios 18V, dimensiones 40x40, capacidad 30Ah). Si no hay código claro, null.

LISTA DE MARCAS: {brands}
{hints}
Responde SOLO con JSON: {{"items": [{{"i": 0, "brand": "...", "mpn": "..."}}, ...]}}

PRODUCTOS:
{products}"""


def read_csv(path):
    with open(path, encoding='utf-8-sig', newline='') as f:
        rows = list(csv.reader(f, delimiter=';'))
    if not rows:
        raise SystemExit('Пустой файл: ' + path)
    return rows[0], rows[1:]


def norm(s):
    return re.sub(r'[^a-z0-9]+', '', (s or '').lower())


def match_brand(b, brand_map):
    """Точное/нечёткое совпадение со справочником. Возвращает (канон, is_new)."""
    if not b:
        return None, False
    if b in brand_map:
        return brand_map[b], False
    nb = norm(b)
    if nb in brand_map:
        return brand_map[nb], False
    for k, v in brand_map.items():
        nk = norm(k)
        if nk and (nk in nb or nb in nk) and min(len(nk), len(nb)) >= 4:
            return v, False
    return b.strip()[:80], True


def clean_mpn(m, article):
    if not m:
        return ''
    m = str(m).strip().strip('.,;:()')[:80]
    if not m or not re.search(r'\d', m):
        return ''
    if article and norm(m) == norm(article):
        return ''
    if re.fullmatch(r'\d{5,9}', m):        # чистые цифры = артикул магазина, не производителя
        return ''
    if re.fullmatch(r'\d+([.,]\d+)?\s*(w|kw|v|a|mah|ah|l|ml|mm|cm|m|kg|g|hz|db|bar|lm|kwh|mbar)', m, re.I):
        return ''
    if re.fullmatch(r'\d+([xх×*]\d+)+', m):  # размеры
        return ''
    return m


def ai_batch(products, brands_list, model, hint_map=None):
    plines = '\n'.join(f'{i}. {t}' for i, t in enumerate(products))
    # подсказки форматов только для брендов, реально встречающихся в пачке
    hints = ''
    if hint_map:
        found = []
        low = ' \n '.join(t.lower() for t in products)
        for b, (fmt, exs) in hint_map.items():
            if re.search(r'(?<![a-z0-9])' + re.escape(b.lower()) + r'(?![a-z0-9])', low):
                found.append(f'{b} — {fmt}: ' + ', '.join(exs[:4]))
        if found:
            hints = 'FORMATOS DE REFERENCIA DEL FABRICANTE (ayuda para mpn):\n' + '\n'.join(found[:12])
    prompt = PROMPT.replace('{brands}', ', '.join(brands_list)).replace('{products}', plines).replace('{hints}', hints)
    body = json.dumps({
        'model': model, 'prompt': prompt, 'stream': False, 'format': 'json',
        'options': {'temperature': 0, 'num_predict': 1200},
    }).encode('utf-8')
    req = urllib.request.Request(OLLAMA + '/api/generate', data=body,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=300) as r:
        resp = json.loads(r.read().decode('utf-8'))
    txt = resp.get('response', '')
    m = re.search(r'\{.*\}', txt, re.S)
    data = json.loads(m.group(0)) if m else {}
    out = {}
    for it in data.get('items', []):
        try:
            out[int(it.get('i'))] = (it.get('brand'), it.get('mpn'))
        except Exception:
            pass
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    redo_all = '--all' in sys.argv
    model = MODEL
    if '--model' in sys.argv:
        model = sys.argv[sys.argv.index('--model') + 1]
    if len(args) < 2:
        print(__doc__)
        raise SystemExit(1)
    cat_path, brands_path = args[0], args[1]

    # проверка Ollama
    try:
        with urllib.request.urlopen(OLLAMA + '/api/tags', timeout=5) as r:
            tags = json.loads(r.read().decode('utf-8'))
        have = [m.get('name', '') for m in tags.get('models', [])]
        if not any(h.startswith(model.split(':')[0]) for h in have):
            print(f'⚠ Модель {model} не найдена. Выполните: ollama pull {model}')
            print('  Установлены:', ', '.join(have) or 'ничего')
            raise SystemExit(1)
    except (urllib.error.URLError, OSError):
        print('❌ Ollama не отвечает на ' + OLLAMA)
        print('   Установите: https://ollama.com/download  →  ollama pull ' + model)
        print('   и запустите Ollama (иконка в меню-баре).')
        raise SystemExit(1)

    head, rows = read_csv(cat_path)
    i_name = head.index('Товар'); i_brand = head.index('Производитель')
    i_mpn = head.index('Номер производителя'); i_art = head.index('Артикул')

    _, b_rows = read_csv(brands_path)
    hint_map = {}
    examples_path = args[2] if len(args) > 2 else None
    if examples_path and os.path.exists(examples_path):
        e_head, e_rows = read_csv(examples_path)
        ex_from = 3 if len(e_head) > 3 and 'Пример' in e_head[3] else 1
        for r in e_rows:
            if not r or not r[0].strip():
                continue
            fmt = r[2].strip() if len(r) > 2 else ''
            exs = []
            for cell in r[ex_from:]:
                for ex in cell.split(';'):
                    ex = ex.strip()
                    if ex and re.search(r'\d', ex) and '-001' not in ex:
                        exs.append(ex)
            if exs:
                hint_map[r[0].strip()] = (fmt, exs)
        print(f'Файл форматов: {len(hint_map)} брендов с примерами номеров')

    brands_list = sorted({r[0].strip() for r in b_rows if r and r[0].strip()})
    brand_map = {}
    for b in brands_list:
        brand_map[b] = b
        brand_map[b.lower()] = b
        brand_map[norm(b)] = b
    print(f'Справочник: {len(brands_list)} брендов · модель: {model}')

    # очередь необработанных строк
    todo = [i for i, r in enumerate(rows)
            if len(r) > i_mpn and r[i_name].strip()
            and (redo_all or not r[i_brand].strip() or not r[i_mpn].strip())]
    print(f'К обработке AI: {len(todo)} строк из {len(rows)} (уже заполненные пропускаю)')

    new_brands = {}
    done = 0
    t0 = time.time()
    for off in range(0, len(todo), BATCH):
        idxs = todo[off:off + BATCH]
        titles = [rows[i][i_name][:160] for i in idxs]
        try:
            res = ai_batch(titles, brands_list, model, hint_map)
        except Exception as e:
            print(f'  ⚠ пачка {off // BATCH + 1}: {e} — пропускаю')
            continue
        for j, i in enumerate(idxs):
            r = rows[i]
            brand, mpn = res.get(j, (None, None))
            canon, is_new = match_brand(brand, brand_map) if brand else (None, False)
            if canon:
                r[i_brand] = canon
                if is_new:
                    new_brands.setdefault(canon, r[i_name][:80])
            mp = clean_mpn(mpn, r[i_art].strip())
            if mp and canon:
                r[i_mpn] = mp
            done += 1
        dt = time.time() - t0
        speed = done / dt if dt else 0
        eta = (len(todo) - done) / speed if speed else 0
        print(f'  ✓ {done}/{len(todo)} · {speed:.1f} стр/с · осталось ~{int(eta // 60)}:{int(eta % 60):02d}')

    base, ext = os.path.splitext(cat_path)
    out_path = base + '-ai.csv'
    with open(out_path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f, delimiter=';')
        w.writerow(head)
        w.writerows(rows)

    nb = sum(1 for r in rows if len(r) > i_brand and r[i_brand].strip())
    nm = sum(1 for r in rows if len(r) > i_mpn and r[i_mpn].strip())
    print('—' * 50)
    print(f'✅ Бренд заполнен: {nb}/{len(rows)} · MPN заполнен: {nm}/{len(rows)}')
    print(f'📄 Результат: {out_path}')
    if new_brands:
        nb_path = base + '-новые-бренды.csv'
        with open(nb_path, 'w', encoding='utf-8-sig', newline='') as f:
            w = csv.writer(f, delimiter=';')
            w.writerow(['Бренд', 'Пример товара'])
            for b, ex in sorted(new_brands.items()):
                w.writerow([b, ex])
        print(f'🆕 Бренды вне справочника ({len(new_brands)}): {nb_path} — проверьте и добавьте в справочник')


if __name__ == '__main__':
    main()
