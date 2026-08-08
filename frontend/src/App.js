import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import { Capacitor, registerPlugin } from '@capacitor/core';

const API_URL = 'https://householder-api-production.up.railway.app';
// Локальный OCR (Unlimited-OCR на llama-server пользователя): браузер обращается к нему
// НАПРЯМУЮ — сервер и браузер на одном ноутбуке. localhost для браузера — доверенный
// контекст, поэтому запросы с HTTPS-сайта на http://127.0.0.1 разрешены.
// Порядок: 8081 = uocr-proxy.py (добавляет CORS/Private-Network-Access заголовки,
// которых нет у llama-server — без них Chrome/Safari блокируют fetch), 8080 = напрямую.
// Если браузер режет и это (Safari/Chrome блокируют HTTP с HTTPS-страницы даже на
// 127.0.0.1) — пользователь поднимает HTTPS-туннель (cloudflared → прокси :8081) и
// вставляет его URL через ⚙ рядом с кнопкой (хранится в localStorage 'localOcrUrl')
const LOCAL_OCR_FALLBACK_URLS = ['http://127.0.0.1:8081', 'http://127.0.0.1:8080'];

// Запасной список объектов на случай недоступности API (основной источник — GET /api/objects)
const DEFAULT_OBJECTS = ['other', 'Duqe', 'Maria', 'Kit', 'Dubai', 'Tich', 'Иссера', 'Игорь', 'Лиза', 'Алехандро'];
// Подтипы услуг/документов (счета, страховки, договоры)
const SUBTYPE_LABELS = {
  electricity: '⚡ Электричество',
  water: '💧 Вода',
  gas: '🔥 Газ',
  internet: '🌐 Интернет',
  phone: '📱 Связь',
  comunidad: '🏢 Комунидад',
  rent: '🏠 Аренда',
  waste: '🗑️ Мусор',
  insurance_home: '🏠 Страховка дома',
  insurance_car: '🚗 Страховка авто',
  insurance_health: '➕ Страховка здоровья',
  tax: '💰 Налог',
  other: '📎 Прочее'
};
// Статус оплаты документа (ручное поле, AI не определяет): to_pay / paid / underpaid
// short — компактная метка для значка в правом верхнем углу карточки
const PAYMENT_STATUS_META = {
  to_pay: { label: '🟠 К оплате', short: '🟠', color: '#e67e22', bg: '#fdf2e3' },
  paid: { label: '🟢 Оплачено', short: '🟢', color: '#27ae60', bg: '#e8f8ef' },
  underpaid: { label: '🔴 Недоплачено', short: '🔴', color: '#e74c3c', bg: '#fdecea' }
};
// Срок действия документа: null — нет даты/всё хорошо; иначе бейдж предупреждения.
// Только страховки и договоры: у счетов (bill) и выписок (bank) valid_to — это конец ПЕРИОДА, а не срок действия
function expiryInfo(r) {
  if (!r || !r.valid_to) return null;
  if (!['insurance', 'contract'].includes(r.document_type)) return null;
  const days = Math.ceil((new Date(r.valid_to).getTime() - Date.now()) / 86400000);
  if (isNaN(days)) return null;
  if (days < 0) return { text: '⛔ Истёк', color: '#c0392b' };
  if (days <= 30) return { text: `⚠️ Истекает через ${days} дн.`, color: '#e67e22' };
  return null;
}
// Типы домашних документов: чек, фактура, счёт/квитанция, страховка, банк, договор, прочее
const DOC_TYPE_LABELS = {
  receipt: '🧾 Чек',
  invoice: '📄 Фактура',
  bill: '🧮 Счёт',
  insurance: '🛡️ Страховка',
  bank: '🏦 Банк',
  contract: '📑 Договор',
  municipality: '🏛️ Мэрия',
  tax: '💰 Налоговая',
  proposal: '🤝 Комм. предложение',
  other: '📎 Другое'
};
const ITEMS_PER_PAGE_OPTIONS = [10, 20, 50, 'all'];
const MAX_FILE_SIZE_MB = 2;
const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

// ========== НАЛОГИ (вкладка «Налоги», v30): календарь, справочник, шаблоны форм ==========
// Профиль: autónomo/арендодатель на Тенерифе (Канары) → IGIC вместо IVA (modelo 420 вместо 303).
// Календарь дедлайнов (месяц/день окончания срока; январские — года СЛЕДУЮЩЕГО за отчётным)
const TAX_CALENDAR = [
  { id: '420-1T', form: '420', name: 'Modelo 420 — IGIC, 1 квартал', period: '1T', deadline: { m: 4, d: 20 }, what: 'Автоликвидация IGIC за янв–март: IGIC с продаж минус IGIC с покупок. Подаётся даже без деятельности («sin actividad»).' },
  { id: '130-1T', form: '130', name: 'Modelo 130 — IRPF, 1 квартал', period: '1T', deadline: { m: 4, d: 20 }, what: 'Платёж подоходного 20% от прибыли (доходы − расходы) за янв–март.' },
  { id: '115-1T', form: '115', name: 'Modelo 115 — retenciones alquiler, 1T', period: '1T', deadline: { m: 4, d: 20 }, what: 'Удержания 19% с аренды офиса/помещения (если арендуете).', optional: true },
  { id: '111-1T', form: '111', name: 'Modelo 111 — retenciones trabajadores, 1T', period: '1T', deadline: { m: 4, d: 20 }, what: 'Удержания с зарплат работников/профессионалов (если есть).', optional: true },
  { id: '420-2T', form: '420', name: 'Modelo 420 — IGIC, 2 квартал', period: '2T', deadline: { m: 7, d: 20 }, what: 'Автоликвидация IGIC за апр–июнь.' },
  { id: '130-2T', form: '130', name: 'Modelo 130 — IRPF, 2 квартал', period: '2T', deadline: { m: 7, d: 20 }, what: 'Платёж IRPF 20% от накопленной прибыли за янв–июнь минус предыдущие платежи.' },
  { id: '115-2T', form: '115', name: 'Modelo 115 — retenciones alquiler, 2T', period: '2T', deadline: { m: 7, d: 20 }, what: 'Удержания с аренды за апр–июнь.', optional: true },
  { id: '111-2T', form: '111', name: 'Modelo 111 — retenciones trabajadores, 2T', period: '2T', deadline: { m: 7, d: 20 }, what: 'Удержания с зарплат за апр–июнь.', optional: true },
  { id: '420-3T', form: '420', name: 'Modelo 420 — IGIC, 3 квартал', period: '3T', deadline: { m: 10, d: 20 }, what: 'Автоликвидация IGIC за июль–сент.' },
  { id: '130-3T', form: '130', name: 'Modelo 130 — IRPF, 3 квартал', period: '3T', deadline: { m: 10, d: 20 }, what: 'Платёж IRPF 20% от накопленной прибыли за янв–сент минус предыдущие платежи.' },
  { id: '115-3T', form: '115', name: 'Modelo 115 — retenciones alquiler, 3T', period: '3T', deadline: { m: 10, d: 20 }, what: 'Удержания с аренды за июль–сент.', optional: true },
  { id: '111-3T', form: '111', name: 'Modelo 111 — retenciones trabajadores, 3T', period: '3T', deadline: { m: 10, d: 20 }, what: 'Удержания с зарплат за июль–сент.', optional: true },
  { id: '420-4T', form: '420', name: 'Modelo 420 — IGIC, 4 квартал', period: '4T', deadline: { m: 1, d: 30 }, nextYear: true, what: 'Автоликвидация IGIC за окт–дек (срок до 30 января следующего года).' },
  { id: '130-4T', form: '130', name: 'Modelo 130 — IRPF, 4 квартал', period: '4T', deadline: { m: 1, d: 30 }, nextYear: true, what: 'Платёж IRPF за весь год минус предыдущие платежи (до 30 января).' },
  { id: '115-4T', form: '115', name: 'Modelo 115 — retenciones alquiler, 4T', period: '4T', deadline: { m: 1, d: 20 }, nextYear: true, what: 'Удержания с аренды за окт–дек.', optional: true },
  { id: '111-4T', form: '111', name: 'Modelo 111 — retenciones trabajadores, 4T', period: '4T', deadline: { m: 1, d: 20 }, nextYear: true, what: 'Удержания с зарплат за окт–дек.', optional: true },
  { id: '190-year', form: '190', name: 'Modelo 190 — resumen anual retenciones', period: 'AÑO', deadline: { m: 1, d: 31 }, nextYear: true, what: 'Годовая сводка удержаний по modelo 111 (если подавали 111).', optional: true },
  { id: '180-year', form: '180', name: 'Modelo 180 — resumen anual alquileres', period: 'AÑO', deadline: { m: 1, d: 31 }, nextYear: true, what: 'Годовая сводка удержаний по modelo 115 (если подавали 115).', optional: true },
  { id: '100-year', form: '100', name: 'Modelo 100 — Renta (IRPF anual)', period: 'AÑO', deadline: { m: 6, d: 30 }, what: 'Годовая декларация подоходного за прошлый год: все доходы, вычеты, зачёт платежей modelo 130.' },
];

// Справочник: какие налоги и какие документы подавать (Канары / Тенерифе)
const TAX_GUIDE = [
  { form: '420', title: 'IGIC — Modelo 420', color: '#8e44ad',
    who: 'Все autónomo/empresas на Канарах (аналог IVA modelo 303 на материке).',
    what: 'Ежеквартальная автоликвидация: IGIC devengado (с ваших продаж/аренды, обычно 7%) минус IGIC deducible (с покупок для деятельности). Разница — к оплате или к компенсации.',
    docs: 'Книга facturas emitidas и recibidas за квартал: базы и cuotas по каждому типу IGIC (0%, 3%, 5%, 7%…). Наши черновики заполняются из банка и фактур автоматически.',
    when: '1–20 апр / 1–20 июл / 1–20 окт / до 30 янв (4T).',
    url: 'https://www3.gobiernodecanarias.org/tributos/atc/w/modelo-420-versiones-programa-de-ayuda' },
  { form: '130', title: 'IRPF — Modelo 130 (pagos fraccionados)', color: '#c0392b',
    who: 'Autónomo с деятельностью (аренда жилья посуточно/долгосрочная — тоже).',
    what: 'Ежеквартальный аванс подоходного: 20% от накопленной прибыли (ingresos − gastos deducibles) минус уже уплаченные авансы года.',
    docs: 'Сумма доходов и подтверждённых расходов нарастающим итогом с 1 января. Расход подтверждён = платёж из банка + фактура (галка «есть фактура» на вкладке).',
    when: '1–20 апр / 1–20 июл / 1–20 окт / до 30 янв (4T).',
    url: 'https://sede.agenciatributaria.gob.es/Sede/ayuda/consultas-informaticas/presentacion-declaraciones-ayuda-tecnica/modelo-130.html' },
  { form: '100', title: 'Renta — Modelo 100 (IRPF anual)', color: '#16a085',
    who: 'Все резиденты Испании с доходами.',
    what: 'Годовая декларация: все доходы (аренда, деятельность), вычеты, зачёт авансов modelo 130.',
    docs: 'Годовые итоги доходов/расходов, certificados de retenciones, данные по недвижимости.',
    when: 'Апрель — 30 июня следующего года.',
    url: 'https://sede.agenciatributaria.gob.es/Sede/ayuda/consultas-informaticas/renta-ayuda-tecnica/copia-declaracion/obtencion-copia-consulta-declaraciones-presentadas-renta.html' },
  { form: '115', title: 'Retenciones alquiler — Modelo 115 (+190/180)', color: '#d35400',
    who: 'Если арендуете офис/помещение у испанского арендодателя.',
    what: 'Удерживаете 19% с арендной платы и платите в AEAT ежеквартально; Modelo 180 — годовая сводка (до 31 янв).',
    docs: 'Фактуры аренды с выделенной retención.',
    when: 'До 20 числа апр/июл/окт/янв; сводка 180 — до 31 янв.',
    url: 'https://sede.agenciatributaria.gob.es/Sede/modelos-digitales.html' },
  { form: '111', title: 'Retenciones trabajadores — Modelo 111 (+190)', color: '#2c3e50',
    who: 'Если есть работники или платите profesionales (фактура с retención).',
    what: 'Удержания IRPF с зарплат/гонораров ежеквартально; Modelo 190 — годовая сводка (до 31 янв).',
    docs: 'Номины/фактуры с retención.',
    when: 'До 20 числа апр/июл/окт/янв; сводка 190 — до 31 янв.',
    url: 'https://sede.agenciatributaria.gob.es/Sede/modelos-digitales.html' },
  { form: '036', title: 'Alta/censo — Modelo 036 (Канары: 400)', color: '#7f8c8d',
    who: 'При постановке на учёт, смене режима, baja.',
    what: 'Заявление об alta/baja деятельности; на Канарах по IGIC — modelo 400 (ATC).',
    docs: 'NIF/NIE, описание деятельности (epígrafe IAE).',
    when: 'Разово при изменениях.',
    url: 'https://sede.agenciatributaria.gob.es/Sede/modelos-digitales.html' },
];

// Шаблоны форм: бланк-черновик и ПРИМЕР ЗАПОЛНЕНИЯ (официальные формы с 2020-х — только
// электронные в sede electrónica; наш .txt — помощник для переноса цифр в веб-форму)
const TAX_FORM_TEMPLATES = {
  '420': {
    blank: `МОДЕЛО 420 — IGIC (Канары) — БЛАНК-ЧЕРНОВИК НА РУССКОМ
============================================================
Год (Ejercicio): ______        Квартал (Período): 1T / 2T / 3T / 4T
NIF/NIE: ____________  Фамилия и имя: ________________________

IGIC НАЧИСЛЕННЫЙ (с ваших продаж/аренды за квартал):
  Casilla 01 — Налоговая база (Base imponible, тип ___%): __________ ,__
  Casilla 06 — Сумма налога (Cuota = база × тип):         __________ ,__
  Casilla 11 — Всего начислено (Total devengado):         __________ ,__

IGIC К ВЫЧЕТУ (покупки для деятельности, с фактурами):
  Casilla 12 — IGIC по покупкам (Cuotas soportadas):      __________ ,__
  Casilla 17 — Всего к вычету (Total a deducir):          __________ ,__

РЕЗУЛЬТАТ:
  Casilla 18 — Разница (11 − 17):                         __________ ,__
  Casilla 19 — Зачёт прошлых периодов (Compensación):     __________ ,__
  Casilla 20 — Итог декларации (Resultado):               __________ ,__
  → К ОПЛАТЕ (a ingresar) / к зачёту / к возврату: ______ ,__

Подача: электронный кабинет ATC (сертификат / Cl@ve):
https://sede.gobiernodecanarias.org/sede-atc/`,
    example: `МОДЕЛО 420 — ПРИМЕР ЗАПОЛНЕНИЯ (выдуманные цифры!)
============================================================
Год: 2026                     Квартал: 2T
NIF: Y1234567X  Имя: ALEJANDRO RODRIGUEZ

Ситуация: за апр–июнь получено аренды 12 000,00 € (IGIC 7%),
куплено мебели/ремонт с фактурами на 3 000,00 € + IGIC 210,00 €.

IGIC НАЧИСЛЕННЫЙ:
  Casilla 01 — Налоговая база (тип 7%):    12 000,00
  Casilla 06 — Сумма налога (12 000 × 7%):    840,00
  Casilla 11 — Всего начислено:               840,00

IGIC К ВЫЧЕТУ:
  Casilla 12 — IGIC по покупкам:              210,00
  Casilla 17 — Всего к вычету:                210,00

РЕЗУЛЬТАТ:
  Casilla 18 — Разница:                       630,00
  Casilla 19 — Зачёт прошлых периодов:          0,00
  Casilla 20 — Итог:                            630,00
  → К ОПЛАТЕ: 630,00 € (списание с IBAN или NRC через банк)` },
  '130': {
    blank: `МОДЕЛО 130 — ПОДОХОДНЫЙ, АВАНСОВЫЙ ПЛАТЁЖ — БЛАНК НА РУССКОМ
============================================================
Год: ______   Квартал: 1T / 2T / 3T / 4T
NIF/NIE: ____________  Имя: ____________________

(суммы НАРАСТАЮЩИМ ИТОГОМ с 1 января!)
  Casilla 01 — Доходы (Ingresos computables):            __________ ,__
  Casilla 02 — Расходы к вычету (Gastos deducibles):     __________ ,__
  Casilla 03 — Чистая прибыль (01 − 02):                 __________ ,__
  Casilla 04 — 20% от casilla 03:                        __________ ,__
  Casilla 05 — Уже уплаченные авансы года + удержания:   __________ ,__
  Casilla 07 — Результат (04 − 05):                      __________ ,__
  → К ОПЛАТЕ (если 07 > 0):                              __________ ,__

Подача: sede AEAT (сертификат / Cl@ve)`,
    example: `МОДЕЛО 130 — ПРИМЕР ЗАПОЛНЕНИЯ (выдуманные цифры!)
============================================================
Год: 2026   Квартал: 2T (нарастающий итог янв–июнь)
NIF: Y1234567X  Имя: ALEJANDRO RODRIGUEZ

Янв–июнь: доходы от аренды 24 000,00 €; подтверждённые
расходы (платежи банка с фактурами) 9 500,00 €.
В 1T уже уплачено 400,00 €.

  Casilla 01 — Доходы:              24 000,00
  Casilla 02 — Расходы:              9 500,00
  Casilla 03 — Чистая прибыль:      14 500,00
  Casilla 04 — 20%:                  2 900,00
  Casilla 05 — Авансы прошлых кв.:     400,00
  Casilla 07 — Результат:            2 500,00
  → К ОПЛАТЕ: 2 500,00 €` },
  '100': { blank: `МОДЕЛО 100 — ГОДОВАЯ ДЕКЛАРАЦИЯ (Renta) — ЧЕК-ЛИСТ НА РУССКОМ
============================================================
Год: ______ (подаётся апрель–июнь следующего года)
1. Доход от деятельности: доходы года − расходы года
   (переносится из modelo 130 за 4T, casilla 03).
2. Авансовые платежи (modelo 130, сумма 4 платежей): ______ ,__
3. Доход от недвижимости (если сдаёте как физлицо):
   аренда − расходы (IBI, comunidad, ремонт, проценты
   ипотеки, амортизация 3%).
4. Удержания (certificados de retenciones): ______ ,__
5. Вычеты автономии (Канары): по правилам года.
Подача: Renta WEB в sede AEAT.`,
    example: `МОДЕЛО 100 — ПРИМЕР (выдуманные цифры!)
============================================================
Год 2025: доходы аренды 48 000,00, расходы 18 000,00.
База: 30 000,00. Налог по шкале (~24%): 7 200,00
Авансы modelo 130 за год: 6 000,00
→ К ОПЛАТЕ по Renta: 1 200,00 (или меньше с вычетами)` },
  '115': { blank: `МОДЕЛО 115 — УДЕРЖАНИЯ С АРЕНДЫ — БЛАНК НА РУССКОМ
============================================================
Квартал: __T   Год: ______
  Casilla 01 — Кол-во арендодателей: ____
  Casilla 02 — База удержания (аренда без IGIC):  ______ ,__
  Casilla 03 — Удержано 19% (02 × 0,19):          ______ ,__
  → К ОПЛАТЕ: casilla 03.`,
    example: `МОДЕЛО 115 — ПРИМЕР (выдуманные цифры!)
============================================================
2T 2026: аренда офиса 500 €/мес → база 1 500,00
  Casilla 01 — Арендодателей: 1
  Casilla 02 — База: 1 500,00
  Casilla 03 — 19%: 285,00
  → К ОПЛАТЕ: 285,00 €` },
  '111': { blank: `МОДЕЛО 111 — УДЕРЖАНИЯ С ЗАРПЛАТ — БЛАНК НА РУССКОМ
============================================================
Квартал: __T   Год: ______
  Casilla 01 — Работники: ____ чел.  База: ______ ,__  Удержано: ____ ,__
  Casilla 02 — Профессионалы: ____ чел. База: ____ ,__  Удержано: ____ ,__
  → К ОПЛАТЕ: сумма удержаний.`,
    example: `МОДЕЛО 111 — ПРИМЕР (выдуманные цифры!)
============================================================
2T 2026: зарплата работника 1 200 €/мес, удержание 10%.
  Casilla 01 — Работники: 1  База: 3 600,00  Удержано: 360,00
  → К ОПЛАТЕ: 360,00 €` },
  '036': { blank: `МОДЕЛО 036 / 400 (Канары) — ПОСТАНОВКА НА УЧЁТ — ЧЕК-ЛИСТ
============================================================
□ Alta: NIF/NIE, код деятельности (epígrafe IAE), дата начала, адрес.
□ Baja/изменение: что меняется, дата.
□ Канары, IGIC: modelo 400 в ATC.`,
    example: `МОДЕЛО 036 — ПРИМЕР
============================================================
Постановка как арендодатель жилья: epígrafe 861.1
«Alquiler de viviendas», дата начала 01/02/2026.` },
};

// Скачивание текстового файла (бланк/пример/черновик формы)
function downloadTextFile(filename, text) {
  const blob = new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// Excel-стиль фильтр: поиск, чекбоксы со "(Выделить все)", Применить/Очистить
// selected = [] означает "без фильтра" (показаны все значения)
function ExcelFilter({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [temp, setTemp] = useState([]);
  const [autoApply, setAutoApply] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      setAlignRight(r.left + 260 > window.innerWidth);
    }
  }, [open]);

  const allValues = options.map(o => o.value);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => {
    if (open) { setTemp(selected.length ? [...selected] : [...allValues]); setSearch(''); }
  }, [open]);

  const commit = (vals) => {
    onChange((vals.length === 0 || vals.length === allValues.length) ? [] : vals);
  };

  const toggleVal = (v) => {
    const next = temp.includes(v) ? temp.filter(x => x !== v) : [...temp, v];
    setTemp(next);
    if (autoApply) commit(next);
  };

  const toggleAll = () => {
    const next = temp.length === allValues.length ? [] : [...allValues];
    setTemp(next);
    if (autoApply) commit(next);
  };

  const visible = options.filter(o => String(o.label).toLowerCase().includes(search.toLowerCase()));
  const active = selected.length > 0;

  const cb = (checked) => (
    <span style={{
      width: 16, height: 16, borderRadius: 3, flexShrink: 0, marginRight: 8,
      border: checked ? '2px solid #2e7d32' : '2px solid #bbb',
      background: checked ? '#2e7d32' : '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: 1, boxSizing: 'border-box'
    }}>{checked ? '✓' : ''}</span>
  );

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen(!open)} style={{
        padding: '6px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
        border: active ? '2px solid #2e7d32' : '1px solid #ccc',
        background: active ? '#e8f5e9' : '#fff',
        color: active ? '#2e7d32' : '#333', fontWeight: active ? 600 : 400,
        whiteSpace: 'nowrap'
      }}>
        {label}{active ? ` (${selected.length})` : ''} ▾
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)',
          left: alignRight ? 'auto' : 0, right: alignRight ? 0 : 'auto',
          zIndex: 1500,
          background: '#fff', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
          padding: 10, width: 240, maxWidth: '92vw', border: '1px solid #e0e0e0',
          overflow: 'hidden', boxSizing: 'border-box'
        }}>
          <input
            type="text" placeholder="Поиск..." value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }}
          />
          <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 6 }}>
            <div onClick={toggleAll} style={{ display: 'flex', alignItems: 'center', padding: '5px 4px', cursor: 'pointer', fontSize: 13, fontWeight: 600, borderBottom: '1px solid #eee', marginBottom: 2 }}>
              {cb(temp.length === allValues.length && allValues.length > 0)}
              (Выделить все)
            </div>
            {visible.map(o => (
              <div key={String(o.value)} onClick={() => toggleVal(o.value)}
                style={{ display: 'flex', alignItems: 'center', padding: '5px 4px', cursor: 'pointer', fontSize: 13, borderRadius: 4 }}
                onMouseEnter={e => e.currentTarget.style.background = '#f5f5f5'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                {cb(temp.includes(o.value))}
                {o.label}
              </div>
            ))}
            {visible.length === 0 && <div style={{ padding: 8, fontSize: 12, color: '#999' }}>Ничего не найдено</div>}
          </div>
          <div
            onClick={() => { const v = !autoApply; setAutoApply(v); if (v) commit(temp); }}
            style={{ display: 'flex', alignItems: 'center', padding: '6px 4px', cursor: 'pointer', fontSize: 12, color: '#666', borderTop: '1px solid #eee', whiteSpace: 'nowrap', overflow: 'hidden' }}
            title="Применять фильтр сразу при выборе">
            {cb(autoApply)}
            Авто-применение
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button onClick={() => { commit(temp); setOpen(false); }}
              style={{ flex: 1, minWidth: 0, padding: '7px 4px', borderRadius: 6, border: 'none', background: '#2e7d32', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Применить
            </button>
            <button onClick={() => { commit([]); setOpen(false); }}
              style={{ flex: 1, minWidth: 0, padding: '7px 4px', borderRadius: 6, border: '1px solid #ccc', background: '#fff', color: '#555', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Очистить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const fixImageUrl = (url) => {
  if (!url) return null;
  return url.replace(/^http:\/\//, 'https://');
};

const FALLBACK_MODELS = [
  { name: 'ocrspace-engine1', displayName: 'OCR.space Engine 1 (Basic)', provider: 'OCR.space' },
  { name: 'ocrspace-engine2', displayName: 'OCR.space Engine 2 (Advanced)', provider: 'OCR.space' },
  { name: 'ocrspace-engine3', displayName: 'OCR.space Engine 3 (Handwriting)', provider: 'OCR.space' },
  { name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', provider: 'Gemini' },
  { name: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', provider: 'Gemini' },
  { name: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', provider: 'Gemini' },
  { name: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro Preview', provider: 'Gemini' },
  { name: 'gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash Lite', provider: 'Gemini' },
  { name: 'gemini-3-flash-preview', displayName: 'Gemini 3 Flash Preview', provider: 'Gemini' },
  { name: 'gemini-3-pro-image', displayName: 'Gemini 3 Pro Image', provider: 'Gemini' },
  { name: 'gemini-3.1-flash-image', displayName: 'Gemini 3.1 Flash Image', provider: 'Gemini' },
  { name: 'gemini-flash-latest', displayName: 'Gemini Flash Latest', provider: 'Gemini' },
  { name: 'gemini-pro-latest', displayName: 'Gemini Pro Latest', provider: 'Gemini' },
  { name: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash', provider: 'Gemini' },
  { name: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', provider: 'Gemini' },
  { name: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', provider: 'Gemini' },
  { name: 'gemini-2.0-flash-lite', displayName: 'Gemini 2.0 Flash Lite', provider: 'Gemini' },
  // Снятые Groq с поддержки (decommissioned) модели llama-4-scout/maverick и 3.2-vision удалены из списка — не выбирать мёртвое
  { name: 'groq-qwen3.6-27b', displayName: 'Groq Qwen3.6 27B', provider: 'Groq' },
  { name: 'groq-llama-3.3-70b', displayName: 'Groq Llama 3.3 70B', provider: 'Groq' },
  { name: 'groq-compound', displayName: 'Groq Compound', provider: 'Groq' },
  { name: 'groq-compound-mini', displayName: 'Groq Compound Mini', provider: 'Groq' },
  { name: 'groq-allam-2-7b', displayName: 'Groq Allam 2 7B', provider: 'Groq' },
  { name: 'groq-llama-3.1-8b', displayName: 'Groq Llama 3.1 8B', provider: 'Groq' },
  { name: 'groq-llama-prompt-guard-2-22m', displayName: 'Groq Prompt Guard 2 22M', provider: 'Groq' },
  { name: 'groq-llama-prompt-guard-2-86m', displayName: 'Groq Prompt Guard 2 86M', provider: 'Groq' },
  { name: 'groq-gpt-oss-120b', displayName: 'Groq GPT-OSS 120B', provider: 'Groq' },
  { name: 'groq-gpt-oss-20b', displayName: 'Groq GPT-OSS 20B', provider: 'Groq' },
  { name: 'groq-gpt-oss-safeguard-20b', displayName: 'Groq GPT-OSS Safeguard 20B', provider: 'Groq' },
  { name: 'groq-qwen3-32b', displayName: 'Groq Qwen3 32B', provider: 'Groq' },
  { name: 'openrouter-google/gemma-4-26b-a4b-it:free', displayName: 'Gemma 4 26B (Free)', provider: 'OpenRouter' },
  { name: 'openrouter-qwen/qwen2.5-vl-32b-instruct:free', displayName: 'Qwen 2.5 VL 32B (Free)', provider: 'OpenRouter' },
  { name: 'openrouter-qwen/qwen2.5-vl-72b-instruct:free', displayName: 'Qwen 2.5 VL 72B (Free)', provider: 'OpenRouter' },
  { name: 'github-openai/gpt-4o-mini', displayName: 'GPT-4o mini (GitHub)', provider: 'GitHub' },
  { name: 'github-openai/gpt-4o', displayName: 'GPT-4o (GitHub)', provider: 'GitHub' },
  { name: 'github-meta/Llama-4-Scout-17B-16E-Instruct', displayName: 'Llama 4 Scout (GitHub)', provider: 'GitHub' },
  { name: 'mistral-mistral-small-latest', displayName: 'Mistral Small Latest', provider: 'Mistral' },
  { name: 'mistral-pixtral-12b-2409', displayName: 'Pixtral 12B (legacy)', provider: 'Mistral' },
  { name: 'kimi-kimi-k3', displayName: 'Kimi K3', provider: 'Kimi' },
  { name: 'kimi-kimi-k2.6', displayName: 'Kimi K2.6', provider: 'Kimi' },
  { name: 'kimi-moonshot-v1-8k-vision-preview', displayName: 'Kimi Vision 8K (legacy)', provider: 'Kimi' },
  { name: 'kimi-moonshot-v1-128k-vision-preview', displayName: 'Kimi Vision 128K (legacy)', provider: 'Kimi' },
];

// ========== PDF SUPPORT: конвертация страниц PDF в изображения (pdf.js по CDN) ==========
let pdfjsLoading = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfjsLoading) return pdfjsLoading;
  pdfjsLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error('Не удалось загрузить PDF.js — проверьте интернет'));
    document.head.appendChild(script);
  });
  return pdfjsLoading;
}

const isPdfFile = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
const isPdfUrl = (url) => /\.pdf(\?|$)/i.test(url || '');

// Текст одной страницы из raw_text / raw_text_ru (формат «══════ СТРАНИЦА N из M ══════»)
function extractRawPage(rawText, pageNum) {
  if (!rawText) return '';
  const re = /═{2,}\s*СТРАНИЦА\s+(\d+)\s+из\s+\d+\s*═{2,}/gi;
  const marks = [];
  let m;
  while ((m = re.exec(rawText)) !== null) {
    marks.push({ page: parseInt(m[1], 10), start: re.lastIndex, markStart: m.index });
  }
  for (let i = 0; i < marks.length; i++) {
    if (marks[i].page === pageNum) {
      const end = i + 1 < marks.length ? marks[i + 1].markStart : rawText.length;
      return rawText.slice(marks[i].start, end).trim();
    }
  }
  return '';
}

async function convertPdfToImages(pdfFile, onProgress) {
  const pdfjsLib = await loadPdfJs();
  const data = await pdfFile.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const baseName = (pdfFile.name || 'document').replace(/\.pdf$/i, '');
  const out = [];
  // До 60 страниц = лимит бэкенда upload.array('pages', 60); раньше было 10 — длинные договоры обрезались
  const maxPages = Math.min(pdf.numPages, 60);
  for (let p = 1; p <= maxPages; p++) {
    if (onProgress) onProgress(pdfFile.name || 'document.pdf', p, maxPages);
    const page = await pdf.getPage(p);
    // scale 2.5: плотные таблицы (коммерческие предложения, сметы) с мелким текстом —
    // при 2.0 модель теряла содержимое ячеек и возвращала пустую сетку таблицы
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
    if (blob) out.push(new File([blob], `${baseName}_p${p}.jpg`, { type: 'image/jpeg' }));
  }
  console.log(`PDF "${pdfFile.name}": ${out.length} стр. конвертировано`);
  return out;
}

// PDF превращаем в изображения страниц — дальше работают ВСЕ модели распознавания
async function expandFilesWithPdf(files, onPdfProgress) {
  const result = [];
  for (const f of files) {
    if (isPdfFile(f)) {
      try {
        result.push(...await convertPdfToImages(f, onPdfProgress));
      } catch (e) {
        console.error('PDF convert error:', e);
        alert(`Не удалось прочитать PDF «${f.name}»: ${e.message}`);
      }
    } else {
      result.push(f);
    }
  }
  return result;
}

// Короткие имена Groq → реальные ID из API (для подсветки выбранной строки)
const GROQ_ALIASES_FRONT = {
  'groq-llama-3.3-70b': 'groq-llama-3.3-70b-versatile',
  'groq-llama-3.1-8b': 'groq-llama-3.1-8b-instant'
};

const isModelSelected = (modelName, selectedModel) =>
  modelName === selectedModel || GROQ_ALIASES_FRONT[selectedModel] === modelName;

function compressImageFile(file, maxWidth = 1600, maxHeight = 2400, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (file.size <= MAX_FILE_SIZE_MB * 1024 * 1024) {
      return resolve(file);
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) { height = Math.round(height * (maxWidth / width)); width = maxWidth; }
        if (height > maxHeight) { width = Math.round(width * (maxHeight / height)); height = maxHeight; }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('Canvas toBlob failed'));
          const compressedFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
            type: 'image/jpeg', lastModified: Date.now()
          });
          console.log(`Frontend compressed: ${(file.size / 1024 / 1024).toFixed(2)}MB → ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB`);
          resolve(compressedFile);
        }, 'image/jpeg', quality);
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// Универсальное форматирование распознанного текста:
// — новый формат (модули с ══════) выводится как есть;
// — старые записи, где raw_text сохранён JSON-массивом ["a","b"], разворачиваются построчно;
// — если внутри строки JSON-объект с полем raw_text — извлекаем его.
function formatRawText(text) {
  if (!text) return '';
  const str = String(text).trim();
  if (str.startsWith('[') && str.endsWith(']')) {
    try {
      const arr = JSON.parse(str);
      if (Array.isArray(arr)) return arr.map(x => String(x)).join('\n');
    } catch (e) {}
  }
  if (str.startsWith('{') && str.endsWith('}')) {
    try {
      const obj = JSON.parse(str);
      if (obj && typeof obj.raw_text === 'string') return formatRawText(obj.raw_text);
    } catch (e) {}
  }
  return str;
}

function HighlightText({ text, query, style = {} }) {
  if (!query || !text) return <span style={style}>{text || ''}</span>;
  const q = query.toLowerCase().trim();
  if (!q) return <span style={style}>{text}</span>;
  const str = String(text);
  const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = str.split(regex);
  return (
    <span style={style}>
      {parts.map((part, i) =>
        part.toLowerCase() === q ? (
          <mark key={i} style={{ backgroundColor: '#ffeb3b', color: '#000', padding: '0 2px', borderRadius: 2, fontWeight: 600 }}>{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

const ReceiptScanner = registerPlugin('ReceiptScannerPlugin');

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || null);
  const [user, setUser] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState('upload');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [serverStatus, setServerStatus] = useState('checking');

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [previewUrls, setPreviewUrls] = useState([]);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [recognizing, setRecognizing] = useState(false);
  const [preparingPdf, setPreparingPdf] = useState(false); // конвертация PDF → страницы в браузере (длинные PDF — до минуты)
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progressStage, setProgressStage] = useState(null); // 'upload' | 'recognize'

  // Загрузка с реальным прогрессом (XHR: fetch не даёт upload-прогресс)
  const uploadWithProgress = (url, formData, onUploadProgress) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.timeout = 900000; // 15 мин: многостраничные документы (эскритура 29 стр.) распознаются постранично
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onUploadProgress(e.loaded / e.total);
    };
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(new Error('Соединение оборвано (прокси или сеть). Если документ был многостраничным — обновите список: он мог успеть сохраниться на сервере'));
    xhr.ontimeout = () => reject(new Error('Превышено время ожидания (15 мин). Проверьте список документов — документ мог успеть сохраниться на сервере'));
    xhr.send(formData);
  });
  const [lastSavedReceipt, setLastSavedReceipt] = useState(null);
  const [scanResultOpen, setScanResultOpen] = useState(false);
  // По умолчанию — Kimi K3 (бывший дефолт Groq Llama 4 Scout снят Groq с поддержки)
  const [selectedModel, setSelectedModel] = useState('kimi-kimi-k3');
  // Свой URL локального OCR (HTTPS-туннель cloudflared); пусто = авто 8081→8080
  const [localOcrUrl, setLocalOcrUrl] = useState(() => {
    try { return localStorage.getItem('localOcrUrl') || ''; } catch { return ''; }
  });
  const configureLocalOcr = () => {
    const url = window.prompt(
      'Адрес локального OCR-сервера.\n\nПусто = авто (прокси 127.0.0.1:8081 → llama-server :8080).\nЕсли браузер блокирует http://127.0.0.1 — поднимите HTTPS-туннель:\nbrew install cloudflared\ncloudflared tunnel --url http://127.0.0.1:8081\nи вставьте сюда выданный https://….trycloudflare.com',
      localOcrUrl
    );
    if (url === null) return;
    const v = url.trim().replace(/\/+$/, '');
    try { v ? localStorage.setItem('localOcrUrl', v) : localStorage.removeItem('localOcrUrl'); } catch { /* приватный режим */ }
    setLocalOcrUrl(v);
  };
  const [currency, setCurrency] = useState('auto');
  const [docType, setDocType] = useState('auto');
  // Режим обработки НЕСКОЛЬКИХ страниц (v29.1):
  // auto — AI сам решает (classify-pages); separate — каждая страница в свою карточку;
  // single — все страницы = ОДИН документ (договор, эскритура)
  const [multiPageMode, setMultiPageMode] = useState('auto');
  const [subtype, setSubtype] = useState('auto');
  const [paymentStatus, setPaymentStatus] = useState(''); // '' = статус оплаты не указан
  const [object, setObject] = useState('other');
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [exportMode, setExportMode] = useState('all');

  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  const [filterYears, setFilterYears] = useState([]);
  const [filterMonths, setFilterMonths] = useState([]);
  const [filterTypes, setFilterTypes] = useState([]);
  const [filterSubtypes, setFilterSubtypes] = useState([]);
  const [filterObjects, setFilterObjects] = useState([]);
  // Вкладка «Анализ»: движения банковской выписки + фильтры
  const [bankMovements, setBankMovements] = useState([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [bankFilter, setBankFilter] = useState('all'); // all | out | in | matched | unmatched
  const [bankSearch, setBankSearch] = useState('');
  const [bankDateFrom, setBankDateFrom] = useState(''); // фильтр по дате операции: с
  const [bankDateTo, setBankDateTo] = useState('');     // фильтр по дате операции: по
  const [bankCpFilter, setBankCpFilter] = useState([]); // фильтр по контрагентам (множественный выбор, Excel-стиль)
  const [linkPicker, setLinkPicker] = useState(null);   // движение, для которого открыт выбор фактуры
  const [linkSearch, setLinkSearch] = useState('');
  const [linkSaving, setLinkSaving] = useState(false);
  // Вкладка «Налоги» (v30): выбранный квартал для автозаполнения + черновик форм
  const [taxQuarter, setTaxQuarter] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${Math.floor(now.getMonth() / 3) + 1}T`;
  });
  const [taxDraft, setTaxDraft] = useState(null);
  const [taxFormPopup, setTaxFormPopup] = useState(null); // {form:'420'|'130', q:<квартал из taxDraft>} — попап заполненной модели (v30.2)
  const [taxShowOptional, setTaxShowOptional] = useState(false);
  // Диапазон кварталов для автозаполнения форм (v30.1): «с … по …»
  const [taxQFrom, setTaxQFrom] = useState('2025-1T');
  const [taxQTo, setTaxQTo] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${Math.floor(now.getMonth() / 3) + 1}T`;
  });
  const [filterDiffs, setFilterDiffs] = useState([]); // фильтр по разнице Δ (итог чека vs сумма товаров)
  const [searchQuery, setSearchQuery] = useState('');
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  // Сортировка списка: 'receipt' — по дате чека, 'recognized' — по дате распознавания
  const [sortMode, setSortMode] = useState('receipt');
  const [sortDir, setSortDir] = useState('desc');
  // Режим поиска дубликатов
  const [showDuplicates, setShowDuplicates] = useState(false);
  // Фокус на группе дубликатов ОДНОЙ выбранной карточки (кнопка «Показать копии»)
  const [dupFocusId, setDupFocusId] = useState(null);

  const [selectedReceiptIds, setSelectedReceiptIds] = useState(new Set());
  const [viewModal, setViewModal] = useState(null);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const [fsZoom, setFsZoom] = useState(false); // второй клик по фото в полноэкранном режиме — натуральный размер
  const [modalPageIdx, setModalPageIdx] = useState(0); // выбранная страница в галерее документа (модалка)
  const [editMode, setEditMode] = useState(false);     // ручное редактирование полей в карточке
  const [editForm, setEditForm] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);

  // При открытии другого чека галерея начинается с первой страницы, режим редактирования сбрасывается
  useEffect(() => { setModalPageIdx(0); setEditMode(false); setPageTextLang('ru'); }, [viewModal?.id]);
  const [pageTextLang, setPageTextLang] = useState('ru'); // текст страницы рядом с галереей: перевод | оригинал
  // Ширина окна — адаптивная раскладка карточки документа (<900px: изображение и перевод — вертикально, для мобильных)
  const [winWidth, setWinWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Закрытие полноэкранного просмотра по Escape
  useEffect(() => {
    if (!fullscreenImage) { setFsZoom(false); return; }
    const onKey = (e) => { if (e.key === 'Escape') setFullscreenImage(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreenImage]);

  const [folderProgress, setFolderProgress] = useState({ active: false, current: 0, total: 0, success: 0, errors: 0, currentFile: '' });
  const [folderResults, setFolderResults] = useState([]);

  const receiptCount = receipts.filter(r => ['receipt', 'invoice'].includes(r.document_type || 'receipt')).length;
  const invoiceCount = receipts.filter(r => !['receipt', 'invoice'].includes(r.document_type || 'receipt')).length;

  const checkServerHealth = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${API_URL}/health`, {
        method: 'GET',
        signal: controller.signal,
        mode: 'cors'
      });
      clearTimeout(timeout);
      if (res.ok) {
        setServerStatus('ok');
        return true;
      }
      setServerStatus('error');
      return false;
    } catch (e) {
      console.error('Server health check failed:', e.message);
      setServerStatus('error');
      return false;
    }
  }, []);

  useEffect(() => {
    checkServerHealth();
    const interval = setInterval(checkServerHealth, 30000);
    return () => clearInterval(interval);
  }, [checkServerHealth]);

  useEffect(() => {
    return () => { previewUrls.forEach(url => URL.revokeObjectURL(url)); };
  }, [previewUrls]);

  const scanDocumentNative = async () => {
    console.log('[SCANNER] Platform:', Capacitor.getPlatform());
    if (Capacitor.getPlatform() !== 'ios') {
      console.log('[SCANNER] Not iOS, skipping');
      return null;
    }
    try {
      console.log('[SCANNER] Calling scanDocument...');
      const result = await ReceiptScanner.scanDocument();
      console.log('[SCANNER] Result:', result);
      return result?.image || null;
    } catch (e) {
      console.error('[SCANNER] Error:', e);
      alert('Scanner error: ' + (e.message || JSON.stringify(e)));
      return null;
    }
  };

  const handleCameraClick = async () => {
    console.log('[CAMERA] Button clicked');
    console.log('[CAMERA] Platform:', Capacitor.getPlatform());
    if (Capacitor.getPlatform() === 'ios') {
      console.log('[CAMERA] Using native scanner...');
      const imageBase64 = await scanDocumentNative();
      console.log('[CAMERA] Got image:', imageBase64 ? 'YES' : 'NO');
      if (imageBase64) {
        const response = await fetch(imageBase64);
        const blob = await response.blob();
        const file = new File([blob], 'scanned_receipt.jpg', { type: 'image/jpeg' });
        const url = URL.createObjectURL(file);
        setSelectedFiles([file]);
        setCurrentFileIndex(0);
        setPreviewUrls([url]);
        setPreviewUrl(url);
        setLastSavedReceipt(null);
        setFolderResults([]);
        setScanResultOpen(true);
        recognizeAndSave(file);
      }
    } else {
      console.log('[CAMERA] Fallback to file input');
      document.getElementById('file-input').click();
    }
  };

  const login = async () => {
    setLoginError('');
    const isServerOk = await checkServerHealth();
    if (!isServerOk) {
      setLoginError(`Сервер недоступен. Проверьте URL: ${API_URL}`);
      return;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { error: `Сервер вернул ${res.status}` }; }
        setLoginError(data.error || `Ошибка сервера: ${res.status}`);
        return;
      }
      const data = await res.json();
      if (data.success) {
        setToken(data.token);
        setUser(data.user);
        localStorage.setItem('token', data.token);
        loadReceipts(data.token);
      } else {
        setLoginError(data.error || 'Неверный пароль');
      }
    } catch (e) {
      console.error('Login error:', e);
      if (e.name === 'AbortError') {
        setLoginError('Сервер не отвечает (таймаут). Проверьте URL бэкенда.');
      } else if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
        setLoginError(`Не удалось подключиться к серверу. URL: ${API_URL}`);
      } else {
        setLoginError('Ошибка соединения: ' + e.message);
      }
    }
  };

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    setReceipts([]);
    setAuthChecking(false);
    setSelectedReceiptIds(new Set());
  }, []);

  const loadReceipts = useCallback(async (authToken = token) => {
    if (!authToken) return;
    setLoading(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${API_URL}/api/receipts?token=${authToken}`, {
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.status === 401) { logout(); return; }
      if (!res.ok) throw new Error(`Ошибка загрузки: ${res.status}`);
      const data = await res.json();
      const raw = Array.isArray(data) ? data : (data.receipts || []);
      const processed = raw.map(r => {
        let items = r.items;
        if (typeof items === 'string') { try { items = JSON.parse(items); } catch (e) { items = []; } }
        if (!Array.isArray(items)) items = [];
        return {
          ...r,
          image_url: fixImageUrl(r.photo_url || r.image_url),
          items: items,
          raw_text: r.raw_text || r.recognized_text || ''
        };
      });
      setReceipts(processed);
      setSelectedReceiptIds(new Set());
      setCurrentPage(1);
    } catch (e) {
      console.error('Ошибка загрузки чеков:', e);
      setReceipts([]);
    }
    setLoading(false);
  }, [token, logout]);

  useEffect(() => {
    if (token) {
      setAuthChecking(true);
      fetch(`${API_URL}/api/me?token=${token}`, { signal: AbortSignal.timeout(8000) })
        .then(async r => { if (!r.ok) throw new Error('Auth failed'); return r.json(); })
        .then(data => {
          const userData = data.user || data;
          if ((data.success !== false) && (userData.id || userData.valid || data.id)) {
            setUser(userData);
            loadReceipts(token);
          } else throw new Error('Invalid token');
        })
        .catch(err => { console.error('Auth check error:', err); logout(); })
        .finally(() => setAuthChecking(false));
    } else {
      setAuthChecking(false);
    }
  }, [token, loadReceipts, logout]);

  const handleFileSelect = async (e) => {
    const picked = Array.from(e.target.files).filter(f => f.type.startsWith('image/') || isPdfFile(f));
    if (picked.length > 0) {
      setPreparingPdf(picked.some(isPdfFile));
      const files = await expandFilesWithPdf(picked);
      setPreparingPdf(false);
      if (!files.length) return;
      previewUrls.forEach(url => URL.revokeObjectURL(url));
      const urls = files.map(f => URL.createObjectURL(f));
      setSelectedFiles(files);
      setCurrentFileIndex(0);
      setPreviewUrls(urls);
      setPreviewUrl(urls[0]);
      setLastSavedReceipt(null);
      setFolderResults([]);
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    const picked = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/') || isPdfFile(f));
    if (picked.length > 0) {
      setPreparingPdf(picked.some(isPdfFile));
      const files = await expandFilesWithPdf(picked);
      setPreparingPdf(false);
      if (!files.length) return;
      previewUrls.forEach(url => URL.revokeObjectURL(url));
      const urls = files.map(f => URL.createObjectURL(f));
      setSelectedFiles(files);
      setCurrentFileIndex(0);
      setPreviewUrls(urls);
      setPreviewUrl(urls[0]);
      setLastSavedReceipt(null);
      setFolderResults([]);
    }
  };

  const nextFile = () => {
    if (currentFileIndex < selectedFiles.length - 1) {
      setCurrentFileIndex(currentFileIndex + 1);
      setPreviewUrl(previewUrls[currentFileIndex + 1]);
      setLastSavedReceipt(null);
    }
  };

  const prevFile = () => {
    if (currentFileIndex > 0) {
      setCurrentFileIndex(currentFileIndex - 1);
      setPreviewUrl(previewUrls[currentFileIndex - 1]);
      setLastSavedReceipt(null);
    }
  };

  // Несколько выбранных файлов = страницы ОДНОГО документа (договор, эскритура, отчёт):
  // отправляем все в /api/upload-document-pages, бэкенд собирает их в один документ
  const recognizeDocumentPages = async (files) => {
    setRecognizing(true);
    setLastSavedReceipt(null);
    try {
      const formData = new FormData();
      for (const f of files) {
        let fileToUpload = f;
        if (!isPdfFile(f) && f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
          fileToUpload = await compressImageFile(f);
        }
        formData.append('pages', fileToUpload);
      }
      formData.append('model', selectedModel);
      formData.append('currency', currency);
      formData.append('docType', docType);
      formData.append('subtype', subtype);
      formData.append('payment_status', paymentStatus);
      formData.append('object', object);
      formData.append('token', token);

      setUploadProgress(0);
      setProgressStage('upload');
      let creepTimer = null;
      const res = await uploadWithProgress(`${API_URL}/api/upload-document-pages?token=${token}`, formData, (ratio) => {
        setUploadProgress(Math.round(ratio * 40));
        if (ratio >= 1 && !creepTimer) {
          setProgressStage('recognize');
          let p = 40;
          creepTimer = setInterval(() => {
            p = Math.min(92, p + Math.max(0.4, (92 - p) * 0.05));
            setUploadProgress(Math.round(p));
          }, 500);
        }
      });
      if (creepTimer) clearInterval(creepTimer);

      const text = res.text;
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`Сервер вернул ${res.status}: ${text.slice(0, 200)}`); }
      if (!res.ok) throw new Error(data.error || data.message || `Ошибка сервера: ${res.status}`);
      if (!data.success && !data.id) throw new Error(data.error || 'Сохранение не удалось');

      let receiptData;
      if (data.jobId) {
        // Асинхронный режим (backend 2026-08-03.15+): опрашиваем задачу — длинные документы
        // обрабатываются в фоне и не упираются в ~5-минутный лимит прокси Railway
        setProgressStage('recognize');
        receiptData = await pollDocJob(data.jobId);
      } else {
        receiptData = data.data || data;
      }
      setUploadProgress(100);
      if (receiptData.image_url) receiptData.image_url = fixImageUrl(receiptData.image_url);
      setLastSavedReceipt(receiptData);
      loadReceipts();
    } catch (e) {
      console.error('Ошибка:', e);
      alert('Ошибка: ' + e.message);
    }
    setRecognizing(false);
    setProgressStage(null);
    setUploadProgress(0);
  };

  // Опрос асинхронной задачи распознавания документа (GET /api/doc-job/:id)
  // Реальный прогресс: vision страниц (40–70%), перевод (70–95%), финализация (96–97%)
  const pollDocJob = (jobId) => new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`${API_URL}/api/doc-job/${jobId}?token=${token}`);
        const j = await r.json();
        if (j.status === 'done') { clearInterval(timer); resolve(j.result); return; }
        if (j.status === 'error') { clearInterval(timer); reject(new Error(j.error || 'Ошибка обработки документа')); return; }
        const total = j.pagesTotal || 1;
        let pct = 45;
        if (j.stage === 'vision') pct = 40 + Math.round(30 * ((j.visionDone || 0) / total));
        else if (j.stage === 'translate') pct = 70 + Math.round(25 * ((j.translateDone || 0) / total));
        else if (j.stage === 'finalize') pct = 96;
        setUploadProgress(Math.min(97, Math.max(41, pct)));
        if (Date.now() - started > 25 * 60 * 1000) {
          clearInterval(timer);
          reject(new Error('Обработка заняла больше 25 минут — проверьте список документов, возможно, документ уже сохранён'));
        }
      } catch (e) {
        // мигнула сеть при опросе — просто пробуем снова на следующем тике
      }
    }, 4000);
  });

  // ========== ЛОКАЛЬНЫЙ OCR (кнопка «Локально») ==========
  // Страницы распознаются Unlimited-OCR на ноутбуке пользователя (llama-server :8080,
  // бесплатно и без облака), затем текст + изображения уходят на бэкенд Railway —
  // он структурирует карточку и сохраняет в базу. Несколько выбранных файлов =
  // страницы ОДНОГО документа (как «Распознать N стр.» до v27).
  const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Не удалось прочитать файл'));
    r.readAsDataURL(file);
  });

  const ocrPageLocal = async (file, baseUrl) => {
    const dataUrl = await fileToDataUrl(file);
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        temperature: 0, // рецепт модели: temp 0 + промпт с <|grounding|> — иначе пустой вывод
        max_tokens: 8192,
        // Анти-зацикливание: в vLLM-рецепте это n-gram logits processor (ngram 35/128),
        // в llama.cpp его нет — ближайший аналог DRY: штрафует повторы длинных фрагментов,
        // короткие легальные повторы чека (цены, «EUR») не страдают
        repeat_penalty: 1.05,
        dry_multiplier: 0.8,
        dry_base: 1.75,
        dry_allowed_length: 4,
        dry_sequence_breakers: ['\n', ':', '"', ' '],
        messages: [{ role: 'user', content: [
          { type: 'text', text: '<|grounding|>Convert the document to markdown.' },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]}]
      })
    });
    if (!res.ok) throw new Error(`локальный сервер ответил HTTP ${res.status}`);
    const data = await res.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    if (!text.trim()) throw new Error('локальная модель вернула пустой текст');
    return text;
  };

  const recognizeLocal = async () => {
    if (!selectedFiles.length || recognizing) return;
    setRecognizing(true);
    setLastSavedReceipt(null);
    setFolderResults([]);
    let creepTimer = null;
    try {
      // -1. Сессия на бэкенде жива? (токены в памяти — перезапуск Railway их стирает;
      // без проверки мы бы зря гоняли локальный OCR по минуте, а сохранение упало бы с 401)
      try {
        const me = await fetch(`${API_URL}/api/me?token=${token}`);
        if (me.status === 401) {
          alert('🖥 Локальный OCR: сессия на сервере истекла (backend перезапускался — сессии хранятся в памяти).\n\nНажмите «Выйти» и войдите заново, затем повторите.');
          setRecognizing(false);
          return;
        }
      } catch { /* сеть мигнула — продолжаем, сохранение само покажет ошибку */ }
      // 0. Ищем живой локальный сервер: свой URL (туннель) → прокси (8081) → напрямую (8080)
      const candidates = [...new Set([localOcrUrl, ...LOCAL_OCR_FALLBACK_URLS].filter(Boolean))];
      let localBase = null;
      for (const url of candidates) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 4000);
          await fetch(`${url}/health`, { signal: ctrl.signal });
          clearTimeout(t);
          localBase = url;
          break;
        } catch { /* пробуем следующий адрес */ }
      }
      if (!localBase) {
        throw new Error(`не отвечает (${candidates.join(', ')}).\n\n1) Запустите llama-server:\n./build/bin/llama-server -m ./uocr/Unlimited-OCR-Q4_K_M.gguf --mmproj ./uocr/mmproj-Unlimited-OCR-F16.gguf -c 8192 --host 127.0.0.1 --port 8080\n\n2) Во втором окне — прокси:\npython3 uocr-proxy.py\n\n3) Оба запущены, а ошибка остаётся (браузер режет http с HTTPS-страницы)? Поднимите HTTPS-туннель:\nbrew install cloudflared\ncloudflared tunnel --url http://127.0.0.1:8081\nи вставьте выданный https://….trycloudflare.com через ⚙ под кнопкой «Локально»`);
      }
      // Режим «по страницам» (v29.1): каждая страница — ОТДЕЛЬНАЯ карточка
      if (multiPageMode === 'separate' && selectedFiles.length > 1) {
        const results = [];
        for (let i = 0; i < selectedFiles.length; i++) {
          let f = selectedFiles[i];
          setProgressStage('local');
          setUploadProgress(Math.round((i / selectedFiles.length) * 100));
          try {
            if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) f = await compressImageFile(f);
            const ocrText = await ocrPageLocal(f, localBase);
            const fd = new FormData();
            fd.append('pages', f);
            fd.append('ocr_texts', JSON.stringify([ocrText]));
            fd.append('currency', currency);
            fd.append('docType', docType);
            fd.append('subtype', subtype);
            fd.append('payment_status', paymentStatus);
            fd.append('object', object);
            fd.append('token', token);
            setProgressStage('recognize');
            const res = await fetch(`${API_URL}/api/upload-ocr-text?token=${token}`, { method: 'POST', body: fd });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || (!data.success && !data.id)) throw new Error(data.error || `Ошибка сервера: ${res.status}`);
            const rd = data.data || data;
            if (rd.image_url) rd.image_url = fixImageUrl(rd.image_url);
            results.push({ file: f.name, status: 'success', receipt: rd });
          } catch (err) {
            results.push({ file: f.name, status: 'error', error: err.message });
          }
          setFolderResults([...results]);
        }
        const okCount = results.filter(r => r.status === 'success').length;
        const errCount = results.filter(r => r.status === 'error').length;
        const lastOk = [...results].reverse().find(r => r.status === 'success');
        if (lastOk) setLastSavedReceipt(lastOk.receipt);
        loadReceipts();
        alert(`🖥 Локальный OCR — режим «по страницам»:\n\n✅ Сохранено карточек: ${okCount}` + (errCount ? `\n❌ Ошибок: ${errCount} (детали — в списке ниже)` : ''));
        setRecognizing(false);
        setProgressStage(null);
        setUploadProgress(0);
        return;
      }
      // 1. OCR каждой страницы — локально (0–70% прогресса)
      const texts = [];
      const uploadFiles = [];
      for (let i = 0; i < selectedFiles.length; i++) {
        setProgressStage('local');
        setUploadProgress(Math.round((i / selectedFiles.length) * 70));
        let f = selectedFiles[i];
        if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) f = await compressImageFile(f);
        texts.push(await ocrPageLocal(f, localBase));
        uploadFiles.push(f);
      }
      setUploadProgress(70);
      // 2. Текст + изображения на бэкенд: структурирование карточки и сохранение (70–100%)
      const formData = new FormData();
      for (const f of uploadFiles) formData.append('pages', f);
      formData.append('ocr_texts', JSON.stringify(texts));
      formData.append('currency', currency);
      formData.append('docType', docType);
      formData.append('subtype', subtype);
      formData.append('payment_status', paymentStatus);
      formData.append('object', object);
      formData.append('token', token);
      setProgressStage('recognize');
      const res = await uploadWithProgress(`${API_URL}/api/upload-ocr-text?token=${token}`, formData, (ratio) => {
        setUploadProgress(70 + Math.round(ratio * 15));
        if (ratio >= 1 && !creepTimer) {
          let p = 85;
          creepTimer = setInterval(() => {
            p = Math.min(95, p + Math.max(0.4, (95 - p) * 0.05));
            setUploadProgress(Math.round(p));
          }, 500);
        }
      });
      if (creepTimer) clearInterval(creepTimer);
      setUploadProgress(100);
      const text = res.text;
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`Сервер вернул ${res.status}: ${text.slice(0, 200)}`); }
      if (!res.ok) {
        if (res.status === 401) {
          alert('🖥 Локальный OCR: сессия на сервере истекла (backend перезапускался).\n\nНажмите «Выйти», войдите заново и повторите — локальный OCR уже отработал, осталось сохранить.');
          setRecognizing(false);
          setProgressStage(null);
          setUploadProgress(0);
          return;
        }
        throw new Error(data.error || `Ошибка сервера: ${res.status}`);
      }
      if (!data.success && !data.id) throw new Error(data.error || 'Сохранение не удалось');
      const receiptData = data.data || data;
      if (receiptData.image_url) receiptData.image_url = fixImageUrl(receiptData.image_url);
      setLastSavedReceipt(receiptData);
      loadReceipts();
    } catch (e) {
      console.error('Локальный OCR:', e);
      alert('🖥 Локальный OCR: ' + e.message);
    }
    setRecognizing(false);
    setProgressStage(null);
    setUploadProgress(0);
  };

  const recognizeAndSave = async (fileArg) => {
    // Без явного файла и при выбранных нескольких — смотрим РЕЖИМ (v29.1):
    // auto — умный разбор (AI решает сам); separate — каждая в свою карточку;
    // single — все страницы в один документ (договор)
    if (!(fileArg instanceof File) && selectedFiles.length > 1) {
      if (multiPageMode === 'separate') {
        setFolderProgress({ active: true, phase: 'recognizing', current: 0, total: selectedFiles.length, success: 0, errors: 0, retries: 0, currentFile: '', fileRatio: 0 });
        setFolderResults([]);
        const results = await recognizeFilesSequentially(selectedFiles);
        const okCount = results.filter(r => r.status === 'success').length;
        const errCount = results.filter(r => r.status === 'error').length;
        alert(`📄 Режим «по страницам»: каждая страница — отдельная карточка.\n\n✅ Сохранено карточек: ${okCount}` + (errCount ? `\n❌ Ошибок: ${errCount} (детали — в списке ниже)` : ''));
        return;
      }
      if (multiPageMode === 'single') {
        return recognizeDocumentPages(selectedFiles);
      }
      return recognizeSelectedFilesSmart(selectedFiles);
    }
    const file = (fileArg instanceof File) ? fileArg : selectedFiles[currentFileIndex];
    if (!file) return;
    setRecognizing(true);
    setLastSavedReceipt(null);
    try {
      let fileToUpload = file;
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        console.log(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB), compressing...`);
        fileToUpload = await compressImageFile(file);
      }
      const formData = new FormData();
      formData.append('image', fileToUpload);
      formData.append('model', selectedModel);
      formData.append('currency', currency);
      formData.append('docType', docType);
      formData.append('subtype', subtype);
      formData.append('payment_status', paymentStatus);
      formData.append('object', object);
      formData.append('token', token);

      setUploadProgress(0);
      setProgressStage('upload');
      let creepTimer = null;
      const res = await uploadWithProgress(`${API_URL}/api/upload-receipt?token=${token}`, formData, (ratio) => {
        // Реальный прогресс загрузки файла: 0–40%
        setUploadProgress(Math.round(ratio * 40));
        if (ratio >= 1 && !creepTimer) {
          // Файл ушёл — сервер распознаёт: плавно ползём 40 → 92%
          setProgressStage('recognize');
          let p = 40;
          creepTimer = setInterval(() => {
            p = Math.min(92, p + Math.max(0.4, (92 - p) * 0.05));
            setUploadProgress(Math.round(p));
          }, 500);
        }
      });
      if (creepTimer) clearInterval(creepTimer);
      setUploadProgress(100);

      const text = res.text;
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`Сервер вернул ${res.status}: ${text.slice(0, 200)}`); }
      if (!res.ok) throw new Error(data.error || data.message || `Ошибка сервера: ${res.status}`);
      if (!data.success && !data.id) throw new Error(data.error || 'Сохранение не удалось');

      if (data.multi && Array.isArray(data.documents) && data.documents.length) {
        // На скане несколько чеков — все сохранены отдельно, показываем первый
        const docs = data.documents.map(d => ({ ...d, image_url: d.image_url ? fixImageUrl(d.image_url) : d.image_url }));
        setLastSavedReceipt(docs[0]);
        loadReceipts();
        alert(`🧾 На скане найдено чеков: ${data.count}\nКаждый распознан и сохранён отдельным документом — смотрите список «Чеки/фактуры».`);
      } else {
        const receiptData = data.data || data;
        if (receiptData.image_url) receiptData.image_url = fixImageUrl(receiptData.image_url);
        setLastSavedReceipt(receiptData);
        loadReceipts();
      }
    } catch (e) {
      console.error('Ошибка:', e);
      alert('Ошибка: ' + e.message);
    }
    setRecognizing(false);
    setProgressStage(null);
    setUploadProgress(0);
  };

  const clearScanState = () => {
    setSelectedFiles([]);
    setPreviewUrls([]);
    setPreviewUrl(null);
    setCurrentFileIndex(0);
    setLastSavedReceipt(null);
  };

  const finishScan = () => {
    setScanResultOpen(false);
    clearScanState();
  };

  // ========== АВТОДОЗАПРОС ПЕРЕВОДА ==========
  // Если у чека есть оригинал, но нет перевода — фронт САМ запрашивает перевод
  // у бэкенда отдельным текстовым запросом. Работает НЕЗАВИСИМО от модели,
  // которая распознавала чек, и чинит старые записи при первом открытии.
  const [translatingId, setTranslatingId] = useState(null);
  const [translateError, setTranslateError] = useState(null);
  // Версия бэкенда по /api/diagnostics (для предупреждения об устаревшем бэкенде)
  const [backendInfo, setBackendInfo] = useState(null);

  // Контроль версии бэкенда: если Railway не задеплоил свежий index.js — покажем баннер
  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/api/diagnostics`)
      .then(r => (r.ok ? r.json() : { error: `HTTP ${r.status}` }))
      .then(data => setBackendInfo(data))
      .catch(() => setBackendInfo({ error: 'недоступен' }));
  }, [token]);

  // Объекты (дома) — из API; при ошибке/старом бэкенде остаётся запасной список
  const [objectsList, setObjectsList] = useState(DEFAULT_OBJECTS);
  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/api/objects`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        const names = (data?.objects || []).map(o => o.name).filter(Boolean);
        // объединяем с запасным списком — объекты из DEFAULT_OBJECTS видны всегда, даже если их нет в таблице objects
        const merged = [...new Set([...names, ...DEFAULT_OBJECTS])];
        if (merged.length) setObjectsList(merged);
      })
      .catch(() => {});
  }, [token]);

  const requestTranslation = async (receipt) => {
    if (!receipt?.id || !receipt.raw_text) return null;
    setTranslatingId(receipt.id);
    setTranslateError(null);
    try {
      const res = await fetch(`${API_URL}/api/translate-receipt?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiptId: receipt.id })
      });
      if (res.status === 404) {
        setTranslateError('Бэкенд старой версии — нет endpoint перевода. Задеплой свежий index.js на householder-api!');
        setTranslatingId(null);
        return null;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.raw_text_ru) {
        setReceipts(prev => prev.map(r => r.id === receipt.id ? { ...r, raw_text_ru: data.raw_text_ru } : r));
        if (data.saved === false) setTranslateError(data.warning || 'Перевод не сохранён в базу (нет колонки raw_text_ru)');
        setTranslatingId(null);
        return data.raw_text_ru;
      }
      setTranslateError(data.error || `Ошибка перевода (HTTP ${res.status})`);
    } catch (e) {
      setTranslateError(e.message);
    }
    setTranslatingId(null);
    return null;
  };

  // Автоперевод при открытии карточки чека без перевода
  useEffect(() => {
    if (viewModal && viewModal.id && viewModal.raw_text && !viewModal.raw_text_ru) {
      requestTranslation(viewModal).then(ru => {
        if (ru) setViewModal(prev => (prev && prev.id === viewModal.id ? { ...prev, raw_text_ru: ru } : prev));
      });
    }
  }, [viewModal?.id]);

  // Автоперевод сразу после загрузки чека, если бэкенд не вернул raw_text_ru
  useEffect(() => {
    if (lastSavedReceipt && lastSavedReceipt.id && lastSavedReceipt.raw_text && !lastSavedReceipt.raw_text_ru) {
      requestTranslation(lastSavedReceipt).then(ru => {
        if (ru) setLastSavedReceipt(prev => (prev && prev.id === lastSavedReceipt.id ? { ...prev, raw_text_ru: ru } : prev));
      });
    }
  }, [lastSavedReceipt?.id]);

  const rescanScan = async () => {
    const r = lastSavedReceipt;
    setScanResultOpen(false);
    clearScanState();
    if (r && r.id) {
      try { await fetch(`${API_URL}/api/receipts/${r.id}?token=${token}`, { method: 'DELETE' }); } catch (e) {}
      loadReceipts();
    }
    handleCameraClick();
  };

  // Общий цикл последовательного распознавания файлов (папка; многостраничный PDF,
  // где каждая страница — отдельный документ): каждый файл → /api/upload-receipt
  // (сервер сам разрезает мульти-чеки на скане), до 2 попыток на файл,
  // прогресс — в folderProgress, итог — folderResults
  const recognizeFilesSequentially = async (allFiles) => {
    setFolderProgress(prev => ({ ...prev, phase: 'recognizing', current: 0, total: allFiles.length, fileRatio: 0 }));
    setRecognizing(true);
    const results = [];
    for (let i = 0; i < allFiles.length; i++) {
      const file = allFiles[i];
      setFolderProgress(prev => ({ ...prev, current: i + 1, currentFile: file.name, fileRatio: 0, retryNote: '' }));
      let lastErr = null;
      let done = false;
      // До 2 попыток на файл: разовые 502 Bad Gateway (прокси Railway) / обрывы сети самозалечиваются повтором
      for (let attempt = 1; attempt <= 2 && !done; attempt++) {
        try {
          let fileToUpload = file;
          if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
            fileToUpload = await compressImageFile(file);
          }
          const formData = new FormData();
          formData.append('image', fileToUpload);
          formData.append('model', selectedModel);
          formData.append('currency', currency);
          formData.append('docType', docType);
          formData.append('subtype', subtype);
          formData.append('payment_status', paymentStatus);
          formData.append('object', object);
          formData.append('token', token);
          let creepTimer = null;
          const res = await uploadWithProgress(`${API_URL}/api/upload-receipt?token=${token}`, formData, (ratio) => {
            setFolderProgress(prev => ({ ...prev, fileRatio: ratio * 0.5 }));
            if (ratio >= 1 && !creepTimer) {
              // Файл ушёл, сервер распознаёт — ползём 50→95% текущего файла
              let p = 0.5;
              creepTimer = setInterval(() => {
                p = Math.min(0.95, p + (0.95 - p) * 0.05);
                setFolderProgress(prev => ({ ...prev, fileRatio: p }));
              }, 600);
            }
          });
          if (creepTimer) clearInterval(creepTimer);
          setFolderProgress(prev => ({ ...prev, fileRatio: 1 }));
          const text = res.text;
          let data;
          try { data = JSON.parse(text); } catch { throw new Error(`Сервер вернул ${res.status}`); }
          if (!res.ok || (!data.success && !data.id)) {
            throw new Error(data.error || `Ошибка сервера: ${res.status}`);
          }
          if (data.multi && Array.isArray(data.documents) && data.documents.length) {
            // На скане несколько чеков — сервер сохранил каждый отдельно
            data.documents.forEach((d, k) => {
              if (d.image_url) d.image_url = fixImageUrl(d.image_url);
              results.push({ file: `${file.name} · чек ${k + 1}/${data.documents.length}`, status: 'success', receipt: d });
            });
          } else {
            const receiptData = data.data || data;
            if (receiptData.image_url) receiptData.image_url = fixImageUrl(receiptData.image_url);
            results.push({ file: file.name, status: 'success', receipt: receiptData });
          }
          setFolderProgress(prev => ({ ...prev, success: prev.success + 1 }));
          done = true;
        } catch (err) {
          lastErr = err;
          if (attempt < 2) {
            setFolderProgress(prev => ({ ...prev, retries: (prev.retries || 0) + 1, retryNote: ' — сбой сети, повтор…', fileRatio: 0 }));
            await new Promise(r => setTimeout(r, 3000)); // пауза перед повтором — прокси успевает «отойти»
          }
        }
      }
      if (!done) {
        console.error(`Folder upload error for ${file.name}:`, lastErr);
        results.push({ file: file.name, status: 'error', error: lastErr ? lastErr.message : 'неизвестная ошибка' });
        setFolderProgress(prev => ({ ...prev, errors: prev.errors + 1 }));
      }
    }
    setFolderResults(results);
    setFolderProgress(prev => ({ ...prev, active: false, currentFile: '' }));
    setRecognizing(false);
    loadReceipts();
    return results;
  };

  // Общая обработка набора файлов папки (используется обоими путями выбора папки)
  const processFolderFiles = async (picked) => {
    // Фаза 1 — конвертация PDF в изображения страниц: показываем в UI (раньше шла «вслепую», только console.log)
    setFolderProgress({ active: true, phase: 'converting', convertFile: '', convertPage: 0, convertTotal: 0, current: 0, total: 0, success: 0, errors: 0, retries: 0, currentFile: '', fileRatio: 0 });
    setFolderResults([]);
    const allFiles = await expandFilesWithPdf(picked, (name, page, total) => {
      setFolderProgress(prev => ({ ...prev, phase: 'converting', convertFile: name, convertPage: page, convertTotal: total }));
    });
    if (allFiles.length === 0) {
      setFolderProgress(prev => ({ ...prev, active: false }));
      return;
    }
    // Фаза 2 — распознавание
    const results = await recognizeFilesSequentially(allFiles);
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    if (errorCount === 0) {
      alert(`✅ Все ${successCount} чеков успешно распознаны и сохранены!`);
    } else {
      alert(`✅ Успешно: ${successCount}\n❌ Ошибок: ${errorCount}\n\nСмотрите детали ниже.`);
    }
  };

  // УМНЫЙ разбор нескольких страниц (многостраничный PDF или несколько выбранных файлов):
  // 1) /api/classify-pages — AI смотрит каждую страницу: самостоятельный документ
  //    (чек/фактура/альбаран/подтверждение перевода) или часть одного документа;
  // 2) ВСЕ страницы самостоятельные → каждая распознаётся и сохраняется В СВОЮ карточку
  //    (страница с двумя чеками дополнительно разрежется сервером — мульти-чек);
  // 3) хотя бы одна страница — продолжение → старый путь: страницы собираются в ОДИН документ;
  // 4) сбой классификатора → тоже старый путь (безопасный дефолт)
  const recognizeSelectedFilesSmart = async (files) => {
    setProgressStage('analyze');
    setUploadProgress(10);
    setRecognizing(true);
    let cls = null;
    try {
      const formData = new FormData();
      for (const f of files) formData.append('pages', f);
      formData.append('token', token);
      const res = await fetch(`${API_URL}/api/classify-pages?token=${token}`, { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && Array.isArray(data.pages)) cls = data;
      else console.warn('classify-pages:', data.error || `HTTP ${res.status}`);
    } catch (e) {
      console.warn('classify-pages сбой (старый путь «один документ»):', e.message);
    }
    setRecognizing(false);
    setProgressStage(null);
    setUploadProgress(0);

    if (cls && cls.allStandalone) {
      const titles = cls.pages.map(p => `стр.${p.page}: ${p.title || p.kind}`).join(', ');
      console.log(`Каждая страница — отдельный документ (${titles}) — сохраняем по отдельности`);
      setFolderProgress({ active: true, phase: 'recognizing', current: 0, total: files.length, success: 0, errors: 0, retries: 0, currentFile: '', fileRatio: 0 });
      setFolderResults([]);
      const results = await recognizeFilesSequentially(files);
      const okCount = results.filter(r => r.status === 'success').length;
      const errCount = results.filter(r => r.status === 'error').length;
      alert(`📄 Каждая страница — отдельный документ:\n${titles}\n\n✅ Сохранено карточек: ${okCount}` + (errCount ? `\n❌ Ошибок: ${errCount}` : ''));
      return;
    }
    if (cls) {
      console.log('Страницы — части одного документа:', cls.pages.map(p => `стр.${p.page}:${p.standalone ? 'док' : 'часть'}`).join(', '));
    }
    await recognizeDocumentPages(files);
  };

  // ПУТЬ 1 (Chrome/Edge): системный диалог ВЫБОРА ПАПКИ через File System Access API —
  // файлы внутри физически невозможно выбрать, только папка целиком (как раньше)
  const pickFolderNative = async (e) => {
    if (!window.showDirectoryPicker) return; // Safari — fallback на скрытый input ниже
    e.preventDefault();
    try {
      const dir = await window.showDirectoryPicker();
      const files = [];
      const walk = async (h) => {
        for await (const entry of h.values()) {
          if (entry.kind === 'file') {
            const f = await entry.getFile();
            if (f.type.startsWith('image/') || isPdfFile(f)) files.push(f);
          } else if (entry.kind === 'directory') {
            await walk(entry); // вложенные папки тоже собираем
          }
        }
      };
      await walk(dir);
      if (!files.length) { alert('В папке не найдено изображений или PDF'); return; }
      await processFolderFiles(files);
    } catch (err) {
      if (err.name !== 'AbortError') alert('Не удалось открыть папку: ' + err.message);
    }
  };

  // ПУТЬ 2 (Safari и др.): скрытый input с webkitdirectory
  const handleFolderSelect = async (e) => {
    const files = Array.from(e.target.files);
    e.target.value = ''; // иначе повторный выбор той же папки не сработает (onChange не сработает)
    const picked = files.filter(f => f.type.startsWith('image/') || isPdfFile(f));
    if (picked.length === 0) {
      alert('В папке не найдено изображений или PDF');
      return;
    }
    // Пользователь выбрал отдельные файлы, а не папку (нет относительных путей) — подсказываем
    if (files.length && files.every(f => !f.webkitRelativePath)) {
      alert('Вы выбрали отдельные файлы. Чтобы распознать папку — в диалоге нажмите на ПАПКУ целиком и кнопку «Выбрать», файлы внутри открывать не нужно.\n\nВыбранные файлы всё равно будут обработаны.');
    }
    await processFolderFiles(picked);
  };

  const deleteReceipt = async (id) => {
    if (!window.confirm('Удалить чек?')) return;
    try {
      const res = await fetch(`${API_URL}/api/receipts/${id}?token=${token}`, { method: 'DELETE' });
      if (res.ok) { loadReceipts(); if (viewModal && viewModal.id === id) setViewModal(null); }
      else alert('Ошибка удаления');
    } catch (e) { console.error('Ошибка удаления:', e); }
  };

  const exportExcel = async (ids = []) => {
    try {
      const res = await fetch(`${API_URL}/api/export-excel?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiptIds: ids })
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'receipts.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Ошибка экспорта:', e);
      alert('Ошибка экспорта');
    }
  };

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const generateReceiptCSV = (receipt) => {
    const items = receipt.items || [];
    let csv = '\uFEFFМагазин;Дата;Валюта;Товар;Кол-во;Цена;Сумма\n';
    items.forEach(item => {
      csv += [
        (receipt.store_name || '').replace(/;/g, ','),
        receipt.receipt_date || receipt.date || '',
        receipt.currency || '',
        (item.name || item.name_ru || '').replace(/;/g, ','),
        item.quantity || 1,
        item.price || '',
        item.total || ((item.price || 0) * (item.quantity || 1))
      ].join(';') + '\n';
    });
    csv += `;;ИТОГО;${receipt.total_amount || ''};;\n`;
    return csv;
  };

  const handleExport = async () => {
    if (selectedReceiptIds.size === 0) return alert('Выберите чеки');
    const selected = receipts.filter(r => selectedReceiptIds.has(r.id));
    let dirHandle = null;
    let useFolder = false;
    if (window.showDirectoryPicker) {
      try {
        dirHandle = await window.showDirectoryPicker();
        useFolder = true;
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn('showDirectoryPicker error:', err);
      }
    }
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!useFolder && isMobile) {
      alert('На этом устройстве выбор папки не поддерживается. Файлы будут скачаны в папку «Загрузки».');
    }
    const formats = [];
    if (exportMode === 'all') {
      formats.push('excel', 'text', 'photo');
    } else {
      formats.push(exportMode);
    }
    let savedCount = 0;
    for (const receipt of selected) {
      const safeName = (receipt.store_name || 'receipt')
        .replace(/[^a-zA-Z0-9\u0400-\u04FF]/g, '_')
        .substring(0, 40);
      const folderName = `${safeName}_${String(receipt.id).slice(-4)}`;
      let subDir = null;
      if (dirHandle) {
        try {
          subDir = await dirHandle.getDirectoryHandle(folderName, { create: true });
        } catch (e) {
          console.error('Cannot create subdir:', e);
        }
      }
      if (formats.includes('excel')) {
        try {
          const csv = generateReceiptCSV(receipt);
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          if (subDir) {
            const fileHandle = await subDir.getFileHandle('receipt.csv', { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            savedCount++;
          } else {
            downloadBlob(blob, `${folderName}.csv`);
            await new Promise(r => setTimeout(r, 300));
          }
        } catch (e) {
          console.error('CSV export error:', e);
        }
      }
      if (formats.includes('text')) {
        const text = receipt.raw_text || receipt.recognized_text || '';
        if (text) {
          try {
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            if (subDir) {
              const fileHandle = await subDir.getFileHandle('recognized_text.txt', { create: true });
              const writable = await fileHandle.createWritable();
              await writable.write(blob);
              await writable.close();
              savedCount++;
            } else {
              downloadBlob(blob, `${folderName}_text.txt`);
              await new Promise(r => setTimeout(r, 300));
            }
          } catch (e) {
            console.error('Text export error:', e);
          }
        }
      }
      if (formats.includes('photo')) {
        if (receipt.photo_url || receipt.image_url) {
          try {
            const res = await fetch(fixImageUrl(receipt.photo_url || receipt.image_url));
            const blob = await res.blob();
            const ext = ((receipt.photo_url || receipt.image_url).split('.').pop().split('?')[0]) || 'jpg';
            if (subDir) {
              const fileHandle = await subDir.getFileHandle(`receipt.${ext}`, { create: true });
              const writable = await fileHandle.createWritable();
              await writable.write(blob);
              await writable.close();
              savedCount++;
            } else {
              downloadBlob(blob, `${folderName}_image.${ext}`);
              await new Promise(r => setTimeout(r, 400));
            }
          } catch (e) {
            console.error('Photo export error:', e);
          }
        }
      }
    }
    if (useFolder) {
      alert(`✅ Экспорт завершён! Сохранено файлов/папок: ${savedCount}`);
    } else {
      alert('✅ Скачивание завершено!');
    }
  };

  const bulkDelete = async () => {
    if (!window.confirm(`Удалить ${selectedReceiptIds.size} чеков?`)) return;
    try {
      const res = await fetch(`${API_URL}/api/bulk-delete?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedReceiptIds) })
      });
      if (res.ok) { setSelectedReceiptIds(new Set()); loadReceipts(); }
      else alert('Ошибка массового удаления');
    } catch (e) { console.error(e); }
  };

  const bulkChangeObject = async (newObject) => {
    if (selectedReceiptIds.size === 0) return;
    try {
      const res = await fetch(`${API_URL}/api/bulk-update-object?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedReceiptIds), object: newObject })
      });
      if (res.ok) { setSelectedReceiptIds(new Set()); loadReceipts(); }
      else alert('Ошибка смены объекта');
    } catch (e) { console.error(e); }
  };

  // Заполнить форму редактирования текущими значениями чека и включить режим
  const startEdit = () => {
    if (!viewModal) return;
    setEditForm({
      store_name: viewModal.store_name || '',
      store_name_ru: viewModal.store_name_ru || '',
      receipt_date: viewModal.receipt_date || '',
      receipt_time: viewModal.receipt_time || '',
      total_amount: viewModal.total_amount ?? '',
      currency: viewModal.currency || '',
      document_type: viewModal.document_type || 'receipt',
      subtype: viewModal.subtype || '',
      payment_status: viewModal.payment_status || '',
      provider: viewModal.provider || '',
      object: viewModal.object || 'other',
      supply_address: viewModal.supply_address || '',
      invoice_number: viewModal.invoice_number || '',
      contract_number: viewModal.contract_number || '',
      cups: viewModal.cups || '',
      meter_number: viewModal.meter_number || '',
      consumption: viewModal.consumption ?? '',
      consumption_unit: viewModal.consumption_unit || '',
      valid_from: viewModal.valid_from || '',
      valid_to: viewModal.valid_to || ''
    });
    setEditMode(true);
  };

  // Сохранить правки: PUT /api/receipts/:id (пустые строки → null, суммы → числа)
  const saveEdit = async () => {
    if (!viewModal) return;
    setSavingEdit(true);
    try {
      const payload = {};
      for (const [k, v] of Object.entries(editForm)) {
        if (v === '' || v === undefined) { payload[k] = null; continue; }
        if (k === 'total_amount' || k === 'consumption') {
          const n = parseFloat(String(v).replace(',', '.'));
          payload[k] = Number.isFinite(n) ? n : null;
        } else payload[k] = v;
      }
      const res = await fetch(`${API_URL}/api/receipts/${viewModal.id}?token=${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(data.error || 'Ошибка сохранения'); return; }
      const updated = data.receipt || { ...viewModal, ...payload };
      setReceipts(prev => prev.map(r => (r.id === updated.id ? { ...r, ...updated } : r)));
      setViewModal(prev => (prev ? { ...prev, ...updated } : prev));
      setEditMode(false);
    } catch (e) {
      alert('Ошибка сохранения: ' + e.message);
    } finally {
      setSavingEdit(false);
    }
  };

  // Быстрая смена статуса оплаты прямо из карточки (менюшка в модалке) — без режима редактирования
  const quickSavePaymentStatus = async (value) => {
    if (!viewModal) return;
    const v = value || null;
    // Оптимистично обновляем UI сразу, затем сохраняем на сервере
    setViewModal(prev => (prev ? { ...prev, payment_status: v } : prev));
    setReceipts(prev => prev.map(r => (r.id === viewModal.id ? { ...r, payment_status: v } : r)));
    try {
      const res = await fetch(`${API_URL}/api/receipts/${viewModal.id}?token=${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_status: v })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      alert('Не удалось сохранить статус оплаты: ' + e.message);
      loadReceipts(); // откат к серверному состоянию
    }
  };

  const bulkChangePaymentStatus = async (value) => {
    if (selectedReceiptIds.size === 0) return;
    const v = value === '__clear' ? null : (value || null); // __clear — пункт «Очистить статус»
    try {
      const res = await fetch(`${API_URL}/api/bulk-update-payment-status?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedReceiptIds), payment_status: v })
      });
      if (res.ok) { setSelectedReceiptIds(new Set()); loadReceipts(); }
      else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Ошибка смены статуса оплаты (проверь версию бэкенда)');
      }
    } catch (e) { console.error(e); }
  };

  // Загрузить движения банковской выписки (вкладка «Анализ»)
  const loadBankMovements = async () => {
    setBankLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/bank-movements?token=${token}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setBankMovements(data.movements || []); return data.movements || []; }
      else console.error('bank-movements:', data.error);
      return null;
    } catch (e) { console.error(e); }
    finally { setBankLoading(false); }
  };

  // Импорт выписки банка (.xlsx Ruralvía) → автопривязка фактур к платежам
  const handleStatementSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('statement', file);
      const res = await fetch(`${API_URL}/api/import-bank-statement?token=${token}`, { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const skipLine = data.skipped ? `\n⏭ Пропущено уже загруженных: ${data.skipped}` : '';
      alert(`🏦 Выписка обработана (${data.account || data.iban || 'счёт'})\n\n📥 Новых движений: ${data.imported}${skipLine}\n✅ Привязано автоматически: ${data.autoMatched}\n⚪ Платежей без пары: ${data.unmatchedPayments}\n\nОткройте вкладку «📊 Анализ» — там все движения и привязки.`);
      loadReceipts(); // статусы оплаты привязанных фактур изменились на «Оплачено»
      loadBankMovements();
    } catch (err) {
      alert('Ошибка импорта выписки: ' + err.message);
    } finally { setLoading(false); }
  };

  // Открыть карточку документа по id (из списка движений в «Анализе»)
  const openReceiptById = (id) => {
    const r = receipts.find(x => String(x.id) === String(id));
    if (r) setViewModal(r);
    else alert('Документ не найден в загруженном списке — обновите «Чеки/фактуры» и попробуйте снова');
  };

  // Ручная привязка платежа к фактуре (можно несколько платежей к одной фактуре — разбитая оплата)
  const linkMovement = async (movementId, receiptId) => {
    setLinkSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/link-bank-movement?token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movement_id: movementId, receipt_id: receiptId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setLinkPicker(null);
      await loadBankMovements();
      await loadReceipts();
    } catch (err) { alert('Ошибка привязки: ' + err.message); }
    finally { setLinkSaving(false); }
  };

  // Отвязка платежа от фактуры
  const unlinkMovement = async (movementId) => {
    try {
      const res = await fetch(`${API_URL}/api/unlink-bank-movement?token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movement_id: movementId })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await loadBankMovements();
      await loadReceipts();
    } catch (err) { alert('Ошибка отвязки: ' + err.message); }
  };

  // Повторный запуск автопривязки (после загрузки новых фактур)
  const rematchBank = async () => {
    setBankLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/rematch-bank?token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      alert(`🔁 Автопривязка выполнена\n\n✅ Новых совпадений: ${data.autoMatched}\n⚪ Осталось без пары: ${data.unmatchedPayments}`);
      await loadBankMovements();
      await loadReceipts();
    } catch (err) { alert('Ошибка автопривязки: ' + err.message); }
    finally { setBankLoading(false); }
  };

  // ========== ВКЛАДКА «НАЛОГИ» (v30) ==========
  // Галка «есть фактура на этот платёж» — платёж становится подтверждённым расходом
  const toggleInvoiceFlag = async (m) => {
    const nv = !m.has_invoice;
    setBankMovements(prev => prev.map(x => x.id === m.id ? { ...x, has_invoice: nv } : x));
    try {
      const res = await fetch(`${API_URL}/api/bank-movement-invoice-flag?token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movement_id: m.id, has_invoice: nv })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    } catch (err) {
      setBankMovements(prev => prev.map(x => x.id === m.id ? { ...x, has_invoice: !nv } : x)); // откат
      alert('Галка не сохранилась: ' + err.message);
    }
  };

  // Квартальные границы: '2026-2T' → [2026-04-01, 2026-06-30]
  const taxQuarterRange = (key) => {
    const [y, qs] = String(key).split('-');
    const q = parseInt(qs) || 1;
    const m0 = (q - 1) * 3 + 1;
    const pad = n => String(n).padStart(2, '0');
    const lastDay = new Date(parseInt(y), q * 3, 0).getDate();
    return [`${y}-${pad(m0)}-01`, `${y}-${pad(q * 3)}-${pad(lastDay)}`];
  };

  // Автозаполнение форм из банка за ДИАПАЗОН кварталов (v30.1):
  // доходы = входящие квартала; расходы = исходящие с галкой «есть фактура»
  // (или привязанные к фактуре); IGIC soportado — из tax_amount привязанных фактур.
  // Просроченные кварталы (дедлайн прошёл, налог > 0) → штраф-надбавка (recargo por
  // extemporaneidad, art. 27 LGT: 1% + 1% за каждый полный месяц, макс 12%; после 12 мес.
  // — 15%) + пени (intereses de demora 4,0625% годовых с 13-го месяца). Каждый вызов = свежий пересчёт.
  const taxQuarterSums = (y, q, mvts) => {
    const [from, to] = taxQuarterRange(`${y}-${q}T`);
    const yFrom = `${y}-01-01`;
    const sums = (list) => {
      const inc = list.filter(m => Number(m.amount) > 0);
      const outAll = list.filter(m => Number(m.amount) < 0);
      const outInv = outAll.filter(m => m.has_invoice || m.matched_receipt_id);
      const sum = (arr) => arr.reduce((s, m) => s + Math.abs(Number(m.amount) || 0), 0);
      const linked = outInv.map(m => receipts.find(r => String(r.id) === String(m.matched_receipt_id))).filter(Boolean);
      const igicFromR = linked.reduce((s, r) => s + (parseFloat(r.tax_amount) || 0), 0);
      return { ingresos: sum(inc), gastos: sum(outInv), igicSop: igicFromR > 0 ? igicFromR : sum(outInv) * 0.07 / 1.07, incCount: inc.length, outCount: outAll.length, outInvCount: outInv.length };
    };
    const inQ = mvts.filter(m => m.operation_date && m.operation_date >= from && m.operation_date <= to);
    const cum = mvts.filter(m => m.operation_date && m.operation_date >= yFrom && m.operation_date <= to);
    return { from, to, quarter: sums(inQ), cum: sums(cum) };
  };
  const taxQuarterDeadline = (y, q) => q < 4 ? new Date(y, q * 3, 20) : new Date(y + 1, 0, 30); // 20 апр/июл/окт; 30 янв след. года
  const computeTaxRange = (fromKey, toKey, overrides = {}, mvts = null) => {
    const src = mvts || bankMovements;
    const parse = (k) => { const [y, qs] = String(k).split('-'); return { y: +y, q: parseInt(qs) || 1 }; };
    const a = parse(fromKey), b = parse(toKey);
    const list = [];
    let { y, q } = a;
    let guard = 0;
    while ((y < b.y || (y === b.y && q <= b.q)) && guard++ < 40) { list.push({ y, q }); q++; if (q > 4) { q = 1; y++; } }
    if (!list.length) list.push(a);
    const rate = overrides.igicRate != null ? overrides.igicRate : 7;
    const r2 = n => Math.round(n * 100) / 100;
    const today0 = new Date().setHours(0, 0, 0, 0);
    const paid130ByYear = {}; // авто-зачёт авансов: суммы результатов 130 предыдущих кварталов года
    const quarters = list.map(({ y, q }) => {
      const { from, to, quarter, cum } = taxQuarterSums(y, q, src);
      const ingresos = overrides[`ingresos_${y}_${q}`] != null ? overrides[`ingresos_${y}_${q}`] : r2(quarter.ingresos);
      const gastos = overrides[`gastos_${y}_${q}`] != null ? overrides[`gastos_${y}_${q}`] : r2(quarter.gastos);
      const igicSoportado = overrides[`igicSop_${y}_${q}`] != null ? overrides[`igicSop_${y}_${q}`] : r2(quarter.igicSop);
      const igicRepercutido = r2(ingresos * rate / 100);
      const result420 = r2(igicRepercutido - igicSoportado);
      // Modelo 130 — нарастающим итогом с 1 января минус авансы прошлых кварталов
      const rendCum = r2(cum.ingresos - cum.gastos);
      const cumIngresos = r2(cum.ingresos), cumGastos = r2(cum.gastos);
      const pagoCum = r2(Math.max(0, rendCum) * 0.20);
      const prev130 = paid130ByYear[y] || 0;
      const result130raw = r2(pagoCum - prev130);
      const result130 = Math.max(0, result130raw);
      paid130ByYear[y] = r2(prev130 + result130);
      // Просрочка: дедлайн прошёл, а платить нужно → надбавка + пени (добровольная подача)
      const dl = taxQuarterDeadline(y, q);
      const isLate = dl.getTime() < today0;
      const monthsLate = isLate ? Math.max(0, Math.floor((today0 - dl.getTime()) / (30.44 * 86400000))) : 0;
      // art. 27 LGT: 1% + 1% за каждый полный месяц просрочки (макс 12%), после 12 мес. — 15% + пени
      const recargoRate = !isLate ? 0 : monthsLate > 12 ? 0.15 : Math.min(12, monthsLate + 1) * 0.01;
      const interestFrom = new Date(dl.getTime()); interestFrom.setMonth(interestFrom.getMonth() + 12);
      const interestDays = monthsLate > 12 ? Math.floor((today0 - interestFrom.getTime()) / 86400000) : 0;
      const base420 = Math.max(0, result420), base130 = result130;
      const recargo = r2((base420 + base130) * recargoRate);
      const intereses = interestDays > 0 ? r2((base420 + base130) * 0.040625 * interestDays / 365) : 0;
      return { y, q, key: `${y}-${q}T`, from, to, ingresos, gastos, igicSoportado, igicRepercutido, result420, cumIngresos, cumGastos, rendCum, pagoCum, prev130, result130, dl, isLate, monthsLate, recargoRate, recargo, intereses, counts: quarter };
    });
    const tot = (f) => r2(quarters.reduce((s, x) => s + (x[f] || 0), 0));
    const total420 = tot('result420'), total130 = tot('result130');
    const totalRecargo = tot('recargo'), totalIntereses = tot('intereses');
    return {
      fromKey, toKey, igicRate: rate, quarters,
      total420, total130, totalRecargo, totalIntereses,
      // Отрицательный результат 420 — это «к компенсации», а не к оплате: в итог к оплате идут только положительные суммы
      grandTotal: r2(Math.max(0, total420) + total130 + totalRecargo + totalIntereses),
      lateCount: quarters.filter(x => x.isLate && (x.result420 > 0 || x.result130 > 0)).length
    };
  };

  // Строки заполненной модели: испанское название casilla КАК В ОФИЦИАЛЬНОЙ ФОРМЕ + рядом перевод на русский (v30.3)
  const taxFormRows = (form, x, d) => {
    const f = n => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const row = (label, val) => `  ${label}:`.padEnd(76, ' ') + f(val);
    const rows = [];
    if (form === '420') {
      rows.push(row(`Casilla 01 — Base imponible (tipo ${d.igicRate}%) — Налогооблагаемая база`, x.ingresos));
      rows.push(row('Casilla 06 — Cuota devengada — Начисленный налог', x.igicRepercutido));
      rows.push(row('Casilla 11 — Total devengado — Всего начислено', x.igicRepercutido));
      rows.push(row('Casilla 12 — IGIC deducible (con facturas) — IGIC к вычету по фактурам', x.igicSoportado));
      rows.push(row('Casilla 17 — Total a deducir — Всего к вычету', x.igicSoportado));
      rows.push(row('Casilla 18 — Diferencia — Разница', x.result420));
      rows.push(row('Casilla 20 — Resultado — Результат', x.result420));
      rows.push(x.result420 >= 0
        ? `  → A INGRESAR — К УПЛАТЕ: ${f(x.result420)} €`
        : `  → A COMPENSAR — К КОМПЕНСАЦИИ в следующих кварталах: ${f(Math.abs(x.result420))} €`);
    } else {
      rows.push(`  (нарастающим итогом с 1 января ${x.y} — при необходимости поправьте!)`);
      rows.push(row('Casilla 01 — Ingresos computables — Облагаемые доходы', x.cumIngresos));
      rows.push(row('Casilla 02 — Gastos deducibles — Вычитаемые расходы', x.cumGastos));
      rows.push(row('Casilla 03 — Rendimiento neto — Чистый доход', x.rendCum));
      rows.push(row('Casilla 04 — 20%', x.pagoCum));
      rows.push(row('Casilla 05 — Pagos anteriores/retenciones — Авансы прошлых кварталов', x.prev130));
      rows.push(row('Casilla 07 — Resultado — Результат', x.result130));
      rows.push(`  → A INGRESAR — К УПЛАТЕ: ${f(x.result130)} €`);
    }
    return rows;
  };

  const buildTaxRangeText = (d) => {
    const f = n => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const lines = [`ЧЕРНОВИКИ ФОРМ ${d.fromKey} — ${d.toKey} — автозаполнено из банка (${new Date().toLocaleString('ru-RU')})`,
      '(Помощник для переноса цифр в веб-форму — НЕ официальный документ. Проверьте цифры!)', ''];
    d.quarters.forEach(x => {
      lines.push(`════════════════ ${x.key} (движения ${x.from}…${x.to}: ${x.counts.incCount} поступл., ${x.counts.outInvCount} расходов с фактурой из ${x.counts.outCount}) ════════════════`);
      lines.push(`  ──────────── MODELO 420 — IGIC ${x.key} ────────────`);
      lines.push(...taxFormRows('420', x, d));
      lines.push('');
      lines.push(`  ──────────── MODELO 130 — IRPF ${x.key} ────────────`);
      lines.push(...taxFormRows('130', x, d));
      if (x.isLate && (x.result420 > 0 || x.result130 > 0)) {
        lines.push(`  ⚠ ПРОСРОЧЕНО (дедлайн ${x.dl.toLocaleDateString('ru-RU')}, ${x.monthsLate} мес.): надбавка recargo ${(x.recargoRate * 100).toFixed(0)}% = ${f(x.recargo)} · пени intereses = ${f(x.intereses)}`);
      }
      lines.push('');
    });
    lines.push(`════════ ИТОГО ЗА ПЕРИОД ════════`);
    lines.push(`  IGIC (modelo 420) к оплате:      ${f(Math.max(0, d.total420))} €${d.total420 < 0 ? `   (ещё ${f(Math.abs(d.total420))} € — a compensar, к компенсации)` : ''}`);
    lines.push(`  IRPF (modelo 130) к оплате:      ${f(d.total130)} €`);
    lines.push(`  ШТРАФ-надбавка (recargo):        ${f(d.totalRecargo)} €`);
    lines.push(`  ПЕНИ (intereses de demora):      ${f(d.totalIntereses)} €`);
    lines.push(`  ══ ВСЕГО К ОПЛАТЕ:               ${f(d.grandTotal)} € ══`);
    if (d.lateCount) lines.push(`  (просрочено кварталов: ${d.lateCount}; расчёт санкций — при добровольной подаче ДО требования AEAT; при требовании штраф 50–150%)`);
    return lines.join('\n');
  };

  // Текст ОДНОЙ заполненной модели (420 или 130) за конкретный квартал — для попапа и скачивания (v30.2)
  const buildSingleTaxFormText = (form, x, d) => {
    const f = n => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const lines = [`MODELO ${form} — ${form === '420' ? 'IGIC' : 'IRPF'} · ${x.key} — автозаполнено из банка (${new Date().toLocaleString('ru-RU')})`,
      `Основание: ${x.counts.incCount} поступлений и ${x.counts.outInvCount} платежей с фактурой за ${x.from}…${x.to}`,
      '(Это помощник для переноса цифр в веб-форму — НЕ официальный документ. Проверьте цифры!)', '',
      ...taxFormRows(form, x, d)];
    if (x.isLate && (x.result420 > 0 || x.result130 > 0)) {
      lines.push('');
      lines.push(`  ⚠ ПРОСРОЧЕНО (дедлайн ${x.dl.toLocaleDateString('ru-RU')}, ${x.monthsLate} мес.): надбавка recargo ${(x.recargoRate * 100).toFixed(0)}% = ${f(x.recargo)} · пени intereses = ${f(x.intereses)}`);
    }
    return lines.join('\n');
  };

  // Галка «есть фактура» внутри модалки черновика: сохраняем и сразу пересчитываем весь диапазон (v30.2)
  const toggleInvoiceFlagAndRecalc = async (m) => {
    await toggleInvoiceFlag(m);
    const mvts = await loadBankMovements();
    if (mvts && mvts.length) setTaxDraft(prev => prev ? computeTaxRange(prev.fromKey, prev.toKey, prev, mvts) : prev);
  };

  const bulkChangeSubtype = async (newSubtype) => {
    if (selectedReceiptIds.size === 0) return;
    try {
      const res = await fetch(`${API_URL}/api/bulk-update-subtype?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedReceiptIds), subtype: newSubtype })
      });
      if (res.ok) { setSelectedReceiptIds(new Set()); loadReceipts(); }
      else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Ошибка смены подтипа (проверь версию бэкенда)');
      }
    } catch (e) { console.error(e); }
  };

  const bulkChangeType = async (newType) => {
    if (selectedReceiptIds.size === 0) return;
    try {
      const res = await fetch(`${API_URL}/api/bulk-update-type?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedReceiptIds), document_type: newType })
      });
      if (res.ok) { setSelectedReceiptIds(new Set()); loadReceipts(); }
      else alert('Ошибка смены типа');
    } catch (e) { console.error(e); }
  };

  const bulkChangeCurrency = async (newCurrency) => {
    if (selectedReceiptIds.size === 0) return;
    try {
      const res = await fetch(`${API_URL}/api/bulk-update-currency?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedReceiptIds), currency: newCurrency })
      });
      if (res.ok) { setSelectedReceiptIds(new Set()); loadReceipts(); }
      else alert('Ошибка смены валюты');
    } catch (e) { console.error(e); }
  };

  const bulkReprocess = async () => {
    if (!window.confirm(`Перераспознать ${selectedReceiptIds.size} чеков?`)) return;
    setLoading(true);
    const ids = Array.from(selectedReceiptIds);
    for (const id of ids) {
      try {
        await fetch(`${API_URL}/api/reprocess-receipt?token=${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ receiptId: id, model: selectedModel })
        });
      } catch (e) { console.error('Reprocess error', e); }
    }
    setSelectedReceiptIds(new Set());
    loadReceipts();
    setLoading(false);
  };

  // Массовый перевод распознанного текста БЕЗ перераспознавания (дешевле и быстрее)
  const bulkTranslate = async () => {
    const ids = Array.from(selectedReceiptIds);
    setLoading(true);
    let ok = 0, failed = 0, lastError = '';
    for (const id of ids) {
      try {
        const res = await fetch(`${API_URL}/api/translate-receipt?token=${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ receiptId: id })
        });
        if (res.ok) ok++;
        else { failed++; const d = await res.json().catch(() => ({})); lastError = d.error || `HTTP ${res.status}`; }
      } catch (e) { failed++; lastError = e.message; }
    }
    setLoading(false);
    setSelectedReceiptIds(new Set());
    loadReceipts();
    if (failed > 0) alert(`Переведено: ${ok}, ошибок: ${failed}\n${lastError}`);
  };

  const toggleSelect = (id) => {
    setSelectedReceiptIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    const newSet = new Set(selectedReceiptIds);
    paginatedReceipts.forEach(r => newSet.add(r.id));
    setSelectedReceiptIds(newSet);
  };

  const deselectAll = () => setSelectedReceiptIds(new Set());

  const loadModels = async () => {
    setModelsLoading(true);
    setModels([]);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      const res = await fetch(`${API_URL}/api/check-models`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.models && data.models.length > 0) {
        setModels(data.models);
      } else {
        setModels(FALLBACK_MODELS.map(m => ({ ...m, active: null, ms: null, error: 'Не проверена' })));
      }
    } catch (e) {
      console.error('check-models error:', e);
      setModels(FALLBACK_MODELS.map(m => ({ ...m, active: null, ms: null, error: 'Не проверена' })));
    }
    setModelsLoading(false);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('ru-RU');
  };

  const formatAmount = (amount, currency) => {
    if (amount === null || amount === undefined) return '—';
    return `${parseFloat(amount).toFixed(2)} ${currency || ''}`;
  };

  const getProviderColor = (provider) => {
    const colors = {
      'Gemini': '#4285f4',
      'Groq': '#f55036',
      'OCR.space': '#00a86b',
      'OpenRouter': '#6366f1',
      'GitHub': '#24292f',
      'Mistral': '#ff7000',
      'Kimi': '#8b5cf6'
    };
    return colors[provider] || '#888';
  };

  const calculateItemsTotal = (items) => {
    if (!items || !items.length) return 0;
    return items.reduce((sum, item) => {
      const qty = parseFloat(item.quantity) || 1;
      const price = parseFloat(item.price) || 0;
      const total = parseFloat(item.total) || (qty * price);
      return sum + total;
    }, 0);
  };

  const availableYears = [...new Set(receipts.map(r => {
    const d = new Date(r.receipt_date || r.created_at);
    return isNaN(d.getTime()) ? null : d.getFullYear();
  }).filter(Boolean))].sort((a, b) => b - a);

  // Разница Δ: |итог чека − сумма товаров| — та же логика, что на карточке
  const diffOf = (r) => {
    // Δ — только для документов со строками товаров; у договоров/полисов/выписок её нет
    if (!['receipt', 'invoice', 'bill'].includes(r.document_type || 'receipt')) return null;
    const total = parseFloat(r.total_amount) || 0;
    const itemsTotal = calculateItemsTotal(r.items);
    if (!(total > 0) && !(itemsTotal > 0)) return null; // нет данных — на карточке «—»
    return Math.abs(total - itemsTotal);
  };
  const diffBucketOf = (r) => {
    const d = diffOf(r);
    if (d === null) return 'empty';
    if (d <= 0.01) return 'none';
    if (d <= 1) return 'small';
    if (d <= 5) return 'medium';
    if (d <= 20) return 'large';
    return 'huge';
  };

  const filteredReceipts = receipts.filter(r => {
    if (filterTypes.length && !filterTypes.includes(r.document_type || 'receipt')) return false;
    if (filterSubtypes.length && !filterSubtypes.includes(r.subtype || 'none')) return false;
    if (filterObjects.length && !filterObjects.includes(r.object || 'other')) return false;
    if (filterDiffs.length && !filterDiffs.includes(diffBucketOf(r))) return false;
    if (filterYears.length || filterMonths.length) {
      const d = new Date(r.receipt_date || r.created_at);
      if (!isNaN(d.getTime())) {
        if (filterYears.length && !filterYears.includes(d.getFullYear())) return false;
        if (filterMonths.length && !filterMonths.includes(d.getMonth() + 1)) return false;
      }
    }
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    const searchFields = [
      // 'Без названия' — тот же fallback, что и на карточке: поиск "названия" находит безымянные чеки
      String(r.id || ''), String(r.store_name || r.store_name_ru || 'Без названия'), String(r.store_name_ru || ''),
      String(r.raw_text || r.recognized_text || ''), String(r.raw_text_ru || ''),
      String(r.object || ''), String(r.currency || ''), String(r.owner_name || r.owner_id || ''),
      String(r.document_type || ''), String(DOC_TYPE_LABELS[r.document_type] || ''), String(r.total_amount || ''), String(r.subtotal || ''),
      String(r.tax_amount || ''), String(r.tax_rate || ''), String(r.receipt_date || ''),
      String(r.receipt_time || ''), String(r.receipt_address || ''), String(r.phone || ''),
      String(r.card_last4 || ''), String(r.recognition_method || ''), String(r.warning || ''),
      String(r.notes || ''), String(r.payment_method || ''), String(r.discount_amount || ''),
      String(r.loyalty_card || ''),
      String(r.provider || ''), String(r.subtype || ''), String(SUBTYPE_LABELS[r.subtype] || ''),
      String(r.valid_from || ''), String(r.valid_to || ''),
      String(r.supply_address || ''), String(r.invoice_number || ''), String(r.contract_number || ''),
      String(r.cups || ''), String(r.meter_number || ''),
    ];
    const itemsText = (r.items || []).map(i =>
      `${i.name || ''} ${i.name_ru || ''} ${i.price || ''} ${i.quantity || ''} ${i.total || ''} ${i.category || ''} ${i.sku || ''}`
    ).join(' ');
    const allText = searchFields.join(' ') + ' ' + itemsText;
    return allText.toLowerCase().includes(q);
  });

  // Поиск дубликатов: одинаковые магазин + дата чека + итоговая сумма.
  // В группе самый ранний по created_at — ОРИГИНАЛ, остальные — КОПИИ.
  // ПРОВЕРКА перед статусом КОПИЯ: если у обоих документов заполнены сильные
  // идентификаторы (№ договора, CUPS, № фактуры, адрес поставки) и они РАЗЛИЧАЮТСЯ —
  // это РАЗНЫЕ документы, а не копии (разные договоры с пустым «Без названия»!).
  const dupNorm = (v) => String(v || '').toLowerCase().replace(/[.,;«»"']/g, ' ').replace(/\s+/g, ' ').trim();
  const DUP_STRONG_FIELDS = ['contract_number', 'cups', 'invoice_number', 'supply_address', 'object'];
  const dupFieldConflict = (a, b) => DUP_STRONG_FIELDS.some(f => {
    const x = dupNorm(a[f]);
    const y = dupNorm(b[f]);
    if (!x || !y || x === y) return false;      // у одного не заполнено — не конфликт
    if (f === 'object' && (x === 'other' || y === 'other')) return false; // 'other' — заглушка, не улика
    return !(x.includes(y) || y.includes(x));    // частичное совпадение (обрезанный адрес) — не конфликт
  });
  // Сравнение РАСПОЗНАННОГО ТЕКСТА (когда структурные поля пусты):
  // 1) CUPS-коды точек поставки (ES…) — у обоих есть и НЕ пересекаются → разные документы
  // 2) наборы длинных чисел (№ договора, потребление кВт·ч, телефоны): общего < 70% → разные
  const dupCupsOf = (t) => new Set((String(t || '').toUpperCase().match(/ES[0-9A-Z]{14,24}/g) || []));
  const dupNumsOf = (t) => new Set((String(t || '').match(/\d{5,}/g) || []));
  const dupTextConflict = (a, b) => {
    const ta = a.raw_text || '';
    const tb = b.raw_text || '';
    if (ta.length < 300 || tb.length < 300) return false; // нечего сравнивать
    const ca = dupCupsOf(ta);
    const cb = dupCupsOf(tb);
    if (ca.size && cb.size) {
      let inter = 0;
      ca.forEach(c => { if (cb.has(c)) inter++; });
      if (inter === 0) return true; // разные CUPS — точно разные договоры поставки
    }
    const na = dupNumsOf(ta);
    const nb = dupNumsOf(tb);
    if (na.size >= 5 && nb.size >= 5) {
      let inter = 0;
      na.forEach(n => { if (nb.has(n)) inter++; });
      const jacc = inter / (na.size + nb.size - inter);
      if (jacc < 0.7) return true;
    }
    return false;
  };
  const dupConflict = (a, b) => dupFieldConflict(a, b) || dupTextConflict(a, b);
  const dupMap = new Map();
  receipts.forEach(r => {
    // Совсем без идентичности (ни названия, ни даты, ни суммы) — о дубликатах не судим
    if (!dupNorm(r.store_name) && !r.receipt_date && !(parseFloat(r.total_amount) || 0)) return;
    const key = `${dupNorm(r.store_name)}|${r.receipt_date || ''}|${parseFloat(r.total_amount) || 0}`;
    if (!dupMap.has(key)) dupMap.set(key, []);
    dupMap.get(key).push(r);
  });
  const dupGroups = [];
  dupMap.forEach(g => {
    if (g.length < 2) return;
    // Делим на подгруппы: конфликт сильных идентификаторов → разные документы
    const subgroups = [];
    g.forEach(r => {
      const sg = subgroups.find(s => s.every(m => !dupConflict(m, r)));
      if (sg) sg.push(r); else subgroups.push([r]);
    });
    subgroups.forEach(sg => {
      if (sg.length > 1) {
        sg.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
        dupGroups.push(sg);
      }
    });
  });
  const dupAllIds = new Set(dupGroups.flat().map(r => r.id));           // все участники групп дубликатов
  const dupCopyIds = new Set(dupGroups.flatMap(g => g.slice(1)).map(r => r.id)); // копии (все, кроме оригинала)

  // Группа дубликатов выбранной карточки (режим «Показать копии»)
  const dupFocusGroup = dupFocusId ? (dupGroups.find(g => g.some(r => r.id === dupFocusId)) || null) : null;
  const dupFocusReceipt = dupFocusId ? receipts.find(r => r.id === dupFocusId) : null;

  // Фокус на одной группе важнее общего режима дубликатов
  const visibleReceipts = dupFocusGroup
    ? filteredReceipts.filter(r => dupFocusGroup.some(g => g.id === r.id))
    : showDuplicates
      ? filteredReceipts.filter(r => dupAllIds.has(r.id))
      : filteredReceipts;

  // Дата для сортировки/группировки в зависимости от режима:
  // 'receipt' — дата с чека (receipt_date), 'recognized' — дата распознавания (recognized_at)
  const sortDateOf = (r) => sortMode === 'recognized'
    ? (r.recognized_at || r.created_at)
    : (r.receipt_date || r.created_at);

  // Сортировка: новые сверху (год → месяц → день)
  const sortedReceipts = [...visibleReceipts].sort((a, b) => {
    const da = new Date(sortDateOf(a) || 0).getTime() || 0;
    const db = new Date(sortDateOf(b) || 0).getTime() || 0;
    return sortDir === 'asc' ? da - db : db - da;
  });

  const totalPages = itemsPerPage === 'all' ? 1 : Math.ceil(sortedReceipts.length / itemsPerPage);
  const paginatedReceipts = itemsPerPage === 'all'
    ? sortedReceipts
    : sortedReceipts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Ключ группы "год-месяц" для заголовков в списке карточек (по активному режиму сортировки)
  const groupKeyOf = (r) => {
    const d = new Date(sortDateOf(r));
    return isNaN(d.getTime()) ? 'nodate' : `${d.getFullYear()}-${d.getMonth()}`;
  };
  const groupTitleOf = (r) => {
    const d = new Date(sortDateOf(r));
    return isNaN(d.getTime()) ? 'Без даты' : `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  };

  const formatUserName = (u) => {
    if (!u) return 'Guest';
    if (u.name && u.name !== 'admin' && !u.name.startsWith('user')) return u.name;
    if (u.email) return u.email.split('@')[0];
    if (u.role === 'admin') return 'Admin';
    return 'User';
  };

  const formatOwnerName = (receipt) => {
    if (receipt.owner_name && receipt.owner_name !== 'admin' && !receipt.owner_name.startsWith('user')) {
      return receipt.owner_name;
    }
    if (receipt.owner_id) {
      return `User ${receipt.owner_id}`;
    }
    return '—';
  };

  const activeModelDisplay = models.find(m => m.name === selectedModel) || FALLBACK_MODELS.find(m => m.name === selectedModel) || { displayName: selectedModel, provider: '?' };

  const filteredModels = models.filter(m => {
    if (!modelSearch) return true;
    const q = modelSearch.toLowerCase();
    return m.displayName.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
  });

  if (authChecking) {
    return (
      <div className="App">
        <div className="loading-screen">
          <div className="spinner"></div>
          <p>Проверка авторизации...</p>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="App">
        <div className="login-box">
          <h1>Receipt Manager</h1>
          <div style={{
            padding: '8px 12px',
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 13,
            background: serverStatus === 'ok' ? '#d4edda' : serverStatus === 'error' ? '#f8d7da' : '#fff3cd',
            color: serverStatus === 'ok' ? '#155724' : serverStatus === 'error' ? '#721c24' : '#856404',
            border: `1px solid ${serverStatus === 'ok' ? '#c3e6cb' : serverStatus === 'error' ? '#f5c6cb' : '#ffeeba'}`
          }}>
            {serverStatus === 'checking' && '⏳ Проверка сервера...'}
            {serverStatus === 'ok' && '✅ Сервер доступен'}
            {serverStatus === 'error' && `❌ Сервер недоступен: ${API_URL}`}
          </div>
          <input type="password" placeholder="Введите пароль" value={password} onChange={e => setPassword(e.target.value)} onKeyPress={e => e.key === 'Enter' && login()} />
          <button onClick={login} disabled={serverStatus === 'checking'}>
            {serverStatus === 'checking' ? 'Проверка...' : 'Войти'}
          </button>
          {loginError && (
            <div style={{ marginTop: 10, padding: 10, background: '#f8d7da', borderRadius: 6, color: '#721c24', fontSize: 13 }}>
              <strong>Ошибка:</strong> {loginError}
              <div style={{ marginTop: 6, fontSize: 12, color: '#555' }}>
                URL бэкенда: <code style={{ background: '#eee', padding: '2px 4px', borderRadius: 3 }}>{API_URL}</code>
                <br/>
                Проверьте в Railway Dashboard → receipt-web-back → Settings → Domain
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      <header className="mini-header">
        <div className="header-left">
          <div className="model-selector-wrap">
            <button className="model-toggle-btn" onClick={() => { setModelModalOpen(true); loadModels(); }}>
              Выбор модели
            </button>
            <div className="model-active-badge">
              <span className="provider-badge" style={{ backgroundColor: getProviderColor(activeModelDisplay.provider) }}>
                {activeModelDisplay.provider}
              </span>
              <span className="model-active-name">{activeModelDisplay.displayName}</span>
            </div>
          </div>
          <nav className="tabs-inline">
            <button className={activeTab === 'upload' ? 'active' : ''} onClick={() => setActiveTab('upload')}>Загрузка</button>
            <button className={activeTab === 'list' ? 'active' : ''} onClick={() => {setActiveTab('list'); loadReceipts();}}>
              Чеки/фактуры ({receiptCount}) · Прочие документы ({invoiceCount})
            </button>
            {/* Вкладка «Анализ»: банковские выписки и автопривязка платежей к фактурам */}
            <button className={activeTab === 'analysis' ? 'active' : ''} onClick={() => {setActiveTab('analysis'); loadReceipts(); loadBankMovements();}}>
              📊 Анализ
            </button>
            {/* Вкладка «Налоги» (v29.2): полная копия банковского «Анализа» — основа под налоговый учёт */}
            <button className={activeTab === 'taxes' ? 'active' : ''} onClick={() => {setActiveTab('taxes'); loadReceipts(); loadBankMovements();}}>
              🧾 Налоги
            </button>
          </nav>
        </div>
        <div className="header-right">
          <span className="user-name">{formatUserName(user)}</span>
          <button className="logout-btn" onClick={logout}>Выйти</button>
        </div>
      </header>

      {backendInfo && !String(backendInfo.version || '').includes('2026-08-04.22') && (
        <div style={{ background: '#fdecea', border: '1px solid #e74c3c', color: '#c0392b', padding: '10px 16px', borderRadius: 8, margin: '10px 15px', fontSize: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong> Бэкенд устарел!</strong>
          <span>
            На householder-api сейчас: <code>{backendInfo.version || backendInfo.error || 'старая версия (до diagnostics)'}</code>, нужна: <code>2026-08-04.22</code>.
            Задеплой свежий index.js (Railway → householder-api → Deploy latest commit), иначе перевод не заработает.
          </span>
          <button onClick={() => setBackendInfo(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: '#c0392b' }}>✕</button>
        </div>
      )}

      {/* Model Selection Modal */}
      {modelModalOpen && (
        <div className="model-modal-overlay" onClick={() => setModelModalOpen(false)}>
          <div className="model-modal-content" onClick={e => e.stopPropagation()}>
            <div className="model-modal-header">
              <h2>Выбор модели AI</h2>
              <button
                className="model-refresh-btn"
                onClick={loadModels}
                disabled={modelsLoading}
                title="Опросить модели заново"
                style={{ marginRight: 8, padding: '6px 12px', borderRadius: 6, border: '1px solid #ddd', background: modelsLoading ? '#f0f0f0' : '#fff', cursor: modelsLoading ? 'not-allowed' : 'pointer', fontSize: 13 }}
              >
                {modelsLoading ? '⏳ Опрос...' : '🔄 Обновить'}
              </button>
              <button className="modal-close" onClick={() => setModelModalOpen(false)}>✕</button>
            </div>
            <div className="model-modal-search">
              <input
                type="text"
                placeholder="Поиск модели..."
                value={modelSearch}
                onChange={e => setModelSearch(e.target.value)}
              />
            </div>
            <div className="model-modal-body">
              {modelsLoading ? (
                <div className="loading-center">
                  <div className="spinner"></div>
                  <p>Опрашиваем модели AI...</p>
                  <p style={{ fontSize: 12, color: '#888' }}>Каждая модель проверяется реальным запросом — это может занять до 30–40 секунд</p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f5f5f7', textAlign: 'left' }}>
                        <th style={{ padding: '8px 6px', borderBottom: '2px solid #e0e0e0', width: 30 }}></th>
                        <th style={{ padding: '8px 6px', borderBottom: '2px solid #e0e0e0' }}>Модель</th>
                        <th style={{ padding: '8px 6px', borderBottom: '2px solid #e0e0e0' }}>ID</th>
                        <th style={{ padding: '8px 6px', borderBottom: '2px solid #e0e0e0' }}>Провайдер</th>
                        <th style={{ padding: '8px 6px', borderBottom: '2px solid #e0e0e0' }}>Статус</th>
                        <th style={{ padding: '8px 6px', borderBottom: '2px solid #e0e0e0', textAlign: 'right' }}>Отклик</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredModels.map(model => {
                        const isSelected = isModelSelected(model.name, selectedModel);
                        const isActive = model.active === true;
                        const isUnknown = model.active === null || model.active === undefined;
                        const clickable = isActive || isUnknown;
                        return (
                          <tr
                            key={`${model.provider}-${model.name}`}
                            onClick={() => { if (clickable) { setSelectedModel(model.name); setModelModalOpen(false); } }}
                            title={model.error ? `${model.displayName}: ${model.error}` : `${model.provider} — ${model.displayName}`}
                            style={{
                              cursor: clickable ? 'pointer' : 'not-allowed',
                              opacity: isActive || isSelected ? 1 : 0.45,
                              background: isSelected ? '#e8f0fe' : 'transparent',
                              transition: 'background 0.15s'
                            }}
                            onMouseEnter={e => { if (clickable && !isSelected) e.currentTarget.style.background = '#f8f9fa'; }}
                            onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                          >
                            <td style={{ padding: '7px 6px', borderBottom: '1px solid #eee', textAlign: 'center' }}>
                              {isSelected ? '✅' : ''}
                            </td>
                            <td style={{ padding: '7px 6px', borderBottom: '1px solid #eee', fontWeight: isSelected ? 600 : 400 }}>
                              {model.displayName}
                            </td>
                            <td style={{ padding: '7px 6px', borderBottom: '1px solid #eee', color: '#888', fontSize: 11, wordBreak: 'break-all', maxWidth: 200 }}>
                              {model.name}
                            </td>
                            <td style={{ padding: '7px 6px', borderBottom: '1px solid #eee' }}>
                              <span className="provider-badge" style={{ backgroundColor: getProviderColor(model.provider) }}>
                                {model.provider}
                              </span>
                            </td>
                            <td style={{ padding: '7px 6px', borderBottom: '1px solid #eee' }}>
                              {isActive && <span style={{ color: '#2e7d32', fontWeight: 600, whiteSpace: 'nowrap' }}>✅ Активна</span>}
                              {!isActive && !isUnknown && (
                                <div>
                                  <span style={{ color: '#c62828', fontWeight: 600, whiteSpace: 'nowrap' }}>❌ Не активна</span>
                                  {model.error && (
                                    <div style={{ fontSize: 10, color: '#b71c1c', marginTop: 2, maxWidth: 220, lineHeight: 1.3 }}>
                                      {model.error}
                                    </div>
                                  )}
                                </div>
                              )}
                              {isUnknown && <span style={{ color: '#888', whiteSpace: 'nowrap' }}>➖ Не проверена</span>}
                            </td>
                            <td style={{ padding: '7px 6px', borderBottom: '1px solid #eee', textAlign: 'right', color: '#666', fontSize: 12 }}>
                              {isActive && model.ms != null ? `${(model.ms / 1000).toFixed(1)} с` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                      {filteredModels.length === 0 && (
                        <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#888' }}>Модели не найдены</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="model-modal-footer">
              <div className="model-modal-active-bar">
                <strong>Активная модель:</strong>
                <span className="provider-badge" style={{ backgroundColor: getProviderColor(activeModelDisplay.provider) }}>
                  {activeModelDisplay.provider}
                </span>
                <span>{activeModelDisplay.displayName}</span>
              </div>
              <button className="model-modal-close-btn" onClick={() => setModelModalOpen(false)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}

      {viewModal && (
        <div className="modal-overlay" onClick={() => setViewModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ flexShrink: 0 }}>
              <h2> Чек #{viewModal.id}</h2>
              <button className="modal-close" onClick={() => setViewModal(null)}>✕</button>
            </div>
            {/* При галерее страниц тело модалки — простым БЛОКОМ (без CSS-flex классов):
                одинаково во всех браузерах (Safari включительно) и на мобильных */}
            <div className="modal-body" style={{ minHeight: 0, ...((Array.isArray(viewModal.page_urls) && viewModal.page_urls.filter(Boolean).length) ? { display: 'block' } : {}) }}>
              {(() => {
                  // Если у документа сохранены все страницы (v13) — показываем галерею страниц
                  const pages = Array.isArray(viewModal.page_urls) ? viewModal.page_urls.filter(Boolean) : [];
                  if (pages.length) {
                    const idx = Math.min(modalPageIdx, pages.length - 1);
                    const curUrl = fixImageUrl(pages[idx]);
                    const manyPages = pages.length > 10; // >10 страниц — компактный режим навигации
                    const renderThumb = (p, i) => (
                      isPdfUrl(p) ? (
                        <button key={i} onClick={() => setModalPageIdx(i)} title={`Страница ${i + 1} (PDF)`}
                          style={{ minWidth: manyPages ? 36 : 40, height: manyPages ? 46 : 52, padding: '0 5px', borderRadius: 6, cursor: 'pointer', fontSize: manyPages ? 11 : 12, fontWeight: 600, flexShrink: 0, border: i === idx ? '2px solid #2980b9' : '1px solid #ccd6dd', background: i === idx ? '#eaf3fb' : '#fff', color: '#2c3e50' }}>
                          📄 {i + 1}
                        </button>
                      ) : (
                        <img key={i} src={fixImageUrl(p)} alt={`стр. ${i + 1}`} onClick={() => setModalPageIdx(i)}
                          style={{ width: manyPages ? 46 : 52, height: manyPages ? 46 : 52, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', flexShrink: 0, border: i === idx ? '2px solid #2980b9' : '1px solid #ccd6dd' }} />
                      )
                    );
                    // Перевод/оригинал выбранной страницы — рядом с изображением
                    const pageRu = extractRawPage(viewModal.raw_text_ru, idx + 1);
                    const pageOrig = extractRawPage(viewModal.raw_text, idx + 1);
                    const effLang = (pageTextLang === 'ru' && pageRu) ? 'ru' : (pageTextLang === 'orig' && pageOrig) ? 'orig' : (pageRu ? 'ru' : 'orig');
                    const pageText = effLang === 'ru' ? pageRu : pageOrig;
                    const langBtn = (lang, label, enabled) => (
                      <button key={lang} onClick={() => setPageTextLang(lang)} disabled={!enabled}
                        style={{ padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: enabled ? 'pointer' : 'not-allowed', border: effLang === lang ? '1px solid #2980b9' : '1px solid #ccd6dd', background: effLang === lang ? '#eaf3fb' : '#fff', color: enabled ? '#2c3e50' : '#b2bec3' }}>
                        {label}
                      </button>
                    );
                    // Колонки — через display:table с tableLayout:fixed (ширины колонок гарантированы,
                    // не зависит от flex-особенностей браузера); <900px — вертикально (мобильные)
                    const isNarrowModal = winWidth < 900;
                    const imageBlock = isPdfUrl(pages[idx]) ? (
                      <a href={curUrl} target="_blank" rel="noreferrer" className="no-image"
                        style={{ display: 'block', textDecoration: 'none', color: '#2980b9', fontWeight: 600 }}>
                        📄 Страница {idx + 1} — PDF, открыть в новой вкладке ↗
                      </a>
                    ) : (
                      <img
                        src={curUrl}
                        alt={`Страница ${idx + 1}`}
                        className="modal-image"
                        onClick={() => setFullscreenImage(curUrl)}
                        style={{ cursor: 'zoom-in', maxWidth: '100%' }}
                        title="Нажмите — открыть на весь экран"
                      />
                    );
                    const hasPageText = !!(pageRu || pageOrig);
                    const textPanel = !hasPageText ? null : (
                      <div style={{ textAlign: 'left', boxSizing: 'border-box' }}>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                          {langBtn('ru', '🇷🇺 Перевод', !!pageRu)}
                          {langBtn('orig', 'Оригинал', !!pageOrig)}
                          <span style={{ fontSize: 11, color: '#95a5a6', alignSelf: 'center' }}>стр. {idx + 1}</span>
                        </div>
                        <div style={{ maxHeight: isNarrowModal ? '45vh' : '55vh', overflowY: 'auto', overflowX: 'hidden', background: '#f8f9fa', border: '1px solid #e0e6ed', borderRadius: 8, padding: '10px 12px', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', color: '#2c3e50' }}>
                          {pageText}
                        </div>
                      </div>
                    );
                    return (
                      <>
                        {hasPageText && !isNarrowModal ? (
                          <div style={{ display: 'table', width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                            <div style={{ display: 'table-cell', width: '58%', verticalAlign: 'top', textAlign: 'center', paddingRight: 10, boxSizing: 'border-box' }}>
                              {imageBlock}
                            </div>
                            <div style={{ display: 'table-cell', width: '42%', verticalAlign: 'top', boxSizing: 'border-box' }}>
                              {textPanel}
                            </div>
                          </div>
                        ) : (
                          <div style={{ textAlign: 'center' }}>
                            {imageBlock}
                            {textPanel && <div style={{ marginTop: 8 }}>{textPanel}</div>}
                          </div>
                        )}
                        {pages.length > 1 && !manyPages && (
                          // До 10 страниц — все миниатюры с переносом
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, justifyContent: 'center' }}>
                            {pages.map(renderThumb)}
                          </div>
                        )}
                        {pages.length > 1 && manyPages && (
                          // Больше 10 страниц: навигация ‹ N из M › + прокручиваемая лента миниатюр
                          <div style={{ marginTop: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 6 }}>
                              <button onClick={() => setModalPageIdx(Math.max(0, idx - 1))} disabled={idx === 0}
                                style={{ width: 30, height: 26, borderRadius: 6, border: '1px solid #ccd6dd', background: '#fff', cursor: idx === 0 ? 'not-allowed' : 'pointer', fontWeight: 700, color: '#2c3e50' }}>‹</button>
                              <select value={idx} onChange={e => setModalPageIdx(Number(e.target.value))}
                                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #ccd6dd', fontSize: 13, cursor: 'pointer' }}>
                                {pages.map((_, i) => <option key={i} value={i}>Страница {i + 1} из {pages.length}</option>)}
                              </select>
                              <button onClick={() => setModalPageIdx(Math.min(pages.length - 1, idx + 1))} disabled={idx === pages.length - 1}
                                style={{ width: 30, height: 26, borderRadius: 6, border: '1px solid #ccd6dd', background: '#fff', cursor: idx === pages.length - 1 ? 'not-allowed' : 'pointer', fontWeight: 700, color: '#2c3e50' }}>›</button>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                              {pages.map(renderThumb)}
                            </div>
                          </div>
                        )}
                        <div style={{ fontSize: 12, color: '#95a5a6', marginTop: 4 }}>📑 Страница {idx + 1} из {pages.length}</div>
                      </>
                    );
                  }
                  // Обычный однофайловый чек — как раньше (узкая колонка CSS-классом + modal-info рядом)
                  return (
                    <div className="modal-image-section">
                      {(viewModal.photo_url || viewModal.image_url) ? (
                        isPdfUrl(viewModal.photo_url || viewModal.image_url)
                          ? <div className="no-image">📄 PDF-документ</div>
                          : <img
                              src={fixImageUrl(viewModal.photo_url || viewModal.image_url)}
                              alt="Чек"
                              className="modal-image"
                              onClick={() => setFullscreenImage(fixImageUrl(viewModal.photo_url || viewModal.image_url))}
                              style={{ cursor: 'zoom-in' }}
                              title="Нажмите — открыть на весь экран"
                            />
                      ) : <div className="no-image">Нет фото</div>}
                    </div>
                  );
                })()}
              <div className="modal-info">
                {editMode && (
                  <div className="info-block" style={{ background: '#fdf6ec', border: '1px solid #f0e0c0' }}>
                    <h3>✏️ Редактирование</h3>
                    {(() => {
                      const ls = { display: 'flex', flexDirection: 'column', fontSize: 11, color: '#7f8c8d', gap: 3 };
                      const is = { padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 };
                      const F = (key, label, type = 'text') => (
                        <label key={key} style={ls}>{label}
                          <input type={type} style={is} value={editForm[key] ?? ''} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))} />
                        </label>
                      );
                      return (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
                          {F('store_name', 'Название (оригинал)')}
                          {F('store_name_ru', 'Название (рус)')}
                          <label style={ls}>Тип документа
                            <select style={is} value={editForm.document_type || 'receipt'} onChange={e => setEditForm(f => ({ ...f, document_type: e.target.value }))}>
                              {Object.entries(DOC_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          </label>
                          <label style={ls}>Объект
                            <select style={is} value={editForm.object || 'other'} onChange={e => setEditForm(f => ({ ...f, object: e.target.value }))}>
                              {objectsList.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          </label>
                          <label style={ls}>Подтип
                            <select style={is} value={editForm.subtype || ''} onChange={e => setEditForm(f => ({ ...f, subtype: e.target.value }))}>
                              <option value="">— нет —</option>
                              {Object.entries(SUBTYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          </label>
                          <label style={ls}>Статус оплаты
                            <select style={is} value={editForm.payment_status || ''} onChange={e => setEditForm(f => ({ ...f, payment_status: e.target.value }))}>
                              <option value="">— не указан —</option>
                              {Object.entries(PAYMENT_STATUS_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
                            </select>
                          </label>
                          {F('provider', 'Поставщик / эмитент')}
                          {F('receipt_date', 'Дата', 'date')}
                          {F('receipt_time', 'Время', 'time')}
                          {F('total_amount', 'Итого (сумма)')}
                          {F('currency', 'Валюта (EUR, USD…)')}
                          {F('valid_from', 'Действует с / период с', 'date')}
                          {F('valid_to', 'Действует до / период по', 'date')}
                          {F('supply_address', 'Адрес поставки')}
                          {F('invoice_number', '№ фактуры')}
                          {F('contract_number', '№ договора')}
                          {F('cups', 'CUPS')}
                          {F('meter_number', '№ счётчика')}
                          {F('consumption', 'Потребление')}
                          <label style={ls}>Ед. потребления
                            <select style={is} value={editForm.consumption_unit || ''} onChange={e => setEditForm(f => ({ ...f, consumption_unit: e.target.value }))}>
                              <option value="">—</option>
                              <option value="kWh">kWh</option>
                              <option value="m3">m³</option>
                            </select>
                          </label>
                        </div>
                      );
                    })()}
                    <p style={{ fontSize: 12, color: '#95a5a6', margin: '8px 0 0' }}>Пустое поле = очистить значение. Текст документа, страницы и товары не меняются.</p>
                  </div>
                )}
                {!editMode && (
                <div className="info-block">
                  <h3>Основная информация</h3>
                  <p><strong>Магазин:</strong> <HighlightText text={viewModal.store_name || viewModal.store_name_ru || '—'} query={searchQuery} /></p>
                  {viewModal.store_name_ru && viewModal.store_name && viewModal.store_name_ru !== viewModal.store_name && (
                    <p style={{ marginTop: -6 }}><strong>Название (рус):</strong> <HighlightText text={viewModal.store_name_ru} query={searchQuery} /></p>
                  )}
                  <p><strong>Дата:</strong> {formatDate(viewModal.receipt_date)} {viewModal.receipt_time}</p>
                  <p><strong>Итого:</strong> {formatAmount(viewModal.total_amount, viewModal.currency)}</p>
                  <p><strong>Тип:</strong> {DOC_TYPE_LABELS[viewModal.document_type] || viewModal.document_type || '🧾 Чек'}</p>
                  <p><strong>Объект:</strong> <HighlightText text={viewModal.object || '—'} query={searchQuery} /></p>
                  {viewModal.subtype && <p><strong>Подтип:</strong> {SUBTYPE_LABELS[viewModal.subtype] || viewModal.subtype}</p>}
                  <p><strong>Оплата:</strong>{' '}
                    {/* Менюшка быстрой смены статуса прямо в карточке — сохраняется сразу, без режима редактирования */}
                    <select
                      value={viewModal.payment_status || ''}
                      onChange={e => quickSavePaymentStatus(e.target.value)}
                      title="Сменить статус оплаты"
                      style={{
                        padding: '3px 8px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                        border: `1px solid ${(PAYMENT_STATUS_META[viewModal.payment_status] || {}).color || '#ddd'}`,
                        color: (PAYMENT_STATUS_META[viewModal.payment_status] || {}).color || '#666',
                        background: (PAYMENT_STATUS_META[viewModal.payment_status] || {}).bg || '#fff'
                      }}
                    >
                      <option value="">— не указан —</option>
                      {Object.entries(PAYMENT_STATUS_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
                    </select>
                  </p>
                  {viewModal.paid_date && (
                    <p><strong>Дата оплаты:</strong> {formatDate(viewModal.paid_date)}
                      {viewModal.bank_movement_id && <span title="Привязано к движению по банковской выписке" style={{ marginLeft: 6, color: '#27ae60' }}>🏦 по выписке</span>}
                    </p>
                  )}
                  {viewModal.provider && <p><strong>Поставщик:</strong> <HighlightText text={viewModal.provider} query={searchQuery} /></p>}
                  {viewModal.supply_address && <p><strong>Адрес поставки:</strong> <HighlightText text={viewModal.supply_address} query={searchQuery} /></p>}
                  {viewModal.invoice_number && <p><strong>№ фактуры:</strong> {viewModal.invoice_number}</p>}
                  {viewModal.contract_number && <p><strong>№ договора:</strong> {viewModal.contract_number}</p>}
                  {viewModal.cups && <p><strong>CUPS:</strong> {viewModal.cups}</p>}
                  {viewModal.meter_number && <p><strong>№ счётчика:</strong> {viewModal.meter_number}</p>}
                  {viewModal.consumption != null && <p><strong>Потребление:</strong> {viewModal.consumption} {viewModal.consumption_unit || ''}</p>}
                  {(viewModal.valid_from || viewModal.valid_to) && (
                    <p><strong>{['bill', 'bank'].includes(viewModal.document_type) ? 'Период' : 'Действует'}:</strong> {viewModal.valid_from ? formatDate(viewModal.valid_from) : '—'} → {viewModal.valid_to ? formatDate(viewModal.valid_to) : '—'}
                      {expiryInfo(viewModal) && <span style={{ marginLeft: 8, color: expiryInfo(viewModal).color, fontWeight: 600 }}>{expiryInfo(viewModal).text}</span>}
                    </p>
                  )}
                  <p><strong>Метод:</strong> {viewModal.recognition_method || '—'}</p>
                  <p><strong>Добавил:</strong> <HighlightText text={formatOwnerName(viewModal)} query={searchQuery} /></p>
                  {viewModal.subtotal && <p><strong>Подытог:</strong> {viewModal.subtotal}</p>}
                  {viewModal.tax_amount && <p><strong>Налог:</strong> {viewModal.tax_amount} ({viewModal.tax_rate || ''})</p>}
                  {(() => {
                    const itemsTotal = calculateItemsTotal(viewModal.items);
                    const total = parseFloat(viewModal.total_amount) || 0;
                    const diff = Math.abs(total - itemsTotal).toFixed(2);
                    if (diff > 0.01 && ['receipt', 'invoice', 'bill'].includes(viewModal.document_type || 'receipt')) {
                      return (
                        <p style={{ color: '#e74c3c', fontWeight: 600 }}>
                          Разница: {diff} {viewModal.currency || ''}
                          <br/><small>(Сумма строк: {itemsTotal.toFixed(2)} ≠ Итого: {total.toFixed(2)})</small>
                        </p>
                      );
                    }
                    return <p style={{ color: '#27ae60' }}> Сумма строк совпадает</p>;
                  })()}
                </div>
                )}
                <div className="info-block">
                  <h3>Товары ({viewModal.items?.length || 0})</h3>
                  <table className="items-table">
                    <thead><tr><th>№</th><th>Товар</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead>
                    <tbody>
                      {(viewModal.items || []).map((item, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td><HighlightText text={item.name_ru || item.name || '—'} query={searchQuery} /></td>
                          <td>{item.quantity}</td>
                          <td>{item.price}</td>
                          <td>{item.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {viewModal.raw_text && (
                  <div className="info-block">
                    <h3>Распознанный текст — оригинал</h3>
                    <pre className="raw-text" style={{ whiteSpace: 'pre-wrap' }}><HighlightText text={formatRawText(viewModal.raw_text)} query={searchQuery} /></pre>
                  </div>
                )}
                {viewModal.raw_text_ru ? (
                  <div className="info-block">
                    <h3>Перевод на русский</h3>
                    <pre className="raw-text" style={{ whiteSpace: 'pre-wrap', background: '#f0f7ff' }}><HighlightText text={formatRawText(viewModal.raw_text_ru)} query={searchQuery} /></pre>
                  </div>
                ) : viewModal.raw_text ? (
                  <div className="info-block">
                    <h3>Перевод на русский</h3>
                    {translatingId === viewModal.id ? (
                      <p style={{ color: '#7f8c8d' }}>⏳ Перевожу автоматически...</p>
                    ) : (
                      <p style={{ color: '#c0392b', fontSize: 13 }}>
                        {translateError || 'Перевод недоступен.'}{' '}
                        <button onClick={async () => { const ru = await requestTranslation(viewModal); if (ru) setViewModal(prev => prev ? { ...prev, raw_text_ru: ru } : prev); }} style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>Повторить</button>
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="modal-footer" style={{ flexShrink: 0 }}>
              <button onClick={() => setViewModal(null)}>Закрыть</button>
              {/* Кнопки редактирования НЕ монтируем/размонтируем, а прячем через display:
                  иначе Safari (backdrop-filter на overlay) оставляет «призрак» удалённой
                  оранжевой кнопки — линию через футер */}
              <button onClick={startEdit} style={{ background: '#f39c12', display: editMode ? 'none' : undefined }}>✏️ Редактировать</button>
              <button onClick={() => setEditMode(false)} disabled={savingEdit} style={{ background: '#95a5a6', display: editMode ? undefined : 'none' }}>Отмена</button>
              <button onClick={saveEdit} disabled={savingEdit} style={{ background: '#27ae60', display: editMode ? undefined : 'none' }}>{savingEdit ? '⏳ Сохраняю...' : '💾 Сохранить'}</button>
              {user?.role === 'admin' && (
                <button className="danger" onClick={() => deleteReceipt(viewModal.id)}> Удалить</button>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'upload' && (
        <div className="upload-section">
          <div className="upload-toolbar">
            <button className="btn-camera" onClick={handleCameraClick}>
              📷 {Capacitor.getPlatform() === 'ios' ? 'Камера' : 'Фото'}
            </button>
            <label htmlFor="file-input" className="btn-file">
              📁 Выбрать файл
            </label>
            <label htmlFor="folder-input" className="btn-folder" onClick={pickFolderNative}>
              📁 Распознать папку
            </label>
            <label htmlFor="statement-input" className="btn-folder" style={{ background: '#16a085' }} title="Excel-выписка банка (.xlsx): фактуры автоматически привяжутся к платежам">
              🏦 Выписка банка
            </label>
            <div className="toolbar-controls">
              <div className="control-group compact">
                <label>Валюта:</label>
                <select value={currency} onChange={e => setCurrency(e.target.value)}>
                  <option value="auto">Auto (определить)</option>
                  <option value="AED">AED (Дирхам)</option>
                  <option value="EUR">EUR (Евро)</option>
                  <option value="USD">USD (Доллар)</option>
                  <option value="RUB">RUB (Рубль)</option>
                </select>
              </div>
              <div className="control-group compact">
                <label>Тип:</label>
                <select value={docType} onChange={e => setDocType(e.target.value)}>
                  <option value="auto">🤖 Авто (AI)</option>
                  {Object.entries(DOC_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="control-group compact">
                <label>Подтип:</label>
                <select value={subtype} onChange={e => setSubtype(e.target.value)}>
                  <option value="auto">🤖 Авто (AI)</option>
                  {Object.entries(SUBTYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="control-group compact">
                <label>Оплата:</label>
                <select value={paymentStatus} onChange={e => setPaymentStatus(e.target.value)}>
                  <option value="">— Не указан</option>
                  {Object.entries(PAYMENT_STATUS_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
                </select>
              </div>
              <div className="control-group compact">
                <label>Объект:</label>
                <select value={object} onChange={e => setObject(e.target.value)}>
                  {objectsList.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="control-group compact" title="Как обрабатывать несколько выбранных страниц/файлов: Авто — AI сам решит; По страницам — каждая в свою карточку; Один документ — все страницы склеиваются в одну карточку (договор, эскритура)">
                <label>Режим:</label>
                <select value={multiPageMode} onChange={e => setMultiPageMode(e.target.value)}>
                  <option value="auto">🤖 Авто (AI)</option>
                  <option value="separate">📄 По страницам</option>
                  <option value="single">📑 Один документ</option>
                </select>
              </div>
            </div>
          </div>

          <input type="file" accept="image/*,application/pdf" multiple onChange={handleFileSelect} id="file-input" style={{ display: 'none' }} />
          {/* Только webkitdirectory — без multiple/accept: тогда диалог выбирает ПАПКУ целиком,
              а файлы внутри не кликабельны (с accept/macOS диалог превращался в выбор файлов).
              Фильтрация по типу всё равно есть в handleFolderSelect */}
          <input type="file" id="folder-input" webkitdirectory="" directory="" onChange={handleFolderSelect} style={{ display: 'none' }} />
          <input type="file" id="statement-input" accept=".xlsx,.xls" onChange={handleStatementSelect} style={{ display: 'none' }} />

          <div className="recognize-bar">
            <button
              className="recognize-main-btn"
              onClick={() => recognizeAndSave()}
              disabled={!selectedFiles.length || recognizing}
              style={recognizing ? { position: 'relative', overflow: 'hidden' } : {}}
            >
              {recognizing && progressStage ? (
                <>
                  <span style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: `${uploadProgress}%`,
                    background: 'rgba(255,255,255,0.28)',
                    transition: 'width 0.4s ease'
                  }} />
                  <span style={{ position: 'relative', zIndex: 1 }}>
                    {progressStage === 'upload'
                      ? `⬆️ Загрузка… ${uploadProgress}%`
                      : progressStage === 'analyze'
                        ? '🔍 Анализирую страницы…'
                        : progressStage === 'local'
                          ? `🖥 Локальный OCR… ${uploadProgress}%`
                          : `🤖 Распознавание AI… ${uploadProgress}%`}
                  </span>
                </>
              ) : recognizing ? (
                '⏳ Идёт загрузка папки…'
              ) : selectedFiles.length > 1 ? (
                `📄 Распознать ${selectedFiles.length} стр. (AI разберёт: отдельно или как один)`
              ) : 'Распознать и сохранить'}
            </button>
            <button
              onClick={recognizeLocal}
              disabled={!selectedFiles.length || recognizing}
              title="Бесплатный OCR на вашем Mac (Unlimited-OCR, llama-server 127.0.0.1:8080). Текст распознаётся локально, карточку собирает и сохраняет сервер. Несколько выбранных страниц = один документ"
              style={{
                marginTop: 8, width: '100%', padding: '12px', fontSize: 15, fontWeight: 600,
                borderRadius: 10, border: '1.5px solid #27ae60', background: '#f0faf4', color: '#1e8449',
                cursor: (!selectedFiles.length || recognizing) ? 'not-allowed' : 'pointer',
                opacity: (!selectedFiles.length || recognizing) ? 0.55 : 1
              }}
            >
              🖥 Локально (Unlimited-OCR, бесплатно)
            </button>
            {/* Метка сборки: если её не видно на сайте — фронтенд не пересобрался/закэширован */}
            <div style={{ marginTop: 6, fontSize: 11, color: '#95a5a6', textAlign: 'center' }}>
              сборка 2026-08-08 · v30.3 · локальный OCR: {localOcrUrl ? 'туннель (свой URL)' : 'авто 8081→8080'}
              <button
                onClick={configureLocalOcr}
                title="Задать адрес локального OCR (HTTPS-туннель cloudflared)"
                style={{ marginLeft: 6, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, padding: 0 }}
              >⚙</button>
            </div>
          </div>

          <div className="upload-layout">
            <div className="drop-zone" onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
              <input type="file" accept="image/*,application/pdf" multiple onChange={handleFileSelect} id="file-input-hidden" style={{ display: 'none' }} />
              <label htmlFor="file-input" style={{ display: 'block', width: '100%', cursor: 'pointer' }}>
                {preparingPdf ? (
                  <div className="drop-text">
                    <p>⏳ Конвертирую PDF в страницы…</p>
                    <p className="hint">Длинный документ может занять до минуты</p>
                  </div>
                ) : previewUrl ? (
                  <div className="preview-container">
                    <img
                      src={previewUrl}
                      alt="Preview"
                      className="preview"
                      title="Нажмите для увеличения"
                      style={{ cursor: 'zoom-in' }}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFullscreenImage(previewUrl); }}
                    />
                    <p style={{ fontSize: 11, color: '#95a5a6', margin: '4px 0 0' }}>Нажмите на изображение для увеличения</p>
                    {selectedFiles.length > 1 && (
                      <div className="file-nav">
                        <button onClick={(e) => {e.preventDefault(); prevFile();}} disabled={currentFileIndex === 0}>◀</button>
                        <span>{currentFileIndex + 1} / {selectedFiles.length}</span>
                        <button onClick={(e) => {e.preventDefault(); nextFile();}} disabled={currentFileIndex === selectedFiles.length - 1}>▶</button>
                      </div>
                    )}
                    {selectedFiles[currentFileIndex] && (
                      <p style={{ fontSize: 12, color: '#7f8c8d', marginTop: 5 }}>
                        Размер: {(selectedFiles[currentFileIndex].size / 1024 / 1024).toFixed(2)} MB
                        {selectedFiles[currentFileIndex].size > MAX_FILE_SIZE_MB * 1024 * 1024 && ' (будет сжато)'}
                      </p>
                    )}
                    {selectedFiles.length > 1 && (
                      <p style={{ fontSize: 12, color: '#2980b9', marginTop: 4, fontWeight: 600 }}>
                        {selectedFiles.length} файлов → {multiPageMode === 'separate'
                          ? 'КАЖДАЯ страница — в СВОЮ карточку'
                          : multiPageMode === 'single'
                            ? 'СТРАНИЦЫ ОДНОГО документа (одна карточка)'
                            : 'AI сам решит: отдельные документы или страницы одного'}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="drop-text">
                    <p>Перетащите фото чека сюда</p>
                    <p>или нажмите для выбора файлов</p>
                    <p className="hint">Можно выбрать несколько файлов</p>
                  </div>
                )}
              </label>
            </div>

            {lastSavedReceipt && !scanResultOpen && (
              <div className="result-panel">
                <div className="result-panel-header">
                  <h3>✅ Сохранено: {DOC_TYPE_LABELS[lastSavedReceipt.document_type] || '🧾 Чек'}</h3>
                  <button className="close-btn" onClick={() => setLastSavedReceipt(null)}>✕ Закрыть</button>
                </div>
                <div className="result-panel-body">
                  <div className="result-image">
                    {(lastSavedReceipt.photo_url || lastSavedReceipt.image_url) ? (
                      isPdfUrl(lastSavedReceipt.photo_url || lastSavedReceipt.image_url)
                        ? <div className="no-image-thumb">📄 PDF</div>
                        : <img
                            src={fixImageUrl(lastSavedReceipt.photo_url || lastSavedReceipt.image_url)}
                            alt="Чек"
                            onClick={() => setFullscreenImage(fixImageUrl(lastSavedReceipt.photo_url || lastSavedReceipt.image_url))}
                            style={{ cursor: 'zoom-in' }}
                            title="Нажмите — открыть на весь экран"
                          />
                    ) : <div className="no-image-thumb">Нет фото</div>}
                  </div>
                  <div className="result-info">
                    <p><strong>ID:</strong> {lastSavedReceipt.id}</p>
                    <p><strong>Магазин:</strong> {lastSavedReceipt.store_name || lastSavedReceipt.store_name_ru || '—'}</p>
                    <p><strong>Дата:</strong> {formatDate(lastSavedReceipt.receipt_date)}</p>
                    <p><strong>Итого:</strong> {formatAmount(lastSavedReceipt.total_amount, lastSavedReceipt.currency)}</p>
                    <p><strong>Товаров:</strong> {lastSavedReceipt.items?.length || 0}</p>
                    <p><strong>Объект:</strong> {lastSavedReceipt.object || '—'}</p>
                    <p><strong>Метод:</strong> {lastSavedReceipt.recognition_method || '—'}</p>
                    <p><strong>Добавил:</strong> {formatOwnerName(lastSavedReceipt)}</p>
                    {lastSavedReceipt.warning && <p className="error">⚠️ {lastSavedReceipt.warning}</p>}
                  </div>
                </div>
                {lastSavedReceipt.items && lastSavedReceipt.items.length > 0 && (
                  <div className="result-items">
                    <h4>Товары:</h4>
                    <ul>
                      {lastSavedReceipt.items.map((item, i) => (
                        <li key={i}>{item.name_ru || item.name} — {item.quantity} × {item.price} = {item.total}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {lastSavedReceipt.raw_text && (
                  <details className="result-raw-text">
                    <summary>Распознанный текст — оригинал</summary>
                    <pre style={{ whiteSpace: 'pre-wrap' }}>{formatRawText(lastSavedReceipt.raw_text)}</pre>
                  </details>
                )}
                {lastSavedReceipt.raw_text_ru ? (
                  <details className="result-raw-text" open>
                    <summary>Перевод на русский</summary>
                    <pre style={{ whiteSpace: 'pre-wrap', background: '#f0f7ff' }}>{formatRawText(lastSavedReceipt.raw_text_ru)}</pre>
                  </details>
                ) : lastSavedReceipt.raw_text && translatingId === lastSavedReceipt.id ? (
                  <p style={{ color: '#7f8c8d', fontSize: 13 }}>⏳ Перевожу автоматически...</p>
                ) : lastSavedReceipt.raw_text && translateError ? (
                  <p style={{ color: '#c0392b', fontSize: 13 }}>
                    {translateError}{' '}
                    <button onClick={async () => { const ru = await requestTranslation(lastSavedReceipt); if (ru) setLastSavedReceipt(prev => prev ? { ...prev, raw_text_ru: ru } : prev); }} style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>Повторить</button>
                  </p>
                ) : null}
              </div>
            )}
          </div>

          {folderProgress.active && (
            <div className="folder-progress">
              {folderProgress.phase === 'converting' ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <strong>📄 Конвертация PDF в изображения...</strong>
                    {folderProgress.convertTotal > 0 && <span>стр. {folderProgress.convertPage} / {folderProgress.convertTotal}</span>}
                  </div>
                  <div className="folder-progress-bar">
                    <div style={{
                      width: `${folderProgress.convertTotal > 0 ? (folderProgress.convertPage / folderProgress.convertTotal * 100) : 5}%`,
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                  <p style={{ fontSize: 12, color: '#555', marginTop: 6 }}>
                    {folderProgress.convertFile || 'Подготовка…'}
                    {folderProgress.convertTotal > 0 && ` — страница ${folderProgress.convertPage} из ${folderProgress.convertTotal}`}
                  </p>
                  <p style={{ fontSize: 12, color: '#7f8c8d', marginTop: 4 }}>
                    Многостраничные PDF раскладываются по страницам — каждая станет отдельным документом. Дальше начнётся распознавание.
                  </p>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <strong> Распознавание файлов...</strong>
                    <span>{folderProgress.current} / {folderProgress.total} · {folderProgress.total > 0 ? Math.round(((folderProgress.current - 1 + (folderProgress.fileRatio || 0)) / folderProgress.total) * 100) : 0}%</span>
                  </div>
                  <div className="folder-progress-bar">
                    <div style={{
                      width: `${folderProgress.total > 0 ? ((folderProgress.current - 1 + (folderProgress.fileRatio || 0)) / folderProgress.total * 100) : 0}%`,
                      transition: 'width 0.5s ease'
                    }} />
                  </div>
                  <p style={{ fontSize: 12, color: '#555', marginTop: 6 }}>
                    {folderProgress.currentFile}
                    {folderProgress.retryNote || ''}
                    {!folderProgress.retryNote && (folderProgress.fileRatio || 0) > 0 && (folderProgress.fileRatio || 0) < 0.5 && ` — загрузка ${Math.round((folderProgress.fileRatio || 0) * 200)}%`}
                    {!folderProgress.retryNote && (folderProgress.fileRatio || 0) >= 0.5 && (folderProgress.fileRatio || 0) < 1 && ' — распознаётся AI…'}
                  </p>
                  <p style={{ fontSize: 13, color: '#27ae60', marginTop: 4 }}>
                    Успешно: {folderProgress.success} &nbsp;|&nbsp;
                    <span style={{ color: '#e74c3c' }}>❌ Ошибок: {folderProgress.errors}</span>
                    {(folderProgress.retries || 0) > 0 && <span style={{ color: '#7f8c8d' }}> &nbsp;|&nbsp; 🔁 повторов после сбоев сети: {folderProgress.retries}</span>}
                  </p>
                </>
              )}
            </div>
          )}

          {folderResults.length > 0 && !folderProgress.active && (
            <div style={{ marginTop: 15, padding: 15, background: '#e8f5e9', borderRadius: 8, maxHeight: 300, overflowY: 'auto' }}>
              <h4 style={{ margin: '0 0 10px 0' }}>📁 Результаты загрузки</h4>
              {folderResults.map((res, idx) => (
                <div key={idx} style={{
                  padding: '6px 10px',
                  marginBottom: 4,
                  borderRadius: 4,
                  background: res.status === 'success' ? '#d4edda' : '#f8d7da',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}>
                  <span>{res.status === 'success' ? '✅' : '❌'}</span>
                  <span style={{ flex: 1 }}>{res.file}</span>
                  {res.status === 'success' && res.receipt && (
                    <span style={{ color: '#155724' }}>
                      {(DOC_TYPE_LABELS[res.receipt.document_type] || '🧾 Чек').split(' ')[0]} {res.receipt.store_name || res.receipt.store_name_ru || 'Документ'} — {formatAmount(res.receipt.total_amount, res.receipt.currency)}
                    </span>
                  )}
                  {res.status === 'error' && (
                    <span style={{ color: '#721c24' }}>{res.error}</span>
                  )}
                </div>
              ))}
              <button
                onClick={() => setFolderResults([])}
                style={{ marginTop: 10, padding: '6px 12px', borderRadius: 6, border: 'none', background: '#95a5a6', color: '#fff', cursor: 'pointer' }}
              >
                Скрыть результаты
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'list' && (
        <div className="list-section">
          <div className="filters" style={{ flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <ExcelFilter label="Год" options={availableYears.map(y => ({ value: y, label: String(y) }))} selected={filterYears} onChange={v => { setFilterYears(v); setCurrentPage(1); }} />
            <ExcelFilter label="Месяц" options={MONTH_NAMES.map((n, i) => ({ value: i + 1, label: n }))} selected={filterMonths} onChange={v => { setFilterMonths(v); setCurrentPage(1); }} />
            <ExcelFilter label="Тип" options={Object.entries(DOC_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))} selected={filterTypes} onChange={v => { setFilterTypes(v); setCurrentPage(1); }} />
            <ExcelFilter label="Подтип" options={[...Object.entries(SUBTYPE_LABELS).map(([v, l]) => ({ value: v, label: l })), { value: 'none', label: '— Без подтипа' }]} selected={filterSubtypes} onChange={v => { setFilterSubtypes(v); setCurrentPage(1); }} />
            <ExcelFilter label="Объект" options={objectsList.map(o => ({ value: o, label: o }))} selected={filterObjects} onChange={v => { setFilterObjects(v); setCurrentPage(1); }} />
            <ExcelFilter label="Разница Δ" options={[
              { value: 'none', label: '✅ Без разницы' },
              { value: 'small', label: 'Δ до 1' },
              { value: 'medium', label: 'Δ 1–5' },
              { value: 'large', label: 'Δ 5–20' },
              { value: 'huge', label: 'Δ более 20' },
              { value: 'empty', label: '— Нет сумм' }
            ]} selected={filterDiffs} onChange={v => { setFilterDiffs(v); setCurrentPage(1); }} />
            <input type="text" placeholder="🔍 Поиск..." value={searchQuery} onChange={e => {setSearchQuery(e.target.value); setCurrentPage(1);}}
              style={{ flex: '1 1 140px', maxWidth: 200, padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #ccc' }} />
            <select value={itemsPerPage} onChange={e => {setItemsPerPage(e.target.value === 'all' ? 'all' : parseInt(e.target.value)); setCurrentPage(1);}}
              style={{ padding: '6px 8px', fontSize: 13, borderRadius: 6, border: '1px solid #ccc', width: 'auto' }}>
              {ITEMS_PER_PAGE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt === 'all' ? 'Все' : opt}</option>)}
            </select>
            <button onClick={() => exportExcel()} style={{ padding: '6px 12px', fontSize: 13 }}>📊 Excel (все)</button>
            <button onClick={() => loadReceipts()} style={{ padding: '6px 12px', fontSize: 13 }}>🔄 Обновить</button>
            <button
              onClick={() => { setShowDuplicates(v => !v); setDupFocusId(null); setCurrentPage(1); setSelectedReceiptIds(new Set()); }}
              style={{
                padding: '6px 12px', fontSize: 13, cursor: 'pointer',
                border: showDuplicates ? '1px solid #e74c3c' : '1px solid #ccc',
                background: showDuplicates ? '#fdecea' : '#fff',
                color: showDuplicates ? '#c0392b' : 'inherit',
                fontWeight: showDuplicates ? 600 : 400, borderRadius: 6
              }}
            >
              🔍 Дубликаты{dupCopyIds.size > 0 ? ` (${dupCopyIds.size})` : ''}
            </button>
          </div>

          {selectedReceiptIds.size > 0 && (
            <div style={{ background: '#fff3cd', padding: '12px 15px', borderRadius: 8, marginBottom: 15, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span> Выбрано: <strong>{selectedReceiptIds.size}</strong></span>
              {user?.role === 'admin' && (
                <button onClick={bulkDelete} style={{ background: '#e74c3c', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer' }}> Удалить</button>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={exportMode}
                  onChange={e => setExportMode(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 14, background: '#fff' }}
                >
                  <option value="all">Все (Excel + Фото + Текст)</option>
                  <option value="excel"> Excel (CSV)</option>
                  <option value="photo"> Фото</option>
                  <option value="text"> Текст</option>
                </select>
                <button
                  onClick={handleExport}
                  style={{ background: '#27ae60', color: 'white', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
                >
                  Загрузить
                </button>
              </div>
              <button onClick={() => bulkReprocess()} style={{ background: '#9b59b6', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer' }}> Перераспознать</button>
              <button onClick={() => bulkTranslate()} style={{ background: '#16a085', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer' }}> Перевести</button>
              <select onChange={e => { if (e.target.value) bulkChangeObject(e.target.value); e.target.value = ''; }} style={{ padding: '6px 10px', borderRadius: 6 }}>
                <option value="">Сменить объект...</option>
                {objectsList.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <select onChange={e => { if (e.target.value) bulkChangeType(e.target.value); e.target.value = ''; }} style={{ padding: '6px 10px', borderRadius: 6 }}>
                <option value="">Сменить тип...</option>
                {Object.entries(DOC_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select onChange={e => { if (e.target.value) bulkChangeSubtype(e.target.value); e.target.value = ''; }} style={{ padding: '6px 10px', borderRadius: 6 }}>
                <option value="">Сменить подтип...</option>
                {Object.entries(SUBTYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select onChange={e => { if (e.target.value) bulkChangePaymentStatus(e.target.value); e.target.value = ''; }} style={{ padding: '6px 10px', borderRadius: 6 }}>
                <option value="">Сменить оплату...</option>
                {Object.entries(PAYMENT_STATUS_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
                <option value="__clear">✖ Очистить статус</option>
              </select>
              <select onChange={e => { if (e.target.value) bulkChangeCurrency(e.target.value); e.target.value = ''; }} style={{ padding: '6px 10px', borderRadius: 6 }}>
                <option value="">Сменить валюту...</option>
                <option value="AED">AED</option>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="RUB">RUB</option>
              </select>
              {selectedReceiptIds.size === 1 && (() => {
                const selId = [...selectedReceiptIds][0];
                const grp = dupGroups.find(g => g.some(r => r.id === selId));
                return (
                  <button
                    onClick={() => {
                      if (!grp) { alert('У выбранной карточки нет копий — дубликаты не найдены (совпадение ищется по названию + дате + сумме).'); return; }
                      setDupFocusId(selId); setShowDuplicates(false); setCurrentPage(1);
                    }}
                    disabled={!grp}
                    title={grp
                      ? `Показать группу дубликатов этой карточки: ${grp.length} шт. (оригинал + копии)`
                      : 'У выбранной карточки нет копий'}
                    style={{ background: grp ? '#e67e22' : '#bdc3c7', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: grp ? 'pointer' : 'not-allowed' }}
                  >
                    👯 Показать копии{grp ? ` (${grp.length})` : ''}
                  </button>
                );
              })()}
              <button onClick={deselectAll} style={{ background: '#95a5a6', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer' }}>Сбросить</button>
            </div>
          )}

          <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <label style={{ cursor: 'pointer', fontSize: 14 }}>
              <input
                type="checkbox"
                checked={paginatedReceipts.length > 0 && paginatedReceipts.every(r => selectedReceiptIds.has(r.id))}
                ref={el => {
                  if (el) {
                    const some = paginatedReceipts.some(r => selectedReceiptIds.has(r.id));
                    const all = paginatedReceipts.length > 0 && paginatedReceipts.every(r => selectedReceiptIds.has(r.id));
                    el.indeterminate = some && !all;
                  }
                }}
                onChange={(e) => e.target.checked ? selectAllVisible() : deselectAll()}
                style={{ marginRight: 6 }}
              />
              Выбрать все на странице
            </label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: '#7f8c8d' }}>Сортировка:</span>
              <button
                onClick={() => { if (sortMode === 'receipt') setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortMode('receipt'); setSortDir('desc'); } setCurrentPage(1); }}
                style={{
                  padding: '4px 10px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
                  border: sortMode === 'receipt' ? '1px solid #3498db' : '1px solid #ccc',
                  background: sortMode === 'receipt' ? '#eaf3fb' : '#fff',
                  color: sortMode === 'receipt' ? '#2980b9' : '#555', fontWeight: sortMode === 'receipt' ? 600 : 400
                }}
              >
                По дате чека {sortMode === 'receipt' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
              </button>
              <button
                onClick={() => { if (sortMode === 'recognized') setSortDir(d => d === 'desc' ? 'asc' : 'desc'); else { setSortMode('recognized'); setSortDir('desc'); } setCurrentPage(1); }}
                style={{
                  padding: '4px 10px', fontSize: 13, borderRadius: 6, cursor: 'pointer',
                  border: sortMode === 'recognized' ? '1px solid #3498db' : '1px solid #ccc',
                  background: sortMode === 'recognized' ? '#eaf3fb' : '#fff',
                  color: sortMode === 'recognized' ? '#2980b9' : '#555', fontWeight: sortMode === 'recognized' ? 600 : 400
                }}
              >
                По дате распознавания {sortMode === 'recognized' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
              </button>
            </div>
          </div>

          {showDuplicates && (
            <div style={{ background: '#fdecea', border: '1px solid #f5b7b1', padding: '10px 15px', borderRadius: 8, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 14 }}>
              <span>
                Найдено групп дубликатов: <strong>{dupGroups.length}</strong>, лишних копий: <strong>{dupCopyIds.size}</strong>
                <span style={{ color: '#7f8c8d' }}> — оригиналы помечены зелёным, копии красным</span>
              </span>
              {dupCopyIds.size > 0 && (
                <button
                  onClick={() => setSelectedReceiptIds(new Set(dupCopyIds))}
                  style={{ background: '#e74c3c', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
                >
                  Выбрать все копии
                </button>
              )}
              <button
                onClick={() => { setShowDuplicates(false); setCurrentPage(1); }}
                style={{ background: '#95a5a6', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer' }}
              >
                Показать все
              </button>
            </div>
          )}

          {dupFocusGroup && (
            <div style={{ background: '#fdf2e3', border: '1px solid #f0c987', padding: '10px 15px', borderRadius: 8, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 14 }}>
              <span>
                👯 Дубликаты карточки <strong>«{(dupFocusReceipt && (dupFocusReceipt.store_name || dupFocusReceipt.store_name_ru)) || 'Без названия'}»</strong>: <strong>{dupFocusGroup.length}</strong> шт.
                <span style={{ color: '#7f8c8d' }}> — оригинал помечен зелёным, копии красным</span>
              </span>
              {dupFocusGroup.length > 1 && (
                <button
                  onClick={() => setSelectedReceiptIds(new Set(dupFocusGroup.slice(1).map(r => r.id)))}
                  style={{ background: '#e74c3c', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
                >
                  Выбрать копии ({dupFocusGroup.length - 1})
                </button>
              )}
              <button
                onClick={() => { setDupFocusId(null); setCurrentPage(1); }}
                style={{ background: '#95a5a6', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer' }}
              >
                Показать все
              </button>
            </div>
          )}

          {loading ? (
            <div className="loading-center"><div className="spinner"></div><p>Загрузка чеков...</p></div>
          ) : paginatedReceipts.length === 0 ? (
            <p className="empty-state">Нет чеков. Загрузите первый!</p>
          ) : (
            <>
              <div className="receipts-grid">
                {paginatedReceipts.map((receipt, idx) => {
                  const itemsTotal = calculateItemsTotal(receipt.items);
                  const total = parseFloat(receipt.total_amount) || 0;
                  const diff = Math.abs(total - itemsTotal).toFixed(2);
                  // Δ имеет смысл только для документов со строками товаров (чек/фактура/счёт);
                  // у договоров, полисов и выписок суммы нет строк — Δ не показываем
                  const hasDiff = diff > 0.01 && ['receipt', 'invoice', 'bill'].includes(receipt.document_type || 'receipt');
                  // Заголовок группы, когда меняется год-месяц
                  const gk = groupKeyOf(receipt);
                  const prevGk = idx > 0 ? groupKeyOf(paginatedReceipts[idx - 1]) : null;
                  const showGroupHeader = gk !== prevGk;
                  const groupCount = showGroupHeader ? paginatedReceipts.filter(r => groupKeyOf(r) === gk).length : 0;
                  return (
                    <React.Fragment key={receipt.id}>
                    {showGroupHeader && (
                      <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10, margin: idx === 0 ? '0 0 4px' : '14px 0 4px' }}>
                        <span style={{ fontSize: 16, fontWeight: 700, color: '#2c3e50', whiteSpace: 'nowrap' }}>
                          {groupTitleOf(receipt)}
                        </span>
                        <span style={{ fontSize: 12, color: '#666', background: '#f0f2f5', borderRadius: 10, padding: '2px 10px', whiteSpace: 'nowrap' }}>
                          {groupCount} шт
                        </span>
                        <div style={{ flex: 1, height: 1, background: '#e3e6ea' }} />
                      </div>
                    )}
                    <div className="receipt-card">
                      {/* flexWrap + min-ширина заголовка: длинный бейдж типа (🤝 КОММ. ПРЕДЛОЖЕНИЕ)
                          на узком экране уходит ПОД заголовок, а не сжимает его до 3 букв в строке */}
                      <div className="receipt-header" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, paddingTop: 2, flexWrap: 'wrap' }}>
                        <input type="checkbox" checked={selectedReceiptIds.has(receipt.id)} onChange={() => toggleSelect(receipt.id)} style={{ width: 20, height: 20, cursor: 'pointer', flexShrink: 0, marginTop: 2 }} />
                        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                          <h3 style={{ margin: 0, lineHeight: 1.3, overflowWrap: 'break-word' }}>
                            <HighlightText text={receipt.store_name || receipt.store_name_ru || 'Без названия'} query={searchQuery} />
                          </h3>
                          {(dupAllIds.has(receipt.id) || expiryInfo(receipt) || (Array.isArray(receipt.page_urls) && receipt.page_urls.length > 1)) && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
                              {dupAllIds.has(receipt.id) && (
                                dupCopyIds.has(receipt.id)
                                  ? <span title="Дубликат: совпадают название, дата и сумма; № договора/CUPS/адрес/объект и распознанный текст НЕ различаются" style={{ background: '#e74c3c', color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 10 }}>КОПИЯ</span>
                                  : <span title="Оригинал (самый ранний из группы дубликатов)" style={{ background: '#27ae60', color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 10 }}>ОРИГИНАЛ</span>
                              )}
                              {expiryInfo(receipt) && (
                                <span title={`Срок действия до ${formatDate(receipt.valid_to)}`} style={{ background: expiryInfo(receipt).color, color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 10 }}>{expiryInfo(receipt).text}</span>
                              )}
                              {Array.isArray(receipt.page_urls) && receipt.page_urls.length > 1 && (
                                <span title={`Документ из ${receipt.page_urls.length} страниц — все страницы сохранены, смотрите в карточке`} style={{ background: '#8e44ad', color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 10 }}>📑 {receipt.page_urls.length} стр.</span>
                              )}
                            </div>
                          )}
                        </div>
                        <span className="type-badge" style={{ flexShrink: 0, marginLeft: 'auto' }}>{DOC_TYPE_LABELS[receipt.document_type] || receipt.document_type || '🧾 Чек'}</span>
                        {/* Значок статуса оплаты в правом верхнем углу карточки: 🟢 оплачено / 🟠 к оплате / 🔴 недоплачено */}
                        {receipt.payment_status && PAYMENT_STATUS_META[receipt.payment_status] && (
                          <span
                            title={`Статус оплаты: ${PAYMENT_STATUS_META[receipt.payment_status].label}`}
                            style={{ flexShrink: 0, width: 24, height: 24, fontSize: 14, lineHeight: '22px', textAlign: 'center', background: PAYMENT_STATUS_META[receipt.payment_status].bg, border: `1px solid ${PAYMENT_STATUS_META[receipt.payment_status].color}`, borderRadius: '50%' }}
                          >{PAYMENT_STATUS_META[receipt.payment_status].short}</span>
                        )}
                      </div>
                      <p className="date">{formatDate(receipt.receipt_date)} {receipt.receipt_time}</p>
                      <p className="amount" style={{ color: hasDiff ? '#e67e22' : '#27ae60' }}>
                        {formatAmount(receipt.total_amount, receipt.currency)}
                        {hasDiff && <span style={{ fontSize: 12, color: '#e74c3c', marginLeft: 6 }}>(Δ {diff})</span>}
                      </p>
                      <p className="items-count"> {receipt.items?.length || 0} товаров</p>
                      {receipt.object && (
                        <p style={{ fontSize: 12, color: '#7f8c8d', margin: '4px 0' }}>
                          <HighlightText text={receipt.object} query={searchQuery} />
                          {receipt.subtype && <span style={{ marginLeft: 6, color: '#95a5a6' }}>{SUBTYPE_LABELS[receipt.subtype] || receipt.subtype}</span>}
                          {receipt.consumption != null && <span style={{ marginLeft: 6, color: '#95a5a6' }}>{receipt.consumption} {receipt.consumption_unit || ''}</span>}
                        </p>
                      )}
                      {receipt.supply_address && (
                        <p style={{ fontSize: 11, color: '#95a5a6', margin: '2px 0' }}>
                          <HighlightText text={receipt.supply_address} query={searchQuery} />
                        </p>
                      )}
                      <p style={{ fontSize: 12, color: '#3498db', margin: '4px 0', fontWeight: 500 }}>
                        <HighlightText text={formatOwnerName(receipt)} query={searchQuery} />
                      </p>
                      {(receipt.photo_url || receipt.image_url) ? (
                        isPdfUrl(receipt.photo_url || receipt.image_url) ? (
                          <div className="no-image-thumb">📄 PDF</div>
                        ) : (
                          <img src={fixImageUrl(receipt.photo_url || receipt.image_url)} alt="Чек" className="receipt-thumb" onError={(e) => { e.target.style.display = 'none'; }} />
                        )
                      ) : (
                        <div className="no-image-thumb"> Чек</div>
                      )}
                      <div className="receipt-actions">
                        <button onClick={() => setViewModal(receipt)}> Просмотр</button>
                        {user?.role === 'admin' && (
                          <button onClick={() => deleteReceipt(receipt.id)} className="danger"> Удалить</button>
                        )}
                      </div>
                    </div>
                    </React.Fragment>
                  );
                })}
              </div>

              {itemsPerPage !== 'all' && totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 20 }}>
                  <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: currentPage === 1 ? '#ddd' : '#3498db', color: 'white', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}>◀ Назад</button>
                  <span>Страница {currentPage} из {totalPages}</span>
                  <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: currentPage === totalPages ? '#ddd' : '#3498db', color: 'white', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}>Вперёд ▶</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {/* v30: «Налоги» — отдельная вкладка со своим содержимым (блок ниже) */}
      {activeTab === 'analysis' && (
        <div className="analysis-section" style={{ padding: '6px 0 20px' }}>
          {(() => {
            const isOut = m => Number(m.amount) < 0;
            const out = bankMovements.filter(isOut);
            const matched = bankMovements.filter(m => m.matched_receipt_id);
            const unmatchedOut = out.filter(m => !m.matched_receipt_id);
            const unpaidBills = receipts.filter(r => ['bill', 'invoice'].includes(r.document_type) && !r.bank_movement_id && r.payment_status !== 'paid');
            const stat = (label, value, color, bg) => (
              <div key={label} style={{ flex: '1 1 150px', background: bg, border: `1px solid ${color}`, borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
                <div style={{ fontSize: 12, color: '#555' }}>{label}</div>
              </div>
            );
            const q = bankSearch.trim().toLowerCase();
            const linkedReceiptOf = m => m.matched_receipt_id ? receipts.find(r => String(r.id) === String(m.matched_receipt_id)) : null;
            // Уникальные контрагенты выписки (с количеством движений) для выпадающего фильтра
            const counterpartyCounts = {};
            bankMovements.forEach(m => {
              const cp = String(m.counterparty || '').trim();
              if (cp) counterpartyCounts[cp] = (counterpartyCounts[cp] || 0) + 1;
            });
            const counterparties = Object.entries(counterpartyCounts).sort((a, b) => b[1] - a[1]);
            const resetBankFilters = () => { setBankFilter('all'); setBankSearch(''); setBankDateFrom(''); setBankDateTo(''); setBankCpFilter([]); };
            const hasActiveFilters = bankFilter !== 'all' || bankSearch || bankDateFrom || bankDateTo || bankCpFilter.length > 0;
            const visible = bankMovements.filter(m => {
              if (bankCpFilter.length && !bankCpFilter.includes(String(m.counterparty || '').trim())) return false;
              if (bankFilter === 'out' && !isOut(m)) return false;
              if (bankFilter === 'in' && isOut(m)) return false;
              if (bankFilter === 'matched' && !m.matched_receipt_id) return false;
              if (bankFilter === 'unmatched' && (!isOut(m) || m.matched_receipt_id)) return false;
              if (bankDateFrom && (!m.operation_date || m.operation_date < bankDateFrom)) return false;
              if (bankDateTo && (!m.operation_date || m.operation_date > bankDateTo)) return false;
              if (q) {
                const linked = linkedReceiptOf(m);
                const hay = [m.concept, m.counterparty, m.prefix, m.account_name, m.iban, m.amount, m.balance,
                  linked && linked.store_name, linked && linked.store_name_ru, linked && linked.provider, linked && linked.invoice_number]
                  .map(v => String(v == null ? '' : v).toLowerCase()).join(' ');
                if (!hay.includes(q)) return false;
              }
              return true;
            });
            const sumOf = list => ({
              out: list.filter(isOut).reduce((s, m) => s + Math.abs(Number(m.amount) || 0), 0),
              inc: list.filter(m => !isOut(m)).reduce((s, m) => s + Math.abs(Number(m.amount) || 0), 0)
            });
            const sumAll = sumOf(bankMovements);
            const sumVis = sumOf(visible);
            return (
              <>
                <h3 style={{ margin: '4px 0 10px' }}>{activeTab === 'taxes' ? '🧾 Налоги — выписка и привязка платежей (полная копия «Анализа»)' : '🏦 Банковская выписка — привязка платежей к фактурам'}</h3>
                {bankMovements.length === 0 && !bankLoading && (
                  <div style={{ background: '#fff8e6', border: '1px solid #f0c36d', borderRadius: 10, padding: 16, marginBottom: 12 }}>
                    Выписка ещё не загружена. Откройте вкладку «Загрузка» → кнопка «🏦 Выписка банка» и выберите Excel-файл (.xlsx) из банка — движения появятся здесь, а фактуры с совпавшими суммами сами получат статус 🟢 Оплачено.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                  {stat('Движений в выписке', bankMovements.length, '#2c3e50', '#f4f6f7')}
                  {stat('Привязано автоматически', matched.length, '#27ae60', '#e8f8ef')}
                  {stat('Платежи без фактуры', unmatchedOut.length, '#e67e22', '#fdf2e3')}
                  {stat('Счета без платежа в банке', unpaidBills.length, '#e74c3c', '#fdecea')}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                  <select value={bankFilter} onChange={e => setBankFilter(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6 }}>
                    <option value="all">Все движения</option>
                    <option value="out">Только платежи</option>
                    <option value="in">Только поступления</option>
                    <option value="matched">Привязанные</option>
                    <option value="unmatched">Платежи без пары</option>
                  </select>
                  <input type="date" value={bankDateFrom} onChange={e => setBankDateFrom(e.target.value)} title="С даты" style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #ddd' }} />
                  <span style={{ color: '#95a5a6' }}>—</span>
                  <input type="date" value={bankDateTo} onChange={e => setBankDateTo(e.target.value)} title="По дату" style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #ddd' }} />
                  <ExcelFilter label="Контрагент" options={counterparties.map(([cp, cnt]) => ({ value: cp, label: `${cp} (${cnt})` }))} selected={bankCpFilter} onChange={setBankCpFilter} />
                  <input value={bankSearch} onChange={e => setBankSearch(e.target.value)} placeholder="Поиск по всем полям…" style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', flex: '1 1 200px' }} />
                  {hasActiveFilters && (
                    <button onClick={resetBankFilters} title="Сбросить все фильтры" style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #e74c3c', background: '#fff', color: '#e74c3c', cursor: 'pointer', fontWeight: 700 }}>✖ Сброс</button>
                  )}
                  <button onClick={rematchBank} title="Повторно запустить автопривязку (после загрузки новых фактур)" style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#8e44ad', color: '#fff', cursor: 'pointer' }}>🔁 Автопривязка</button>
                  <button onClick={loadBankMovements} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#3498db', color: '#fff', cursor: 'pointer' }}>🔄 Обновить</button>
                </div>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: '#555', marginBottom: 10, background: '#f4f6f7', borderRadius: 8, padding: '6px 10px' }}>
                  <span>Показано строк: <b>{visible.length}</b> из {bankMovements.length}</span>
                  <span>Σ по фильтру: <b style={{ color: '#e74c3c' }}>−{formatAmount(sumVis.out, 'EUR')}</b> / <b style={{ color: '#27ae60' }}>+{formatAmount(sumVis.inc, 'EUR')}</b></span>
                  <span>Σ всей выписки: <b style={{ color: '#e74c3c' }}>−{formatAmount(sumAll.out, 'EUR')}</b> / <b style={{ color: '#27ae60' }}>+{formatAmount(sumAll.inc, 'EUR')}</b></span>
                </div>
                {bankLoading && <div className="loading-center"><div className="spinner"></div><p>Загрузка движений...</p></div>}
                {!bankLoading && visible.map(m => {
                  const linked = linkedReceiptOf(m);
                  return (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#fff', borderRadius: 8, padding: '8px 10px', marginBottom: 6, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                      <span style={{ flex: '0 0 86px', color: '#7f8c8d', fontSize: 13 }}>{formatDate(m.operation_date)}</span>
                      <span style={{ flex: '1 1 240px', minWidth: 0, overflowWrap: 'break-word', fontSize: 14 }}>
                        <b>{m.concept || '—'}</b>
                        {m.prefix && <span style={{ marginLeft: 6, fontSize: 11, color: '#95a5a6' }}>{m.prefix}</span>}
                      </span>
                      <span style={{ flex: '0 0 130px', textAlign: 'right' }}>
                        <span style={{ fontWeight: 700, color: isOut(m) ? '#e74c3c' : '#27ae60' }}>
                          {isOut(m) ? '−' : '+'}{formatAmount(Math.abs(Number(m.amount)), 'EUR')}
                        </span>
                        {m.balance != null && (
                          <div style={{ fontSize: 10, color: '#95a5a6', fontWeight: 400 }}>остаток {formatAmount(Number(m.balance), 'EUR')}</div>
                        )}
                      </span>
                      {m.matched_receipt_id ? (
                        <>
                          <button onClick={() => openReceiptById(m.matched_receipt_id)} title={linked ? `Открыть: ${linked.store_name || linked.store_name_ru || 'документ'}` : 'Открыть документ'} style={{ flex: '0 0 auto', border: '1px solid #27ae60', background: '#e8f8ef', color: '#27ae60', borderRadius: 10, padding: '3px 10px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                            🟢 {linked ? (linked.store_name || linked.store_name_ru || 'Документ') : `Чек #${m.matched_receipt_id}`}{m.match_status === 'manual' ? ' · ✋' : (m.match_score ? ` · ${m.match_score}б` : '')}
                          </button>
                          <button onClick={() => unlinkMovement(m.id)} title="Отвязать платёж от фактуры" style={{ flex: '0 0 auto', border: '1px solid #e74c3c', background: '#fff', color: '#e74c3c', borderRadius: 10, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}>✖</button>
                        </>
                      ) : (
                        isOut(m) && (
                          <>
                            <span style={{ flex: '0 0 auto', fontSize: 12, color: '#e67e22', background: '#fdf2e3', borderRadius: 10, padding: '3px 10px', fontWeight: 700 }}>⚪ Без фактуры</span>
                            <button onClick={() => { setLinkPicker(m); setLinkSearch(''); }} title="Привязать платёж к фактуре вручную" style={{ flex: '0 0 auto', border: 'none', background: '#8e44ad', color: '#fff', borderRadius: 10, padding: '3px 10px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>🔗 Привязать</button>
                          </>
                        )
                      )}
                    </div>
                  );
                })}
                {!bankLoading && bankMovements.length > 0 && visible.length === 0 && (
                  <p style={{ color: '#95a5a6' }}>Ничего не найдено по текущему фильтру.</p>
                )}
                {linkPicker && (() => {
                  const mvAmt = Math.abs(Number(linkPicker.amount) || 0);
                  const lq = linkSearch.trim().toLowerCase();
                  const candidates = receipts
                    .filter(r => !lq || [r.store_name, r.store_name_ru, r.provider, r.invoice_number, r.contract_number, r.total_amount]
                      .some(v => String(v == null ? '' : v).toLowerCase().includes(lq)))
                    .map(r => ({ r, exact: Math.abs(Math.abs(Number(r.total_amount) || 0) - mvAmt) < 0.01 }))
                    .sort((a, b) =>
                      (b.exact - a.exact) ||
                      ((a.r.payment_status === 'paid' ? 1 : 0) - (b.r.payment_status === 'paid' ? 1 : 0)) ||
                      (Math.abs(Math.abs(Number(a.r.total_amount) || 0) - mvAmt) - Math.abs(Math.abs(Number(b.r.total_amount) || 0) - mvAmt)))
                    .slice(0, 50);
                  return (
                    <div className="modal-overlay" onClick={() => !linkSaving && setLinkPicker(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 18, width: '100%', maxWidth: 560, maxHeight: '80vh', overflowY: 'auto' }}>
                        <h3 style={{ marginTop: 0 }}>🔗 Привязать платёж к фактуре</h3>
                        <div style={{ background: '#f4f6f7', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 13 }}>
                          <b>{linkPicker.concept || '—'}</b><br />
                          {formatDate(linkPicker.operation_date)} · <b style={{ color: '#e74c3c' }}>−{formatAmount(mvAmt, 'EUR')}</b>
                          <div style={{ fontSize: 12, color: '#7f8c8d', marginTop: 4 }}>
                            Если оплата разбита на части — привяжите каждый платёж к одной и той же фактуре: статус станет «Недоплачено», а когда сумма платежей покроет фактуру — «Оплачено».
                          </div>
                        </div>
                        <input autoFocus value={linkSearch} onChange={e => setLinkSearch(e.target.value)} placeholder="Поиск фактуры: название, поставщик, № фактуры, сумма…" style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 6, border: '1px solid #ddd', marginBottom: 10 }} />
                        {candidates.length === 0 && <p style={{ color: '#95a5a6' }}>Фактуры не найдены.</p>}
                        {candidates.map(({ r, exact }) => (
                          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 8, marginBottom: 4, background: exact ? '#e8f8ef' : '#fafafa', border: exact ? '1px solid #27ae60' : '1px solid #eee' }}>
                            <span style={{ flex: '1 1 auto', minWidth: 0, overflowWrap: 'break-word', fontSize: 14 }}>
                              <b>{r.store_name || r.store_name_ru || 'Без названия'}</b>{exact && <span style={{ marginLeft: 6, fontSize: 11, color: '#27ae60', fontWeight: 700 }}>сумма совпадает</span>}
                              <span style={{ marginLeft: 8, fontSize: 12, color: '#7f8c8d' }}>{formatDate(r.receipt_date)}</span>
                              {r.payment_status && PAYMENT_STATUS_META[r.payment_status] && (
                                <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: PAYMENT_STATUS_META[r.payment_status].color }}>{PAYMENT_STATUS_META[r.payment_status].short} {PAYMENT_STATUS_META[r.payment_status].label}</span>
                              )}
                            </span>
                            <span style={{ flex: '0 0 auto', fontWeight: 700, fontSize: 13 }}>{formatAmount(r.total_amount, r.currency || 'EUR')}</span>
                            <button disabled={linkSaving} onClick={() => linkMovement(linkPicker.id, r.id)} style={{ flex: '0 0 auto', border: 'none', background: '#27ae60', color: '#fff', borderRadius: 8, padding: '5px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                              {linkSaving ? '…' : 'Привязать'}
                            </button>
                          </div>
                        ))}
                        <button onClick={() => setLinkPicker(null)} disabled={linkSaving} style={{ marginTop: 10, width: '100%', padding: '8px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}>Отмена</button>
                      </div>
                    </div>
                  );
                })()}
              </>
            );
          })()}
        </div>
      )}
      {/* ========== ВКЛАДКА «НАЛОГИ» (v30) ========== */}
      {activeTab === 'taxes' && (() => {
        const today = new Date();
        const year = today.getFullYear();
        // Ближайшее наступление каждого дедлайна: если дата этого года прошла — берём следующий год
        const events = TAX_CALENDAR.map(ev => {
          let dl = new Date(year, ev.deadline.m - 1, ev.deadline.d);
          if (dl.getTime() < Date.now() - 86400000) dl = new Date(year + 1, ev.deadline.m - 1, ev.deadline.d);
          const daysLeft = Math.round((dl.getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000);
          return { ...ev, dl, daysLeft };
        }).sort((a, b) => a.dl - b.dl);
        const shown = events.filter(ev => taxShowOptional || !ev.optional);
        const soon = shown.filter(ev => ev.daysLeft >= 0 && ev.daysLeft <= 35);
        const [qFrom, qTo] = taxQuarterRange(taxQuarter);
        const qOut = bankMovements.filter(m => Number(m.amount) < 0 && m.operation_date && m.operation_date >= qFrom && m.operation_date <= qTo);
        const fmtD = d => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
        const quarterOptions = [];
        for (let y = year - 1; y <= year + 1; y++) for (let q = 1; q <= 4; q++) quarterOptions.push(`${y}-${q}T`);
        return (
          <div style={{ padding: '6px 0 20px' }}>
            <h2 style={{ margin: '4px 0 4px' }}>🧾 Налоги (Испания · Канары)</h2>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: '#7f8c8d' }}>
              Календарь подачи, справочник форм, галка «есть фактура» и автозаполнение черновиков из банка.
              Черновики — помощник для переноса цифр в официальную веб-форму, а не налоговая консультация.
            </p>

            {/* ОПОВЕЩЕНИЕ: за месяц до дедлайна — что подать и что подготовить */}
            {soon.length > 0 && (
              <div style={{ background: '#fdecea', border: '2px solid #e74c3c', borderRadius: 10, padding: '12px 16px', marginBottom: 14 }}>
                <strong style={{ color: '#c0392b', fontSize: 15 }}>⏰ До дедлайна меньше месяца — готовьте документы:</strong>
                {soon.map(ev => (
                  <div key={ev.id} style={{ marginTop: 8, fontSize: 14 }}>
                    <span style={{ display: 'inline-block', minWidth: 170, fontWeight: 700 }}>{fmtD(ev.dl)} (через {ev.daysLeft} дн.)</span>
                    <strong>{ev.name}</strong>
                    <div style={{ color: '#555', fontSize: 13 }}>{ev.what}</div>
                  </div>
                ))}
                <div style={{ marginTop: 10, fontSize: 13, color: '#7f8c8d' }}>
                  Проверьте: все платежи квартала размечены галкой «есть фактура» → нажмите «Заполнить формы из банка» → скачайте черновик → перенесите цифры в sede electrónica.
                </div>
              </div>
            )}

            {/* КАЛЕНДАРЬ ПЛАТЕЖЕЙ И ПОДАЧИ (выпадающий, по умолчанию свёрнут — v30.1) */}
            <details style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: '12px 16px', marginBottom: 14 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 16, userSelect: 'none' }}>
                📅 Календарь налоговых дедлайнов <span style={{ fontSize: 12, color: '#95a5a6', fontWeight: 400 }}>(нажмите, чтобы развернуть)</span>
              </summary>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '10px 0 8px' }}>
                <label style={{ fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={taxShowOptional} onChange={e => setTaxShowOptional(e.target.checked)} style={{ marginRight: 5 }} />
                  показать формы «если есть работники/аренда офиса» (111/115/190/180)
                </label>
              </div>
              {shown.map(ev => (
                <div key={ev.id} style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 14, flexWrap: 'wrap' }}>
                  <span style={{ minWidth: 165, fontWeight: 600 }}>{fmtD(ev.dl)}</span>
                  <span style={{
                    minWidth: 110, fontWeight: 700, fontSize: 12, borderRadius: 8, padding: '2px 8px',
                    background: ev.daysLeft <= 35 ? '#fdecea' : ev.daysLeft <= 65 ? '#fff8e1' : '#eafaf1',
                    color: ev.daysLeft <= 35 ? '#c0392b' : ev.daysLeft <= 65 ? '#b9770e' : '#1e8449'
                  }}>через {ev.daysLeft} дн.</span>
                  <span style={{ fontWeight: 700 }}>{ev.name}</span>
                  <span style={{ color: '#7f8c8d', fontSize: 13, flex: '1 1 260px' }}>{ev.what}</span>
                </div>
              ))}
            </details>

            {/* СПРАВОЧНИК: какие налоги и какие документы подавать (выпадающий, свёрнут — v30.1) */}
            <details style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: '12px 16px', marginBottom: 14 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 16, userSelect: 'none', marginBottom: 2 }}>
                📚 Справочник: какие налоги и какие документы подавать <span style={{ fontSize: 12, color: '#95a5a6', fontWeight: 400 }}>(нажмите, чтобы развернуть)</span>
              </summary>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 12, marginTop: 10 }}>
                {TAX_GUIDE.map(g => (
                  <div key={g.form} style={{ border: `1px solid ${g.color}55`, borderLeft: `4px solid ${g.color}`, borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontWeight: 800, color: g.color, marginBottom: 6 }}>{g.title}</div>
                    <div style={{ fontSize: 13, marginBottom: 4 }}><strong>Кто подаёт:</strong> {g.who}</div>
                    <div style={{ fontSize: 13, marginBottom: 4 }}><strong>Что:</strong> {g.what}</div>
                    <div style={{ fontSize: 13, marginBottom: 4 }}><strong>Документы:</strong> {g.docs}</div>
                    <div style={{ fontSize: 13, marginBottom: 8 }}><strong>Когда:</strong> {g.when}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <a href={g.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, background: g.color, color: '#fff', padding: '5px 10px', borderRadius: 6, textDecoration: 'none' }}>🌐 Официальная страница</a>
                      {TAX_FORM_TEMPLATES[g.form] && (
                        <>
                          <button onClick={() => downloadTextFile(`modelo-${g.form}-blank.txt`, TAX_FORM_TEMPLATES[g.form].blank)} style={{ fontSize: 12, border: `1px solid ${g.color}`, background: '#fff', color: g.color, padding: '5px 10px', borderRadius: 6, cursor: 'pointer' }}>⬇ Бланк</button>
                          <button onClick={() => downloadTextFile(`modelo-${g.form}-ejemplo.txt`, TAX_FORM_TEMPLATES[g.form].example)} style={{ fontSize: 12, border: `1px solid ${g.color}`, background: '#fff', color: g.color, padding: '5px 10px', borderRadius: 6, cursor: 'pointer' }}>⬇ Пример заполнения</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </details>

            {/* ПЛАТЕЖИ БАНКА ЗА КВАРТАЛ + ГАЛКА «ЕСТЬ ФАКТУРА» */}
            <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: '12px 16px', marginBottom: 14 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>💶 Платежи из банка за квартал — отметьте, по каким есть фактура</h3>
                <select value={taxQuarter} onChange={e => setTaxQuarter(e.target.value)} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #ccc' }}>
                  {quarterOptions.map(k => <option key={k} value={k}>{k.replace('-', ' · ')}</option>)}
                </select>
                <button onClick={loadBankMovements} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}>🔄 Обновить движения</button>
                <span style={{ fontSize: 13, color: '#7f8c8d' }}>{qFrom} … {qTo} · исходящих: {qOut.length} · с фактурой: {qOut.filter(m => m.has_invoice || m.matched_receipt_id).length}</span>
              </div>
              {qOut.length === 0 && <p style={{ color: '#7f8c8d', fontSize: 13 }}>Нет исходящих платежей за этот квартал — загрузите выписку банка на вкладке «Загрузка» (🏦 Выписка банка).</p>}
              {qOut.map(m => {
                const linked = m.matched_receipt_id ? receipts.find(r => String(r.id) === String(m.matched_receipt_id)) : null;
                return (
                  <div key={m.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 13, flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', minWidth: 150, fontWeight: 700, color: m.has_invoice ? '#1e8449' : '#95a5a6' }}
                      title="Галка = по этому платежу есть фактура → платёж попадает в расходы modelo 130/420">
                      <input type="checkbox" checked={!!m.has_invoice} onChange={() => toggleInvoiceFlag(m)} />
                      📄 есть фактура
                    </label>
                    <span style={{ minWidth: 92, color: '#7f8c8d' }}>{m.operation_date}</span>
                    <span style={{ flex: '1 1 220px' }}>{m.counterparty || m.concept || '—'}</span>
                    <span style={{ minWidth: 100, textAlign: 'right', fontWeight: 700, color: '#c0392b' }}>{formatAmount(Math.abs(Number(m.amount)), 'EUR')}</span>
                    {linked
                      ? <button onClick={() => openReceiptById(linked.id)} style={{ fontSize: 12, border: '1px solid #27ae60', color: '#1e8449', background: '#eafaf1', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>🔗 {(linked.store_name || 'фактура')} · {formatAmount(linked.total_amount, linked.currency || 'EUR')}</button>
                      : <span style={{ fontSize: 12, color: '#b2babb' }}>не привязан</span>}
                  </div>
                );
              })}
            </div>

            {/* АВТОЗАПОЛНЕНИЕ ФОРМ ИЗ БАНКА ЗА ДИАПАЗОН КВАРТАЛОВ (v30.1) */}
            <div style={{ background: 'linear-gradient(135deg,#eaf3fb,#f4ecf7)', border: '2px solid #8e44ad', borderRadius: 10, padding: '12px 16px' }}>
              <h3 style={{ margin: '0 0 6px' }}>🤖 Автозаполнение форм из банка</h3>
              <p style={{ fontSize: 13, color: '#555', margin: '0 0 10px' }}>
                Выберите диапазон кварталов (например, 1T 2025 → 2T 2026). Доходы = поступления квартала; расходы = платежи с галкой «есть фактура»
                (или привязанные к фактуре); IGIC soportado — из поля «налог» привязанных фактур. За прошлые кварталы, где налог не платился,
                отдельно считаются штраф-надбавка (recargo 1% + 1% за каждый полный месяц, после 12 мес. — 15%) и пени (intereses 4,0625% годовых с 13-го месяца просрочки).
                Нажимайте «Финальный пересчёт» перед подачей — черновик всегда собирается из свежих данных.
              </p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14 }}>с</span>
                <select value={taxQFrom} onChange={e => setTaxQFrom(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #8e44ad' }}>
                  {quarterOptions.map(k => <option key={k} value={k}>{k.replace('-', ' · ')}</option>)}
                </select>
                <span style={{ fontSize: 14 }}>по</span>
                <select value={taxQTo} onChange={e => setTaxQTo(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #8e44ad' }}>
                  {quarterOptions.map(k => <option key={k} value={k}>{k.replace('-', ' · ')}</option>)}
                </select>
                <button
                  onClick={() => setTaxDraft(computeTaxRange(taxQFrom, taxQTo))}
                  style={{ background: '#8e44ad', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}
                >
                  🧮 Заполнить формы из банка
                </button>
              </div>
            </div>

            {/* МОДАЛКА ЧЕРНОВИКА ФОРМ (диапазон кварталов, v30.1) */}
            {taxDraft && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
                onClick={() => setTaxDraft(null)}>
                <div style={{ background: '#fff', borderRadius: 12, maxWidth: 780, width: '100%', maxHeight: '88vh', overflow: 'auto', padding: 20 }} onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <h3 style={{ margin: 0 }}>🧮 Черновики {taxDraft.fromKey.replace('-', ' · ')} — {taxDraft.toKey.replace('-', ' · ')}
                      <span style={{ fontSize: 12, color: '#7f8c8d', marginLeft: 8 }}>кварталов: {taxDraft.quarters.length}{taxDraft.lateCount ? ` · ⚠ просрочено: ${taxDraft.lateCount}` : ''}</span>
                    </h3>
                    <button onClick={() => setTaxDraft(null)} style={{ border: 'none', background: '#eee', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>✖</button>
                  </div>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 10 }}>
                    <span style={{ color: '#555' }}>Ставка IGIC, %:</span>
                    <input type="number" step="0.5" value={taxDraft.igicRate}
                      onChange={e => setTaxDraft(prev => computeTaxRange(prev.fromKey, prev.toKey, { ...prev, igicRate: parseFloat(e.target.value) || 0 }))}
                      style={{ width: 70, padding: '5px 8px', borderRadius: 6, border: '1px solid #ccc' }} />
                  </label>

                  {taxDraft.quarters.map(x => {
                    const late = x.isLate && (x.result420 > 0 || x.result130 > 0);
                    return (
                      <div key={x.key} style={{ border: `1px solid ${late ? '#e74c3c' : '#e0e0e0'}`, borderLeft: `4px solid ${late ? '#e74c3c' : '#8e44ad'}`, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                          <strong>{x.key.replace('-', ' · ')} <span style={{ fontSize: 12, color: '#7f8c8d' }}>({x.from}…{x.to})</span></strong>
                          <span style={{ fontSize: 12, color: '#7f8c8d' }}>поступлений {x.counts.incCount} · расходов с фактурой {x.counts.outInvCount} из {x.counts.outCount}</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, fontSize: 13, marginBottom: 8 }}>
                          {[
                            [`ingresos_${x.y}_${x.q}`, 'Доходы, €'],
                            [`gastos_${x.y}_${x.q}`, 'Расходы с фактурами, €'],
                            [`igicSop_${x.y}_${x.q}`, 'IGIC soportado, €'],
                          ].map(([field, label]) => (
                            <label key={field} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <span style={{ color: '#555' }}>{label}</span>
                              <input type="number" step="0.01" value={x[field.startsWith('igicSop') ? 'igicSoportado' : field.startsWith('gastos') ? 'gastos' : 'ingresos']}
                                onChange={e => setTaxDraft(prev => computeTaxRange(prev.fromKey, prev.toKey, { ...prev, [field]: parseFloat(e.target.value) || 0 }))}
                                style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #ccc' }} />
                            </label>
                          ))}
                        </div>
                        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                          <div role="button" onClick={() => setTaxFormPopup({ form: '420', q: x })} title="Открыть заполненную modelo 420"
                            style={{ cursor: 'pointer', borderRadius: 6, padding: '3px 6px', marginLeft: -6 }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f4ecf7'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            📄 <strong style={{ color: '#8e44ad', textDecoration: 'underline dotted' }}>Modelo 420</strong> (IGIC): cuota {formatAmount(x.igicRepercutido, 'EUR')} − deducible {formatAmount(x.igicSoportado, 'EUR')} = <strong>{formatAmount(x.result420, 'EUR')}</strong>
                            {x.result420 < 0 && <span style={{ fontSize: 12, color: '#1e8449' }}> → к компенсации</span>}
                          </div>
                          <div role="button" onClick={() => setTaxFormPopup({ form: '130', q: x })} title="Открыть заполненную modelo 130"
                            style={{ cursor: 'pointer', borderRadius: 6, padding: '3px 6px', marginLeft: -6 }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f4ecf7'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            📄 <strong style={{ color: '#8e44ad', textDecoration: 'underline dotted' }}>Modelo 130</strong> (IRPF, нарастающим): рендимьенто {formatAmount(x.rendCum, 'EUR')} × 20% − авансы {formatAmount(x.prev130, 'EUR')} = <strong>{formatAmount(x.result130, 'EUR')}</strong>
                          </div>
                          {late && (
                            <div style={{ color: '#c0392b', fontWeight: 700, background: '#fdecea', borderRadius: 6, padding: '6px 8px', marginTop: 6 }}>
                              ⚠ ПРОСРОЧЕНО (дедлайн {x.dl.toLocaleDateString('ru-RU')}, {x.monthsLate} мес.): штраф-надбавка recargo {(x.recargoRate * 100).toFixed(0)}% = {formatAmount(x.recargo, 'EUR')}{x.intereses > 0 ? ` + пени intereses = ${formatAmount(x.intereses, 'EUR')}` : ' (пени начнутся с 13-го месяца просрочки)'}
                            </div>
                          )}
                          {/* Галки «есть фактура» по платежам ЭТОГО квартала — прямо в модалке (v30.2) */}
                          {x.counts.outCount > 0 && (
                            <details style={{ marginTop: 8 }}>
                              <summary style={{ cursor: 'pointer', fontSize: 13, color: '#555' }}>
                                💶 Платежи квартала — отметьте, по каким есть фактура ({x.counts.outInvCount} из {x.counts.outCount})
                              </summary>
                              <div style={{ marginTop: 4, maxHeight: 220, overflow: 'auto', border: '1px solid #eee', borderRadius: 6, padding: '4px 8px' }}>
                                {bankMovements
                                  .filter(m => Number(m.amount) < 0 && m.operation_date && m.operation_date >= x.from && m.operation_date <= x.to)
                                  .map(m => (
                                    <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #f5f5f5', fontSize: 12, flexWrap: 'wrap' }}>
                                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontWeight: 700, color: m.has_invoice ? '#1e8449' : '#95a5a6' }}>
                                        <input type="checkbox" checked={!!m.has_invoice} onChange={() => toggleInvoiceFlagAndRecalc(m)} />
                                        📄 фактура
                                      </label>
                                      <span style={{ color: '#7f8c8d', minWidth: 86 }}>{m.operation_date}</span>
                                      <span style={{ flex: '1 1 160px' }}>{m.counterparty || m.concept || '—'}</span>
                                      <span style={{ fontWeight: 700, color: '#c0392b' }}>{formatAmount(Math.abs(Number(m.amount)), 'EUR')}</span>
                                    </div>
                                  ))}
                                <div style={{ fontSize: 11, color: '#95a5a6', padding: '4px 0' }}>Галка сразу сохраняется и пересчитывает весь черновик.</div>
                              </div>
                            </details>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* СУММА К ОПЛАТЕ — отдельный красный блок */}
                  <div style={{ background: '#fdecea', border: '2px solid #c0392b', borderRadius: 10, padding: '12px 16px', marginBottom: 12 }}>
                    <div style={{ fontSize: 14, display: 'grid', gap: 4 }}>
                      <div>IGIC (modelo 420) к оплате: <strong>{formatAmount(Math.max(0, taxDraft.total420), 'EUR')}</strong>
                        {taxDraft.total420 < 0 && <span style={{ fontSize: 12, color: '#1e8449' }}> (ещё {formatAmount(Math.abs(taxDraft.total420), 'EUR')} к компенсации в следующих кварталах — a compensar)</span>}
                      </div>
                      <div>IRPF (modelo 130) к оплате: <strong>{formatAmount(taxDraft.total130, 'EUR')}</strong></div>
                      <div>Штраф-надбавка (recargo): <strong style={{ color: taxDraft.totalRecargo > 0 ? '#c0392b' : 'inherit' }}>{formatAmount(taxDraft.totalRecargo, 'EUR')}</strong></div>
                      <div>Пени (intereses de demora): <strong style={{ color: taxDraft.totalIntereses > 0 ? '#c0392b' : 'inherit' }}>{formatAmount(taxDraft.totalIntereses, 'EUR')}</strong></div>
                    </div>
                    <div style={{ borderTop: '2px solid #c0392b', marginTop: 8, paddingTop: 8, color: '#c0392b', fontWeight: 800, fontSize: 22 }}>
                      💶 К ОПЛАТЕ: {formatAmount(taxDraft.grandTotal, 'EUR')}
                    </div>
                    {taxDraft.lateCount > 0 && (
                      <div style={{ fontSize: 12, color: '#7f8c8d', marginTop: 6 }}>
                        Санкции посчитаны для добровольной подачи ДО требования налоговой; если придёт требование — штраф 50–150% от суммы налога.
                      </div>
                    )}
                  </div>

                  <pre style={{ background: '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: 8, padding: 12, fontSize: 13, whiteSpace: 'pre-wrap', margin: '0 0 12px' }}>{buildTaxRangeText(taxDraft)}</pre>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => downloadTextFile(`borrador-420-130-${taxDraft.fromKey}-${taxDraft.toKey}.txt`, buildTaxRangeText(taxDraft))}
                      style={{ background: '#27ae60', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>⬇ Скачать черновик (.txt)</button>
                    <button onClick={async () => { const mvts = await loadBankMovements(); setTaxDraft(prev => prev ? computeTaxRange(prev.fromKey, prev.toKey, prev, mvts || undefined) : prev); }}
                      style={{ background: '#2980b9', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}
                      title="Перезагрузить выписку и пересчитать — делайте это прямо перед подачей">🔄 Финальный пересчёт из банка</button>
                  </div>
                  <p style={{ fontSize: 12, color: '#95a5a6', margin: '10px 0 0' }}>Проверьте цифры перед подачей: доходы могут включать переводы между своими счетами (уберите их правкой поля «Доходы»), расходы без галки в расчёт не идут.</p>
                </div>
              </div>
            )}

            {/* ПОПАП ОДНОЙ ЗАПОЛНЕННОЙ МОДЕЛИ (клик по «Modelo 420/130» в карточке квартала, v30.2) */}
            {taxFormPopup && taxDraft && (() => {
              // после пересчёта (галка «фактура») берём свежий объект квартала из черновика
              const x = taxDraft.quarters.find(q => q.key === taxFormPopup.q.key) || taxFormPopup.q;
              const form = taxFormPopup.form;
              return (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
                  onClick={() => setTaxFormPopup(null)}>
                  <div style={{ background: '#fff', borderRadius: 12, maxWidth: 640, width: '100%', maxHeight: '85vh', overflow: 'auto', padding: 20 }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <h3 style={{ margin: 0 }}>{form === '420' ? '📄 Modelo 420 — IGIC' : '📄 Modelo 130 — IRPF'} · {x.key.replace('-', ' · ')}</h3>
                      <button onClick={() => setTaxFormPopup(null)} style={{ border: 'none', background: '#eee', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>✖</button>
                    </div>
                    <pre style={{ background: '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: 8, padding: 12, fontSize: 13, whiteSpace: 'pre-wrap', margin: '0 0 12px' }}>{buildSingleTaxFormText(form, x, taxDraft)}</pre>
                    {(form === '420' ? Math.max(0, x.result420) : x.result130) > 0 && (
                      <div style={{ background: '#fdecea', border: '2px solid #c0392b', borderRadius: 8, padding: '8px 14px', marginBottom: 12, color: '#c0392b', fontWeight: 800, fontSize: 18 }}>
                        💶 К ОПЛАТЕ: {formatAmount(form === '420' ? Math.max(0, x.result420) : x.result130, 'EUR')}
                        {x.isLate && (x.recargo > 0 || x.intereses > 0) && <span style={{ fontSize: 13, fontWeight: 700 }}> + штраф {formatAmount(x.recargo, 'EUR')} + пени {formatAmount(x.intereses, 'EUR')}</span>}
                      </div>
                    )}
                    {form === '420' && x.result420 < 0 && (
                      <div style={{ background: '#eafaf1', border: '2px solid #27ae60', borderRadius: 8, padding: '8px 14px', marginBottom: 12, color: '#1e8449', fontWeight: 700, fontSize: 15 }}>
                        ↩ К компенсации в следующих кварталах (a compensar): {formatAmount(Math.abs(x.result420), 'EUR')}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button onClick={() => downloadTextFile(`modelo-${form}-${x.key}.txt`, buildSingleTaxFormText(form, x, taxDraft))}
                        style={{ background: '#27ae60', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>⬇ Скачать эту форму (.txt)</button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {scanResultOpen && (
        <div className="scan-overlay">
          <div className="scan-overlay-header">
            <strong style={{ fontSize: 17 }}>{recognizing ? '⏳ Распознаю чек…' : '✅ Распознанный чек'}</strong>
            <button onClick={finishScan}>✕ Выход</button>
          </div>
          <div className="scan-overlay-body">
            {recognizing && (
              <div style={{ textAlign: 'center', marginTop: 40, fontSize: 16, opacity: 0.9 }}>
                {progressStage === 'upload' ? '⬆️ Загружаю файл…' : '🤖 Распознаю текст…'}
                <div style={{ margin: '16px auto 0', maxWidth: 320, height: 10, borderRadius: 6, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${uploadProgress}%`, borderRadius: 6, background: '#4caf50', transition: 'width 0.4s ease' }} />
                </div>
                <div style={{ marginTop: 8, fontSize: 14, opacity: 0.8 }}>{uploadProgress}%</div>
              </div>
            )}
            {!recognizing && lastSavedReceipt && (
              <div>
                {((lastSavedReceipt.photo_url || lastSavedReceipt.image_url) || previewUrl) && (
                  <img
                    src={fixImageUrl(lastSavedReceipt.photo_url || lastSavedReceipt.image_url) || previewUrl}
                    alt="Чек"
                    onClick={() => setFullscreenImage(fixImageUrl(lastSavedReceipt.photo_url || lastSavedReceipt.image_url) || previewUrl)}
                    style={{ width: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 12, background: '#000', marginBottom: 14, cursor: 'zoom-in' }}
                    title="Нажмите — открыть на весь экран"
                  />
                )}
                <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 14, lineHeight: 1.6 }}>
                  <div><strong>Магазин:</strong> {lastSavedReceipt.store_name || lastSavedReceipt.store_name_ru || '—'}</div>
                  <div><strong>Дата:</strong> {formatDate(lastSavedReceipt.receipt_date)}</div>
                  <div><strong>Итого:</strong> {formatAmount(lastSavedReceipt.total_amount, lastSavedReceipt.currency)}</div>
                  <div><strong>Товаров:</strong> {lastSavedReceipt.items?.length || 0}</div>
                  <div><strong>Объект:</strong> {lastSavedReceipt.object || '—'}</div>
                  {lastSavedReceipt.warning && <div style={{ color: '#fca5a5' }}>⚠️ {lastSavedReceipt.warning}</div>}
                </div>
                {lastSavedReceipt.items && lastSavedReceipt.items.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Товары:</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {lastSavedReceipt.items.map((item, i) => (
                        <li key={i} style={{ fontSize: 14, opacity: 0.95 }}>{item.name_ru || item.name} — {item.quantity} × {item.price} = {item.total}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {lastSavedReceipt.raw_text && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Распознанный текст — оригинал:</div>
                    <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', background: 'rgba(0,0,0,0.35)', padding: 12, borderRadius: 10, maxHeight: 220, overflow: 'auto' }}>{formatRawText(lastSavedReceipt.raw_text)}</pre>
                  </div>
                )}
                {lastSavedReceipt.raw_text_ru ? (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Перевод на русский:</div>
                    <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', background: 'rgba(30,80,160,0.35)', padding: 12, borderRadius: 10, maxHeight: 220, overflow: 'auto' }}>{formatRawText(lastSavedReceipt.raw_text_ru)}</pre>
                  </div>
                ) : lastSavedReceipt.raw_text && translatingId === lastSavedReceipt.id ? (
                  <p style={{ fontSize: 13, opacity: 0.8 }}>⏳ Перевожу автоматически...</p>
                ) : lastSavedReceipt.raw_text && translateError ? (
                  <p style={{ fontSize: 13, color: '#ff8a80' }}>
                    {translateError}{' '}
                    <button onClick={async () => { const ru = await requestTranslation(lastSavedReceipt); if (ru) setLastSavedReceipt(prev => prev ? { ...prev, raw_text_ru: ru } : prev); }} style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>Повторить</button>
                  </p>
                ) : null}
              </div>
            )}
          </div>
          {!recognizing && lastSavedReceipt && (
            <div className="scan-overlay-footer">
              <button onClick={finishScan}>✅ Сохранить</button>
              <button onClick={rescanScan}>🔄 Переснять</button>
            </div>
          )}
        </div>
      )}

      {/* ПОЛНОЭКРАННЫЙ ПРОСМОТР ИЗОБРАЖЕНИЯ ЧЕКА */}
      {fullscreenImage && (
        <div
          onClick={() => setFullscreenImage(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 3000,
            background: 'rgba(0,0,0,0.93)',
            display: 'flex', alignItems: fsZoom ? 'flex-start' : 'center', justifyContent: fsZoom ? 'flex-start' : 'center',
            padding: 16, cursor: 'zoom-out', overflow: 'auto'
          }}
        >
          <img
            src={fullscreenImage}
            alt="Чек"
            onClick={(e) => { e.stopPropagation(); setFsZoom(z => !z); }}
            title={fsZoom ? 'Клик — уместить в экран' : 'Клик — натуральный размер'}
            style={fsZoom ? {
              maxWidth: 'none', maxHeight: 'none',
              margin: 'auto', borderRadius: 8, cursor: 'zoom-out',
              boxShadow: '0 8px 40px rgba(0,0,0,0.7)'
            } : {
              maxWidth: '97vw', maxHeight: '97vh',
              objectFit: 'contain', borderRadius: 8, cursor: 'zoom-in',
              boxShadow: '0 8px 40px rgba(0,0,0,0.7)'
            }}
          />
          <button
            onClick={() => setFullscreenImage(null)}
            title="Закрыть (Esc)"
            style={{
              position: 'absolute', top: 14, right: 14,
              width: 40, height: 40, borderRadius: '50%',
              border: 'none', background: 'rgba(255,255,255,0.15)',
              color: '#fff', fontSize: 18, cursor: 'pointer'
            }}
          >✕</button>
        </div>
      )}
    </div>
  );
}

export default App;