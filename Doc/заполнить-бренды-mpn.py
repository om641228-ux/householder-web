#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Локальное распознавание бренда и оригинального номера производителя (MPN)
в выгруженном каталоге. Работает полностью офлайн, ничего не отправляет в сеть.

Логика (2 прохода):
  Проход 1 — берёт каждый бренд из справочника и ищет его в строке товара
             (слово целиком, сначала самые длинные названия). Совпало → столбец «Производитель».
  Проход 2 — второй раз проходит строку и выделяет оригинальный номер производителя:
             кандидаты — токены рядом с брендом (буквы+цифры, коды в скобках и т.п.);
             единицы измерения (710W, 18V), размеры (40x40) и артикул Leroy отсекаются.
             Если для бренда есть примеры формата (файл «бренды-mpn-примеры.csv»
             или самообучение по уже заполненным строкам) — выбирается кандидат
             с похожей «формой» (буква/цифра/дефис).

Запуск (Mac/ПК, нужен python3):
  python3 заполнить-бренды-mpn.py каталог.csv бренды.csv [бренды-mpn-примеры.csv]

Результат: рядом появится файл «каталог-с-брендами.csv» + статистика в консоль.
Колонки каталога: Фото;Товар;Артикул;Производитель;Номер производителя;Раздел;Цена;...
"""

import csv, re, sys, os, collections

# ---------- утилиты ----------

def read_csv(path):
    with open(path, encoding='utf-8-sig', newline='') as f:
        rows = list(csv.reader(f, delimiter=';'))
    if not rows:
        raise SystemExit('Пустой файл: ' + path)
    return rows[0], rows[1:]

def canon_brand(b):
    """BLACK+DECKER оставляем, METABO -> Metabo."""
    b = b.strip()
    if b.isupper() and len(b) > 3 and not re.search(r'[+&]', b):
        return b.capitalize()
    return b

def shape(token):
    """«Форма» токена: буква->A, цифра->9, прочее как есть. GBH2-26 -> AAA9-99."""
    return re.sub(r'[0-9]', '9', re.sub(r'[A-Za-z]', 'A', token))

UNITS = re.compile(r'^\d+([.,]\d+)?(w|kw|v|a|mah|ah|l|ml|cl|mm|cm|m|kg|g|hz|db|rpm|bar|lm|k|°c|%)$', re.I)
DIM = re.compile(r'^\d+([.,]\d+)?([xх×*]\d+([.,]\d+)?)+$')          # 40x40, 11x15.8x11
PARENS = re.compile(r'\(([A-Za-z0-9][A-Za-z0-9./\- ]{2,24})\)')

def tokenize(name):
    return re.findall(r'[A-Za-z0-9][A-Za-z0-9./\-]*', name)

def mpn_candidates(name, brand=None, article=None):
    """Кандидаты в MPN: (токен, позиция_токена, источник)."""
    out = []
    toks = tokenize(name)
    # 1) код в скобках — самый надёжный
    for m in PARENS.finditer(name):
        t = m.group(1).strip()
        if re.search(r'\d', t) and not UNITS.match(t) and not DIM.match(t):
            out.append((t, -100, 'скобки', 0))
    brand_pos = None
    if brand:
        low = [t.lower() for t in toks]
        for i, t in enumerate(low):
            if t == brand.lower() or t.startswith(brand.lower() + '-'):
                brand_pos = i
                break
    for i, t in enumerate(toks):
        if UNITS.match(t) or DIM.match(t):
            continue
        if article and t == article:
            continue
        has_d = bool(re.search(r'\d', t))
        has_l = bool(re.search(r'[A-Za-z]', t))
        near = brand_pos is not None and 0 <= i - brand_pos <= 5
        if has_d and has_l and len(t) >= 3:                       # GBH2-26, ML915, DHP453
            out.append((t, 0 if near else 10, 'буквы+цифры', 0))
        elif has_d and not has_l and 5 <= len(t) <= 9 and near:   # чисто цифры сразу после бренда
            out.append((t, 5, 'цифры-после-бренда', 0))
    # пары соседних токенов «БУКВЫ + цифры»: GBH 2-26, ML 915, K 5, iD 60
    for i in range(len(toks) - 1):
        a, b = toks[i], toks[i + 1]
        if not re.fullmatch(r'[A-Za-z]{1,8}', a):
            continue
        if UNITS.match(b) or DIM.match(b) or not re.search(r'\d', b):
            continue
        if article and b == article:
            continue
        near = brand_pos is not None and 0 <= i - brand_pos <= 5
        pen = 0
        # цифра — начало размера («Oscuro 38 5x14x49») или единицы — это не номер
        if i + 2 < len(toks) and (DIM.match(toks[i + 2]) or UNITS.match(toks[i + 2])) and len(re.sub(r'\D', '', b)) <= 2:
            pen = -40
        out.append((a + ' ' + b, -5 if near else 8, 'пара', pen))
    return out

# ---------- загрузка ----------

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        raise SystemExit(1)
    cat_path, brands_path = sys.argv[1], sys.argv[2]
    examples_path = sys.argv[3] if len(sys.argv) > 3 else None

    head, rows = read_csv(cat_path)
    try:
        i_name = head.index('Товар'); i_brand = head.index('Производитель')
        i_mpn = head.index('Номер производителя'); i_art = head.index('Артикул')
    except ValueError:
        raise SystemExit('В файле каталога нет нужных колонок: ' + '; '.join(head))

    b_head, b_rows = read_csv(brands_path)
    brands = sorted({canon_brand(r[0]) for r in b_rows if r and r[0].strip()},
                    key=len, reverse=True)  # сначала длинные (Black+Decker раньше Black)
    print(f'Справочник: {len(brands)} брендов · товаров в файле: {len(rows)}')

    # примеры форматов MPN по брендам: из файла-примера + самообучение по заполненным строкам
    ex_shapes = collections.defaultdict(set)   # brand -> {форма}
    if examples_path and os.path.exists(examples_path):
        e_head, e_rows = read_csv(examples_path)
        for r in e_rows:
            if len(r) >= 2 and r[0].strip() and r[1].strip():
                ex_shapes[r[0].strip().lower()].add(shape(r[1].strip()))
        print(f'Файл примеров: {sum(len(v) for v in ex_shapes.values())} форм для {len(ex_shapes)} брендов')
    learned = 0
    for r in rows:
        if len(r) > i_mpn and r[i_brand].strip() and r[i_mpn].strip():
            sh = shape(r[i_mpn].strip())
            if sh not in ex_shapes[r[i_brand].strip().lower()]:
                ex_shapes[r[i_brand].strip().lower()].add(sh)
                learned += 1
    if learned:
        print(f'Самообучение по каталогу: +{learned} форм из уже заполненных строк')

    # ---------- проход 1: бренд ----------
    brand_re = [(b, re.compile(r'(?<![\w])' + re.escape(b) + r'(?![\w])', re.I)) for b in brands]
    n_brand = 0
    for r in rows:
        if len(r) <= i_name or r[i_brand].strip():
            continue
        name = r[i_name]
        for b, rx in brand_re:
            if rx.search(name[:70]):
                r[i_brand] = b
                n_brand += 1
                break

    # ---------- проход 2: MPN ----------
    n_mpn = 0
    for r in rows:
        if len(r) <= i_name or r[i_mpn].strip() or not r[i_brand].strip():
            continue
        brand = r[i_brand].strip()
        cands = mpn_candidates(r[i_name], brand=brand, article=(r[i_art].strip() or None))
        if not cands:
            continue
        shapes = ex_shapes.get(brand.lower(), set())
        def score(c):
            tok, pos, kind, pen = c
            sc = -pos + pen
            if shapes:
                if shape(tok) in shapes:
                    sc += 50                   # форма как в примерах бренда
                else:
                    sc -= 20                   # форма чужая для этого бренда
            if kind == 'скобки':
                sc += 20
            if re.search(r'[A-Za-z]', tok) and re.search(r'\d', tok):
                sc += 5
            return sc
        best = max(cands, key=score)
        if score(best) <= 0:                   # нет уверенного кандидата — оставляем пустым
            continue
        r[i_mpn] = best[0]
        n_mpn += 1
        sh = shape(best[0])                    # дообучение
        ex_shapes[brand.lower()].add(sh)

    # ---------- сохранение ----------
    base, ext = os.path.splitext(cat_path)
    out_path = base + '-с-брендами' + (ext or '.csv')
    with open(out_path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f, delimiter=';')
        w.writerow(head)
        w.writerows(rows)

    print('—' * 50)
    print(f'✅ Бренд проставлен:      {n_brand} товаров')
    print(f'✅ Номер производителя:   {n_mpn} товаров')
    print(f'📄 Результат: {out_path}')
    print('Совет: откройте файл в Excel, проверьте 10–20 строк;')
    print('строки, где бренд/номер не найдены, остались пустыми — дополните')
    print('файл «бренды-mpn-примеры.csv» и запустите скрипт ещё раз.')

if __name__ == '__main__':
    main()
