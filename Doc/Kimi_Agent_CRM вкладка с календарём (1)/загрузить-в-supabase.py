#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Загрузка заполненного AI-файла (бренд + оригинальный номер) в Supabase.
Референс — АРТИКУЛ Leroy: по нему находится товар в parse_products и
обновляются колонки brand и mpn.

ПОДГОТОВКА (один раз):
  1) Supabase → Project Settings → API → скопируйте:
     - Project URL  (https://xxxx.supabase.co)
     - service_role key (secret! не anon)
  2) В Терминале:
     export SUPABASE_URL="https://xxxx.supabase.co"
     export SUPABASE_KEY="service_role_ключ"

ЗАПУСК:
  python3 загрузить-в-supabase.py каталог-ai.csv
  python3 загрузить-в-supabase.py каталог-ai.csv --site www.leroymerlin.es

ЛОГИКА:
  - читает CSV (колонки «Артикул», «Производитель», «Номер производителя»);
  - пачками по 100 артикулов находит товары в parse_products;
  - обновляет brand/mpn только если значение изменилось;
  - печатает прогресс и итог: найдено / обновлено / не найдено.
"""

import csv, json, os, re, sys, time, urllib.request, urllib.error, urllib.parse

SITE_DEFAULT = 'www.leroymerlin.es'


def read_csv(path):
    with open(path, encoding='utf-8-sig', newline='') as f:
        rows = list(csv.reader(f, delimiter=';'))
    if not rows:
        raise SystemExit('Пустой файл: ' + path)
    return rows[0], rows[1:]


class Supa:
    def __init__(self, url, key):
        self.url = url.rstrip('/') + '/rest/v1'
        self.key = key

    def _req(self, method, path, body=None):
        req = urllib.request.Request(self.url + path, method=method,
                                     data=json.dumps(body).encode('utf-8') if body is not None else None,
                                     headers={'apikey': self.key, 'Authorization': 'Bearer ' + self.key,
                                              'Content-Type': 'application/json',
                                              'Prefer': 'return=minimal'})
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode('utf-8')
        return json.loads(raw) if raw else None

    def find_by_articles(self, site, arts):
        q = urllib.parse.quote(','.join(arts))
        return self._req('GET', f'/parse_products?select=id,article,brand,mpn&site=eq.{urllib.parse.quote(site)}&article=in.({q})')

    def update(self, pid, upd):
        self._req('PATCH', f'/parse_products?id=eq.{pid}', upd)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    site = SITE_DEFAULT
    if '--site' in sys.argv:
        site = sys.argv[sys.argv.index('--site') + 1]
    if not args:
        print(__doc__)
        raise SystemExit(1)
    url = os.environ.get('SUPABASE_URL', '').strip()
    key = os.environ.get('SUPABASE_KEY', '').strip()
    if not url or not key:
        print('❌ Задайте SUPABASE_URL и SUPABASE_KEY (service_role):')
        print('   export SUPABASE_URL="https://xxxx.supabase.co"')
        print('   export SUPABASE_KEY="…"')
        raise SystemExit(1)

    head, rows = read_csv(args[0])
    try:
        iA = head.index('Артикул'); iB = head.index('Производитель'); iM = head.index('Номер производителя')
    except ValueError:
        raise SystemExit('В файле нет колонок «Артикул», «Производитель», «Номер производителя». Найдены: ' + '; '.join(head))

    by_art = {}
    for r in rows:
        if len(r) <= max(iA, iB, iM):
            continue
        art = r[iA].strip()
        if not re.fullmatch(r'\d{4,}', art):
            continue
        brand, mpn = r[iB].strip()[:120], r[iM].strip()[:120]
        if brand or mpn:
            by_art[art] = (brand, mpn)
    arts = list(by_art)
    print(f'Строк с данными: {len(arts)} · сайт: {site}')

    supa = Supa(url, key)
    matched = updated = 0
    t0 = time.time()
    for off in range(0, len(arts), 100):
        chunk = arts[off:off + 100]
        try:
            found = supa.find_by_articles(site, chunk)
        except urllib.error.HTTPError as e:
            print('❌ Ошибка Supabase:', e.code, e.read().decode('utf-8')[:300])
            raise SystemExit(1)
        for p in found:
            matched += 1
            brand, mpn = by_art[p['article']]
            upd = {}
            if brand and brand != (p.get('brand') or ''):
                upd['brand'] = brand
            if mpn and mpn != (p.get('mpn') or ''):
                upd['mpn'] = mpn
            if upd:
                supa.update(p['id'], upd)
                updated += 1
        done = min(off + 100, len(arts))
        print(f'  ✓ {done}/{len(arts)} · найдено {matched} · обновлено {updated}')

    print('—' * 50)
    print(f'✅ Готово за {int(time.time() - t0)} с')
    print(f'   Артикулов в файле:  {len(arts)}')
    print(f'   Найдено в базе:     {matched}')
    print(f'   Обновлено бренд/MPN:{updated}')
    print(f'   Не найдено:         {len(arts) - matched}')


if __name__ == '__main__':
    main()
