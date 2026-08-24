import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import './apple-theme.css'; // Apple-стиль (apple.com): пилюльные кнопки, мягкие карточки, #0071e3 — v31
import { Capacitor, registerPlugin } from '@capacitor/core';

const API_URL = 'https://householder-api-production.up.railway.app';
// Локальный OCR (Unlimited-OCR на llama-server пользователя): браузер обращается к нему
// НАПРЯМУЮ — сервер и браузер на одном ноутбуке. localhost для браузера — доверенный
// контекст, поэтому запросы с HTTPS-сайта на http://127.0.0.1 разрешены.
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
  annual_accounts: '📊 Годовая отчётность',
  tax_form: '📋 Налоговая форма',
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
  { id: '130-1T', form: '130', name: 'Modelo 130 — IRPF, 1 квартал', period: '1T', deadline: { m: 4, d: 20 }, what: 'Только для autónomo (физлицо). ISERA 2020, SL НЕ подаёт 130 — вместо него Modelo 111 (retenciones).', optional: true },
  { id: '115-1T', form: '115', name: 'Modelo 115 — retenciones alquiler, 1T', period: '1T', deadline: { m: 4, d: 20 }, what: 'Удержания 19% с аренды офиса/помещения (если арендуете).', optional: true },
  { id: '111-1T', form: '111', name: 'Modelo 111 — retenciones IRPF, 1 квартал', period: '1T', deadline: { m: 4, d: 20 }, what: 'Удержания IRPF с зарплат (cas.03) и профессионалов (cas.09) за янв–март. Основная форма IRPF для ISERA 2020, SL (подана: 1T-2024, 13.327,13 €).' },
  { id: '420-2T', form: '420', name: 'Modelo 420 — IGIC, 2 квартал', period: '2T', deadline: { m: 7, d: 20 }, what: 'Автоликвидация IGIC за апр–июнь.' },
  { id: '130-2T', form: '130', name: 'Modelo 130 — IRPF, 2 квартал', period: '2T', deadline: { m: 7, d: 20 }, what: 'Только для autónomo (физлицо). ISERA 2020, SL НЕ подаёт 130 — вместо него Modelo 111.', optional: true },
  { id: '115-2T', form: '115', name: 'Modelo 115 — retenciones alquiler, 2T', period: '2T', deadline: { m: 7, d: 20 }, what: 'Удержания с аренды за апр–июнь.', optional: true },
  { id: '111-2T', form: '111', name: 'Modelo 111 — retenciones IRPF, 2 квартал', period: '2T', deadline: { m: 7, d: 20 }, what: 'Удержания IRPF (cas.03+09) за апр–июнь.' },
  { id: '420-3T', form: '420', name: 'Modelo 420 — IGIC, 3 квартал', period: '3T', deadline: { m: 10, d: 20 }, what: 'Автоликвидация IGIC за июль–сент.' },
  { id: '130-3T', form: '130', name: 'Modelo 130 — IRPF, 3 квартал', period: '3T', deadline: { m: 10, d: 20 }, what: 'Только для autónomo (физлицо). ISERA 2020, SL НЕ подаёт 130 — вместо него Modelo 111.', optional: true },
  { id: '115-3T', form: '115', name: 'Modelo 115 — retenciones alquiler, 3T', period: '3T', deadline: { m: 10, d: 20 }, what: 'Удержания с аренды за июль–сент.', optional: true },
  { id: '111-3T', form: '111', name: 'Modelo 111 — retenciones IRPF, 3 квартал', period: '3T', deadline: { m: 10, d: 20 }, what: 'Удержания IRPF (cas.03+09) за июль–сент.' },
  { id: '420-4T', form: '420', name: 'Modelo 420 — IGIC, 4 квартал', period: '4T', deadline: { m: 1, d: 30 }, nextYear: true, what: 'Автоликвидация IGIC за окт–дек (срок до 30 января следующего года).' },
  { id: '130-4T', form: '130', name: 'Modelo 130 — IRPF, 4 квартал', period: '4T', deadline: { m: 1, d: 30 }, nextYear: true, what: 'Только для autónomo. ISERA 2020, SL НЕ подаёт 130 — вместо него Modelo 111 (до 20 января).', optional: true },
  { id: '115-4T', form: '115', name: 'Modelo 115 — retenciones alquiler, 4T', period: '4T', deadline: { m: 1, d: 20 }, nextYear: true, what: 'Удержания с аренды за окт–дек.', optional: true },
  { id: '111-4T', form: '111', name: 'Modelo 111 — retenciones IRPF, 4 квартал', period: '4T', deadline: { m: 1, d: 20 }, nextYear: true, what: 'Удержания IRPF (cas.03+09) за окт–дек (срок до 20 января следующего года).' },
  { id: '202-A', form: '202', name: 'Modelo 202 — IS, pago fraccionado 1', period: 'PF1', deadline: { m: 4, d: 20 }, what: 'Первый аванс налога на прибыль (Impuesto de Sociedades): апрель, 1–20. Оценка = 25% (PYME 24%) от прибыли 1T.' },
  { id: '202-B', form: '202', name: 'Modelo 202 — IS, pago fraccionado 2', period: 'PF2', deadline: { m: 10, d: 20 }, what: 'Второй аванс налога на прибыль: октябрь, 1–20 (прибыль янв–сент).' },
  { id: '202-C', form: '202', name: 'Modelo 202 — IS, pago fraccionado 3', period: 'PF3', deadline: { m: 12, d: 20 }, what: 'Третий аванс налога на прибыль: декабрь, 1–20 (прибыль янв–ноябрь).' },
  { id: '425-year', form: '425', name: 'Modelo 425 — IGIC resumen anual', period: 'AÑO', deadline: { m: 1, d: 30 }, nextYear: true, what: 'Годовая сводка IGIC (ATC): сверка четырёх modelo 420 года. До 30 января.' },
  { id: '200-year', form: '200', name: 'Modelo 200 — Impuesto de Sociedades (годовой)', period: 'AÑO', deadline: { m: 7, d: 25 }, nextYear: true, what: 'Годовой налог на прибыль SL: 25% (PYME <10 млн — 24%, микро <1 млн — 21/22%) от beneficio, минус авансы modelo 202. Срок: до 25 июля следующего года.' },
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
  { form: '200', title: 'IS — Modelo 202 + 200 (налог на прибыль SL)', color: '#b03a2e',
    who: 'Все sociedades (SL) — ISERA 2020, SL платит IS, а не IRPF по деятельности.',
    what: 'Квартальные авансы modelo 202 (20 апр / 20 окт / 20 дек) и годовой расчёт modelo 200 (до 25 июля след. года): 25% от прибыли (PYME <10 млн — 24% с 2025; микро <1 млн — 21/22%) минус уплаченные авансы. Убытки переносятся на будущие годы.',
    docs: 'Прибыль = доходы нетто − расходы нетто (по фактурам). Блок «Платежи из банка» считает аванс 202 автоматически (строка «IS прибыль»).',
    when: '202: 1–20 апр / окт / дек. 200: 1–25 июля следующего года.',
    url: 'https://sede.agenciatributaria.gob.es/Sede/impuesto-sobre-sociedades.html' },
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
    blank: `МОДЕЛО 420 — IGIC TRIMESTRAL (ATC, Канары) — БЛАНК НА РУССКОМ
============================================================
Ejercicio: ______   Período: 1T / 2T / 3T / 4T
NIF: ____________  Razón social: ____________________

7. LIQUIDACIÓN — I.G.I.C. DEVENGADO (начислен с продаж):
  Casilla 01 — Base imponible (НЕТТО, без IGIC):   __________ ,__
  Casilla 02 — Tipo de gravamen, %:                     7,00
  Casilla 03 — Cuota devengada (01 × 02):          __________ ,__
  Casilla 25 — Total cuotas devengadas:            __________ ,__

I.G.I.C. DEDUCIBLE (покупки для деятельности, с фактурами):
  Casilla 26 — Base deducible (нетто):             __________ ,__
  Casilla 27 — Cuota deducible (IGIC по фактурам): __________ ,__
  Casilla 40 — Total cuotas deducibles:            __________ ,__

РЕЗУЛЬТАТ:
  Casilla 41 — Diferencia (25 − 40):               __________ ,__
  Casilla 43 — Cuotas a compensar de períodos anteriores: __________ ,__
  Casilla 45 — RESULTADO DE LA AUTOLIQUIDACIÓN (41 − 43): __________ ,__
  → A INGRESAR (к оплате) / A COMPENSAR (к зачёту дальше).

Подача: sede ATC: https://sede.gobcan.es/tributos`,
    example: `МОДЕЛО 420 — ПРИМЕР (реальная поданная 1T-2025 ISERA 2020, SL!)
============================================================
Ejercicio: 2025   Período: 1T
NIF: B76825199   Razón social: ISERA 2020, SL
Justificante: 4205586417155 (подана 15-04-2025)

IGIC DEVENGADO:
  Casilla 01 — Base imponible:        134 557,29
  Casilla 02 — Tipo:                        7,00 %
  Casilla 03 — Cuota devengada:         9 419,01
  Casilla 25 — Total devengado:         9 419,01

IGIC DEDUCIBLE:
  Casilla 26 — Base deducible:         18 918,13
  Casilla 27 — Cuota deducible:         1 199,43
  Casilla 40 — Total deducible:         1 199,43

РЕЗУЛЬТАТ:
  Casilla 41 — Diferencia:              8 219,58
  Casilla 43 — A compensar anterior:        0,00
  Casilla 45 — RESULTADO:               8 219,58
  → A INGRESAR: 8 219,58 € (domiciliado ES44 3076 0420 2426 5661 3722)` },
  '111': {
    blank: `МОДЕЛО 111 — RETENCIONES IRPF (удержания) — БЛАНК НА РУССКОМ
============================================================
Ejercicio: ______   Período: 1T / 2T / 3T / 4T
NIF: ____________  Razón social: ____________________
(форма ISERA 2020, SL — modelo 130 для SL НЕ подаётся)

I. RENDIMIENTOS DEL TRABAJO (зарплаты работников):
  Casilla 01 — Nº de perceptores (число получателей):  ____
  Casilla 02 — Importe de las percepciones (начислено):  __________ ,__
  Casilla 03 — Importe de las retenciones (удержано):    __________ ,__

II. RENDIMIENTOS DE ACTIVIDADES ECONÓMICAS (профессионалы):
  Casilla 07 — Nº de perceptores:                       ____
  Casilla 08 — Importe de las percepciones:             __________ ,__
  Casilla 09 — Importe de las retenciones:              __________ ,__

LIQUIDACIÓN:
  Casilla 28 — Suma (03 + 06 + 09 + …):                 __________ ,__
  Casilla 30 — RESULTADO A INGRESAR (28 − 29):          __________ ,__
  → К ОПЛАТЕ: casilla 30 (domiciliación IBAN или NRC).

Сроки: до 20 апр / 20 июл / 20 окт / 20 янв (4T).
Подача: sede AEAT (сертификат / Cl@ve).`,
    example: `МОДЕЛО 111 — ПРИМЕР (реальная поданная 1T-2024 ISERA 2020, SL!)
============================================================
Ejercicio: 2024   Período: 1T
NIF: B76825199   Razón social: ISERA 2020, SL
Justificante: 1115816680711 (подана 13-04-2024)

I. RENDIMIENTOS DEL TRABAJO:
  Casilla 01 — Perceptores:                6
  Casilla 02 — Percepciones:          61 535,97
  Casilla 03 — Retenciones:           13 264,13

II. ACTIVIDADES ECONÓMICAS:
  Casilla 07 — Perceptores:                1
  Casilla 08 — Percepciones:             900,00
  Casilla 09 — Retenciones:               63,00

LIQUIDACIÓN:
  Casilla 28 — Suma (03 + 09):        13 327,13
  Casilla 30 — RESULTADO A INGRESAR:  13 327,13
  → К ОПЛАТЕ: 13 327,13 € (domiciliación ES44 3076 0420 2426 5661 3722)` },
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

// Локальный OCR на Mac (Apple Vision через mac-ocr-server.py на 127.0.0.1:8787) — v52
const LOCAL_MAC_MODEL = { name: 'local-mac-ocr', displayName: '🖥 Mac OCR (локально, Vision)', provider: 'Mac (локально)', active: null };
const LOCAL_MAC_OCR_DEFAULT = 'http://127.0.0.1:8787';

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
  { name: 'openrouter-google/gemma-4-31b-it:free', displayName: 'Gemma 4 31B (Free)', provider: 'OpenRouter' },
  { name: 'openrouter-nvidia/nemotron-nano-12b-v2-vl:free', displayName: 'Nemotron Nano 12B v2 VL — документы/OCR (Free)', provider: 'OpenRouter' },
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

// ========== EXCEL PREVIEW: SheetJS по CDN (v58) — просмотр xlsx/xls/csv прямо в карточке ==========
let xlsxLoading = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxLoading) return xlsxLoading;
  xlsxLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error('Не удалось загрузить модуль Excel — проверьте интернет'));
    document.head.appendChild(script);
  });
  return xlsxLoading;
}
// v69.7: JSZip с CDN — сборка ZIP-архива выбранных чеков прямо в браузере
let jszipLoading = null;
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (jszipLoading) return jszipLoading;
  jszipLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    script.onload = () => resolve(window.JSZip);
    script.onerror = () => reject(new Error('Не удалось загрузить модуль ZIP — проверьте интернет'));
    document.head.appendChild(script);
  });
  return jszipLoading;
}
const isExcelName = (name) => /\.(xlsx?|xlsm|xlsb|csv|ods)(\?|$)/i.test(name || '');

const isPdfFile = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
// Word/текст как источник распознавания (v32.3): PDF → Word → правка → загрузка → распознавание из текста
const isWordFile = (f) => /\.(docx?|html?|txt)$/i.test(f.name || '') || /wordprocessingml|msword|text\/(html|plain)/.test(f.type || '');
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

// v57.1: ТЕКСТОВЫЙ СЛОЙ PDF читаем в браузере (pdf.js getTextContent) ДО распознавания.
// Есть текстовый слой → текстовый конвейер (MarkItDown/текст), НЕТ (скан) → OCR/vision.
const pdfPageTextsCache = new Map(); // File → Promise<{pages: string[], total: number}>
function getPdfPageTexts(pdfFile) {
  if (!pdfPageTextsCache.has(pdfFile)) {
    pdfPageTextsCache.set(pdfFile, (async () => {
      try {
        const pdfjsLib = await loadPdfJs();
        const data = await pdfFile.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        const pages = [];
        const maxPages = Math.min(pdf.numPages, 60);
        for (let p = 1; p <= maxPages; p++) {
          const page = await pdf.getPage(p);
          const tc = await page.getTextContent();
          pages.push((tc.items || []).map(it => it.str).join(' ').replace(/\s+/g, ' ').trim());
        }
        return { pages, total: pages.reduce((a, t) => a + t.length, 0) };
      } catch (e) {
        console.error('PDF text-layer extract error:', e);
        return { pages: [], total: 0 };
      }
    })());
  }
  return pdfPageTextsCache.get(pdfFile);
}

// v57.1: клиентский детектор РАЗНЫХ документов в пачке (порт серверного splitPagesIntoDocuments):
// ≥2 страниц с РАЗНЫМИ номерами (Fra:/NUMERO DE RECIBO) → это разные документы, делим ДО распознавания
function pageDocSigClient(text) {
  const t = String(text || '');
  let m = t.match(/\bFra\s*[:;.]?\s*([A-Za-z]?\d[\d\s]{5,}\d)/i);
  let num = m ? m[1].replace(/\s+/g, '').toLowerCase() : null;
  if (!num) {
    m = t.match(/RECIBO[\s\S]{0,60}?\b(\d{6,}[A-Z0-9]{4,})\b/i);
    num = m ? 'rec' + m[1].toLowerCase() : null;
  }
  // v57.3: альбаран/фактура/тикет — номер рядом с ключевым словом
  if (!num) {
    m = t.match(/(?:ALBAR[AÁ]N|FACTURA|ALBARAN|TICKET|FACT\.?)\s*(?:N[ºo°]?|N[ÚU]M(?:ERO)?)?\s*[:.]?\s*([A-Z]{0,4}[\s-]?\d[\d\s/-]{2,}\d)/i);
    if (m) num = m[1].replace(/\s+/g, '').toLowerCase();
  }
  // v57.3: «номер + дата» на одной строке (шапка альбарана)
  let date = null;
  if (!num) {
    m = t.match(/\b(\d{3,7}(?:\s*[/-]?\s*\d{1,2}){0,2})\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/);
    if (m) { num = m[1].replace(/\s+/g, '').toLowerCase(); date = m[2]; }
  }
  if (!date) {
    m = t.slice(0, 1200).match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/);
    if (m) date = m[1];
  }
  return { num, date };
}
function splitPagesClientText(pageTexts) {
  const sigs = pageTexts.map(pageDocSigClient);
  const distinctNums = new Set(sigs.map(x => x.num).filter(Boolean));
  const distinctDates = new Set(sigs.map(x => x.date).filter(Boolean));
  if (distinctNums.size < 2 && distinctDates.size < 2) return null;
  const groups = [];
  let lastDate = null;
  for (let i = 0; i < pageTexts.length; i++) {
    const k = sigs[i].num;
    const d = sigs[i].date;
    const last = groups[groups.length - 1];
    if (last && k && k === last.key) { last.pages.push(i); if (d) lastDate = d; continue; }
    if (last && !k && (!d || !lastDate || d === lastDate)) { last.pages.push(i); continue; }
    groups.push({ key: k, pages: [i] });
    if (d) lastDate = d;
  }
  return groups.length >= 2 ? groups : null;
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

function compressImageFile(file, maxWidth = 1600, maxHeight = 2400, quality = 0.85, force = false) {
  return new Promise((resolve, reject) => {
    if (!force && file.size <= MAX_FILE_SIZE_MB * 1024 * 1024) {
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

// ========== CRM (вкладка «🤝 CRM», v34): календарь с задачами, контрагенты, справочник ==========
// контактов, таймлайн исполнения заданий, закрытие задания исполнителем с подтверждением постановщика.
// Цикл задачи: «В работе» → исполнитель отмечает «✅ Выполнена» → «На подтверждении» →
// постановщик «👍 Подтвердить закрытие» («Закрыта») или «↩ На доработку» (снова «В работе»).
// Каждый шаг фиксируется в таймлайне задачи (автор, время, комментарий).
// Хранение (v33) — сервер: /api/crm* (Supabase, миграция supabase-migration-v21-crm.sql),
// CRM общая для всей команды. Если сервер недоступен — автоматический fallback на
// localStorage (crm_*_v1), как в v32; локальные данные переносятся на сервер один раз.
// Фотоотчёт (v35–v36): медиа «до» и «после» выполнения (фото/видео/аудио) — photos_before/photos_after
// в crm_tasks (миграция supabase-migration-v22-crm-photos.sql), API POST/DELETE /api/crm/tasks/:id/photos.
// Файлы контрагента (v36): attachments в crm_counterparties (миграция supabase-migration-v23-crm-cp-files.sql),
// API POST/DELETE /api/crm/counterparties/:id/files. Запись медиа: {url, kind: photo|video|audio, name, ts, actor}.
const CRM_LS_TASKS = 'crm_tasks_v1';
const CRM_LS_CPS = 'crm_counterparties_v1';
const CRM_LS_CONTACTS = 'crm_contacts_v1';
const CRM_STATUS_META = {
  open:            { label: '🔵 В работе',         color: '#0071e3', bg: '#e8f0fe' },
  pending_confirm: { label: '🟠 На подтверждении', color: '#e67e22', bg: '#fdf2e3' },
  closed:          { label: '🟢 Закрыта',          color: '#27ae60', bg: '#e8f8ef' }
};
const CRM_PRIORITY_META = {
  high:   { label: '🔴 Высокий', color: '#e74c3c' },
  normal: { label: '⚪ Обычный', color: '#8e8e93' },
  low:    { label: '🔵 Низкий',  color: '#0071e3' }
};
const CRM_CP_TYPE_LABELS = { client: '🤝 Клиент', supplier: '📦 Поставщик', partner: '🏢 Партнёр', other: '📎 Прочее' };
const CRM_ACTION_META = {
  created:   { label: 'создал(а) задачу',          color: '#0071e3' },
  edited:    { label: 'отредактировал(а) задачу',  color: '#8e8e93' },
  comment:   { label: 'добавил(а) комментарий',    color: '#8e8e93' },
  done:      { label: 'отметил(а) выполненной',    color: '#e67e22' },
  confirmed: { label: 'подтвердил(а) закрытие ✅', color: '#27ae60' },
  returned:  { label: 'вернул(а) на доработку ↩',  color: '#e74c3c' },
  photo:     { label: 'добавил(а) фото в фотоотчёт 📷', color: '#5856d6' },
  photo_del: { label: 'удалил(а) фото из фотоотчёта',   color: '#8e8e93' }
};
const CRM_WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function crmLoad(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
function crmSave(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* quota — молча пропускаем */ }
}
function crmUid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function crmTodayIso() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}
function crmFmtTs(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' +
         d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
function crmFmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}
// Демо-данные при первом открытии CRM (удаляются как обычные записи)
function crmSeed() {
  const now = Date.now();
  const today = crmTodayIso();
  const cpId = crmUid(), contactId = crmUid();
  const cps = [{ id: cpId, name: 'ООО «Пример»', type: 'client', phone: '+7 900 000-00-00', email: 'info@primer.ru', address: '', comment: 'Демо-контрагент — можно отредактировать или удалить.', createdAt: now }];
  const contacts = [{ id: contactId, counterpartyId: cpId, name: 'Иван Иванов', position: 'Менеджер', phone: '+7 900 000-00-01', email: 'ivan@primer.ru', comment: 'Демо-контакт.', createdAt: now }];
  const tasks = [
    { id: crmUid(), title: 'Пример: согласовать договор аренды', description: 'Отправить контрагенту проект договора и получить правки.', counterpartyId: cpId, contactId, assignee: '', createdBy: 'CRM', createdAt: now - 86400000, dueDate: today, priority: 'normal', status: 'open',
      timeline: [{ ts: now - 86400000, actor: 'CRM', action: 'created', note: 'Демо-задача: нажмите «✅ Выполнена», затем «👍 Подтвердить закрытие» — весь путь запишется в историю.' }] },
    { id: crmUid(), title: 'Пример: запросить акт сверки', description: '', counterpartyId: cpId, contactId: '', assignee: '', createdBy: 'CRM', createdAt: now - 2 * 86400000, dueDate: today, priority: 'low', status: 'open',
      timeline: [{ ts: now - 2 * 86400000, actor: 'CRM', action: 'created', note: '' }] }
  ];
  return { tasks, cps, contacts };
}

// ========== ДОКУМЕНТЫ (вкладка «📁 Документы», v40) ==========
// Разделы: Дома / Авто / Личное. Файлы ЛЮБЫХ типов. Сервер: /api/docs (таблица doc_sections,
// миграция supabase-migration-v25-docs.sql), Storage папка docs/<категория>/.
// Фото жмутся на клиенте (compressImageFile), видео > 48 МБ жмёт сервер (ffmpeg), остальное — как есть.
// Имена для Excel-меню привязки платежа к календарю (v44)
const CAL_PAYEES = ['Duque', 'Kit', 'Maria', 'Volvo', 'Porsche', 'Mercedes'];
const CAL_FREQS = [1, 2, 6, 12, 0]; // частота оплаты в месяцах (0 = одноразовый)
const calFreqLabel = (n) => n === 0 ? 'одноразовый (только месяц начала)' : n === 1 ? 'каждый месяц' : n === 12 ? 'раз в год (12 мес)' : `раз в ${n} мес`;

const DOC_SECTIONS = [
  { key: 'home', title: '🏠 Дома' },
  { key: 'auto', title: '🚗 Авто' },
  { key: 'personal', title: '👤 Личное' }
];
// v57.7: подпапки разделов (хранятся в поле folder у файла); «All» — все файлы раздела
const DOC_FOLDERS = {
  home: ['Dude', 'Kit', 'Maria'],
  auto: ['Mercedes', 'Porsche', 'Volvo'],
  personal: []
};
const docKindOf = (f) => /^image\//.test(f.type || '') ? 'photo' : /^video\//.test(f.type || '') ? 'video' : /^audio\//.test(f.type || '') ? 'audio'
  : (f.type === 'application/pdf' || /^text\//.test(f.type || '') || /\.(pdf|txt|md|csv)$/i.test(f.name || '')) ? 'doc' : 'file';
// v59.2: страховка от кракозябры в именах на клиенте (латиница-маскировка UTF-8)
const fixDocName = (name) => {
  if (!name || typeof name !== 'string' || !/[ÐÑÃâ]/.test(name)) return name;
  try {
    const fixed = decodeURIComponent(escape(name));
    return /[\u0400-\u04FF]/.test(fixed) ? fixed : name;
  } catch (e) { return name; }
};
const docMediaOf = (entry) => {
  const m = (entry && typeof entry === 'object') ? entry : { url: entry, kind: 'photo', name: '' };
  return (m && m.name) ? { ...m, name: fixDocName(m.name) } : m;
};
// v59: вытащить дату документа из распознанного текста (dd.mm.yyyy / dd/mm/yyyy / yyyy-mm-dd)
function parseDocDateFromText(text) {
  if (!text) return null;
  let m = /\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/.exec(text);
  if (m) {
    const d = +m[1], mo = +m[2], y = +m[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  m = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
const fmtDocDate = (iso) => iso ? iso.split('-').reverse().join('.') : '';



// v74: вкладка «👥 Пользователи» (только admin) — управление доступом: роли, разделы документов, объекты
function UsersTab({ token, objectsList }) {
  const SEC_LABELS = { home: '🏠 Дома', auto: '🚗 Авто', personal: '👤 Личное' };
  const TAB_LABELS = { upload: '📤 Загрузка', list: '🧾 Чеки/документы', analysis: '📊 Анализ', taxes: '🧾 Налоги', crm: '🤝 CRM', docs: '📁 Документы', chat: '💬 Чат' };
  const [list, setList] = useState([]);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null); // {id,name,password,role,sections[],objects[],disabled,isNew}
  const load = async () => {
    try {
      const r = await fetch(`${API_URL}/api/users?token=${token}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setList(j); setErr('');
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line
  const TAB_LEVELS = { none: '⛔ Нет доступа', read: '👁 Просмотр', full: '✏️ Полный доступ' };
  const tabsObj = (t) => { // старый формат-массив → объект full
    if (t && !Array.isArray(t) && typeof t === 'object') return { ...t };
    const o = {};
    if (Array.isArray(t)) t.forEach(k => { o[k] = 'full'; });
    return o;
  };
  const blank = { id: '', name: '', password: '', role: 'manager', sections: [], objects: [], tabs: {}, can_view: [], can_view_crm: [], disabled: false, isNew: true };
  // v81: общий рендер списка «видит данные пользователей» (чеки и CRM — отдельные списки)
  const renderCanView = (field) => (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
      {list.filter(x => x.id !== edit.id).map(x => (
        <label key={x.id} style={{ fontSize: 13 }}><input type="checkbox" checked={edit[field].includes(x.id)} onChange={() => setEdit({ ...edit, [field]: toggleArr(edit[field], x.id) })} /> {x.name || x.id}</label>
      ))}
      {['admin', ...Array.from({ length: 10 }, (_, i) => `user${i + 1}`)].filter(id => id !== edit.id && !list.some(x => x.id === id)).map(id => (
        <label key={id} style={{ fontSize: 13, color: '#6e6e73' }}><input type="checkbox" checked={edit[field].includes(id)} onChange={() => setEdit({ ...edit, [field]: toggleArr(edit[field], id) })} /> {id} <span style={{ fontSize: 10.5, color: '#aeaeb2' }}>(встроенный)</span></label>
      ))}
    </div>
  );
  const save = async () => {
    try {
      const r = await fetch(`${API_URL}/api/users?token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: edit.id, name: edit.name, password: edit.password || undefined, role: edit.role, sections: edit.sections, objects: edit.objects, tabs: Object.keys(edit.tabs).length ? edit.tabs : null, can_view: edit.can_view, can_view_crm: edit.can_view_crm, disabled: edit.disabled })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setEdit(null); load();
    } catch (e) { alert('Не сохранилось: ' + e.message); }
  };
  const del = async (id) => {
    if (!window.confirm(`Удалить пользователя «${id}»? Вход по его паролю перестанет работать.`)) return;
    await fetch(`${API_URL}/api/users?token=${token}&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    load();
  };
  const toggleArr = (arr, v) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
  const inp = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid #d0d0d5', fontSize: 13.5, marginBottom: 8 };
  return (
    <div style={{ padding: '12px 15px', maxWidth: 720, margin: '0 auto' }}>
      <h2 style={{ margin: '4px 0 10px', fontSize: 20 }}>👥 Пользователи и доступ</h2>
      {err && <div style={{ background: '#fff4e5', border: '1px solid #ffd699', borderRadius: 10, padding: '10px 12px', fontSize: 13, color: '#8a6d3b', whiteSpace: 'pre-line', marginBottom: 10 }}>⚠️ {err}</div>}
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e3e6ea', padding: 14, marginBottom: 14 }}>
        {list.map(u => (
          <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid #f0f0f2', flexWrap: 'wrap' }}>
            <b style={{ fontSize: 14 }}>{u.name}</b>
            <span style={{ fontSize: 12, color: '#8e8e93' }}>({u.id})</span>
            <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 8, background: u.role === 'admin' ? '#ffe9e7' : '#eef4ff', color: u.role === 'admin' ? '#c0392b' : '#0071e3', fontWeight: 700 }}>{u.role}</span>
            {u.disabled && <span style={{ fontSize: 12, color: '#e74c3c', fontWeight: 700 }}>отключён</span>}
            <span style={{ fontSize: 11.5, color: '#8e8e93' }}>
              {(Array.isArray(u.tabs) && u.tabs.length) ? `разделы: ${u.tabs.map(t => (TAB_LABELS[t] || t).replace(/^\S+ /, '')).join(', ')}` : (u.tabs && typeof u.tabs === 'object' && Object.keys(u.tabs).length) ? `разделы: ${Object.entries(u.tabs).map(([k, v]) => `${(TAB_LABELS[k] || k).replace(/^\S+ /, '')}=${v}`).join(', ')}` : 'все разделы'} · {Array.isArray(u.objects) && u.objects.length ? `объекты: ${u.objects.join(', ')}` : 'все объекты'} · {Array.isArray(u.sections) && u.sections.length ? `документы: ${u.sections.join(', ')}` : 'все документы'} · {Array.isArray(u.can_view) && u.can_view.length ? `чеки: ${u.can_view.join(', ')}` : 'чеки: свои'} · {Array.isArray(u.can_view_crm) && u.can_view_crm.length ? `crm: ${u.can_view_crm.join(', ')}` : 'crm: свои'}
            </span>
            <span style={{ flex: 1 }} />
            <button onClick={() => setEdit({ ...u, password: '', sections: u.sections || [], objects: u.objects || [], tabs: tabsObj(u.tabs), can_view: u.can_view || [], can_view_crm: u.can_view_crm || [], isNew: false })}
              style={{ padding: '4px 12px', borderRadius: 8, border: '1px solid #d0d0d5', background: '#fff', fontSize: 12.5, cursor: 'pointer' }}>✏️</button>
            <button onClick={() => del(u.id)}
              style={{ padding: '4px 12px', borderRadius: 8, border: '1px solid #ffd2cc', background: '#fff', color: '#e74c3c', fontSize: 12.5, cursor: 'pointer' }}>🗑</button>
          </div>
        ))}
        {!list.length && !err && <div style={{ fontSize: 13, color: '#8e8e93' }}>Пользователей в базе нет — работают встроенные admin/user1…10. Добавьте первого ниже.</div>}
        <button onClick={() => setEdit({ ...blank })}
          style={{ marginTop: 10, padding: '7px 16px', borderRadius: 980, border: 'none', background: '#0071e3', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>＋ Добавить пользователя</button>
        <div style={{ fontSize: 11.5, color: '#8e8e93', marginTop: 8 }}>Встроенные admin/user1…10 продолжают работать и сюда не попадают — удалите их из кода, когда все перейдут на свои пароли.</div>
      </div>
      {edit && (
        <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e3e6ea', padding: 16 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>{edit.isNew ? 'Новый пользователь' : `Правка: ${edit.id}`}</h3>
          <input style={inp} placeholder="Логин (латиница, для входа)" value={edit.id} disabled={!edit.isNew}
            onChange={e => setEdit({ ...edit, id: e.target.value })} />
          <input style={inp} placeholder="Имя (как показывать)" value={edit.name}
            onChange={e => setEdit({ ...edit, name: e.target.value })} />
          <input style={inp} placeholder={edit.isNew ? 'Пароль' : 'Новый пароль (пусто — не менять)'} value={edit.password}
            onChange={e => setEdit({ ...edit, password: e.target.value })} />
          <div style={{ fontSize: 12.5, fontWeight: 700, margin: '6px 0 4px' }}>Разделы приложения — свой уровень доступа к каждому:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 6 }}>
            {Object.entries(TAB_LABELS).map(([k, l]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13, flex: '0 0 150px' }}>{l}</span>
                <select value={edit.tabs[k] || 'full'} onChange={e => {
                  const v = e.target.value;
                  setEdit(prev => { const t = { ...prev.tabs }; if (v === 'full') delete t[k]; else t[k] = v; return { ...prev, tabs: t }; });
                }} style={{ flex: 1, padding: '6px 10px', borderRadius: 8, border: '1px solid #d0d0d5', fontSize: 13,
                  background: (edit.tabs[k] || 'full') === 'none' ? '#ffe9e7' : (edit.tabs[k] || 'full') === 'read' ? '#fff8e1' : '#eafaef' }}>
                  {Object.entries(TAB_LEVELS).map(([v, tl]) => <option key={v} value={v}>{tl}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: '#8e8e93', marginBottom: 8 }}>«Полный доступ» — как у всех; «Просмотр» — смотреть, но не менять; «Нет доступа» — раздел скрыт.</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, margin: '6px 0 4px' }}>Разделы документов (ничего не отмечено = все):</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
            {Object.entries(SEC_LABELS).map(([k, l]) => (
              <label key={k} style={{ fontSize: 13 }}><input type="checkbox" checked={edit.sections.includes(k)} onChange={() => setEdit({ ...edit, sections: toggleArr(edit.sections, k) })} /> {l}</label>
            ))}
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 700, margin: '6px 0 4px' }}>Объекты по чекам (ничего не отмечено = все):</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
            {(objectsList || []).map(o => (
              <label key={o} style={{ fontSize: 13 }}><input type="checkbox" checked={edit.objects.includes(o)} onChange={() => setEdit({ ...edit, objects: toggleArr(edit.objects, o) })} /> {o}</label>
            ))}
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 700, margin: '6px 0 4px' }}>🧾 Видит ЧЕКИ пользователей (ничего не отмечено = только свои):</div>
          {renderCanView('can_view')}
          <div style={{ fontSize: 12.5, fontWeight: 700, margin: '6px 0 4px' }}>🤝 Видит CRM пользователей (ничего не отмечено = только свои):</div>
          {renderCanView('can_view_crm')}
          <label style={{ fontSize: 13, display: 'block', margin: '6px 0' }}>
            <input type="checkbox" checked={edit.disabled} onChange={e => setEdit({ ...edit, disabled: e.target.checked })} /> 🚫 Отключён (вход запрещён)
          </label>
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button onClick={save} style={{ padding: '8px 20px', borderRadius: 980, border: 'none', background: '#34c759', color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>💾 Сохранить</button>
            <button onClick={() => setEdit(null)} style={{ padding: '8px 20px', borderRadius: 980, border: '1px solid #c7c7cc', background: '#fff', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>Отмена</button>
          </div>
        </div>
      )}
    </div>
  );
}

// v71: диалог «Поделиться ссылкой» — публичная страница со списком выбранных файлов (принцип Dropbox)
function ShareDialog({ dlg, setDlg, token }) {
  if (!dlg) return null;
  const upd = (patch) => setDlg(prev => (prev ? { ...prev, ...patch } : prev));
  const create = async () => {
    upd({ busy: true, err: '' });
    try {
      const r = await fetch(`${API_URL}/api/share?token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: (dlg.title || '').slice(0, 120), days: dlg.days, items: dlg.items })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      upd({ busy: false, url: j.url });
    } catch (e) { upd({ busy: false, err: e.message }); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(dlg.url); upd({ copied: true }); setTimeout(() => upd({ copied: false }), 1500); }
    catch (e) { window.prompt('Скопируйте ссылку:', dlg.url); }
  };
  return (
    <div onClick={() => setDlg(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 440 }}>
        <h3 style={{ marginTop: 0, marginBottom: 6 }}>🔗 Поделиться ссылкой</h3>
        <div style={{ fontSize: 12.5, color: '#8e8e93', marginBottom: 14 }}>Публичная страница со списком файлов — как Dropbox. Откроется у любого, у кого есть ссылка.</div>
        {!dlg.url ? (
          <React.Fragment>
            <div style={{ fontSize: 12, color: '#6e6e73', marginBottom: 4 }}>Файлов: <b>{dlg.items.length}</b></div>
            <input value={dlg.title} onChange={e => upd({ title: e.target.value })} placeholder="Название подборки"
              style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 10, border: '1px solid #d0d0d5', fontSize: 14, marginBottom: 10 }} />
            <select value={dlg.days} onChange={e => upd({ days: parseInt(e.target.value, 10) })}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid #d0d0d5', fontSize: 14, marginBottom: 14 }}>
              <option value={7}>⏳ Ссылка на 7 дней</option>
              <option value={30}>⏳ Ссылка на 30 дней</option>
              <option value={0}>♾ Бессрочная ссылка</option>
            </select>
            {dlg.err && <div style={{ fontSize: 12.5, color: '#e74c3c', whiteSpace: 'pre-line', marginBottom: 10 }}>{dlg.err}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={create} disabled={dlg.busy}
                style={{ padding: '9px 22px', borderRadius: 980, border: 'none', background: dlg.busy ? '#c7c7cc' : '#0071e3', color: '#fff', fontWeight: 700, fontSize: 14, cursor: dlg.busy ? 'wait' : 'pointer' }}>
                {dlg.busy ? 'Создаю…' : '🔗 Создать ссылку'}
              </button>
              <button onClick={() => setDlg(null)}
                style={{ padding: '9px 22px', borderRadius: 980, border: '1px solid #c7c7cc', background: '#fff', color: '#1d1d1f', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Отмена</button>
            </div>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <div style={{ background: '#f5f5f7', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, wordBreak: 'break-all', marginBottom: 12 }}>{dlg.url}</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={copy}
                style={{ padding: '9px 22px', borderRadius: 980, border: 'none', background: dlg.copied ? '#34c759' : '#0071e3', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                {dlg.copied ? '✓ Скопировано' : '📋 Копировать'}
              </button>
              <a href={dlg.url} target="_blank" rel="noopener"
                style={{ padding: '9px 22px', borderRadius: 980, border: '1px solid #c7c7cc', background: '#fff', color: '#0071e3', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>Открыть ↗</a>
              <button onClick={() => setDlg(null)}
                style={{ padding: '9px 22px', borderRadius: 980, border: '1px solid #c7c7cc', background: '#fff', color: '#1d1d1f', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Готово</button>
            </div>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

function DocsTab({ user, token }) {
  const [sections, setSections] = useState({ home: [], auto: [], personal: [] });
  const [docSection, setDocSection] = useState('home');
  const [docsError, setDocsError] = useState(null);
  const [docsBusy, setDocsBusy] = useState(false);
  const [docsUpload, setDocsUpload] = useState(null); // v68.4: {phase:'prepare'|'upload'|'ocr', percent, done, total, currentFile}
  const [docsMove, setDocsMove] = useState(null); // v68.8.1: {total, target, status:'run'|'ok'|'err', msg}
  const docsXhrRef = useRef(null);   // v68.4: активный XHR — для кнопки «Остановить»
  const docsStopRef = useRef(false); // v68.4: флаг остановки цикла распознавания
  const [docsViewer, setDocsViewer] = useState(null); // {url, kind, name}
  const [docsOcr, setDocsOcr] = useState(null); // v57.6: {loading} | {name, url, pageUrls[], pages[{original,russian}], idx, tab, saved}
  const [docFolder, setDocFolder] = useState({ home: 'All', auto: 'All', personal: 'All' }); // v57.7: выбранная подпапка
  const [docsHover, setDocsHover] = useState(null); // v57.8: увеличенный предпросмотр при наведении {url, kind, name}
  const [docsExcel, setDocsExcel] = useState(null); // v58: {loading} | {name, sheets:[{name, html}], idx}
  const [docPath, setDocPath] = useState({ home: '', auto: '', personal: '' }); // v57.9: текущий путь внутри загруженной структуры папок
  const [docsSort, setDocsSort] = useState({ by: 'docDate', dir: 'desc' }); // v59: сортировка по дате документа / дате распознавания
  const [docsSelectMode, setDocsSelectMode] = useState(false); // v59: режим мультивыбора файлов
  const [docsSelected, setDocsSelected] = useState({}); // v59: {url: true}
  const [shareDlg, setShareDlg] = useState(null); // v71: диалог «поделиться ссылкой»
  // v74: роли — viewer только смотрит; разделы документов ограничены правами пользователя
  const docsReadOnly = (user && user.role === 'viewer') || (user && user.role === 'buchhalter');
  const visibleDocSections = DOC_SECTIONS.filter(sec => !user || !Array.isArray(user.sections) || !user.sections.length || user.sections.includes(sec.key));
  // v59.1: реестр папок в localStorage — переименованные/новые папки не исчезают, даже если пустые
  const [hiddenFolders, setHiddenFoldersRaw] = useState(() => {
    try { return JSON.parse(localStorage.getItem('docsHiddenFolders') || '{}'); } catch (e) { return {}; }
  });
  const [customFolders, setCustomFoldersRaw] = useState(() => {
    try { return JSON.parse(localStorage.getItem('docsCustomFolders') || '{}'); } catch (e) { return {}; }
  });
  // v68.9.2: реестр пустых папок ДЕРЕВА (созданных вручную) — видны до первой загрузки файлов в них
  const [customTree, setCustomTreeRaw] = useState(() => {
    try { return JSON.parse(localStorage.getItem('docsCustomTree') || '{}'); } catch (e) { return {}; }
  });
  const setCustomTree = (up) => setCustomTreeRaw(prev => {
    const next = typeof up === 'function' ? up(prev) : up;
    try { localStorage.setItem('docsCustomTree', JSON.stringify(next)); } catch (e) {}
    return next;
  });
  // v69.6: сворачиваемое дерево папок — какие узлы развёрнуты (localStorage)
  const [docsTreeExpanded, setDocsTreeExpandedRaw] = useState(() => {
    try { return JSON.parse(localStorage.getItem('docsTreeExpanded') || '{}'); } catch (e) { return {}; }
  });
  const setDocsTreeExpanded = (up) => setDocsTreeExpandedRaw(prev => {
    const next = typeof up === 'function' ? up(prev) : up;
    try { localStorage.setItem('docsTreeExpanded', JSON.stringify(next)); } catch (e) {}
    return next;
  });
  const toggleTreeNode = (p) => setDocsTreeExpanded(prev => ({ ...prev, [p]: !prev[p] }));
  const setHiddenFolders = (up) => setHiddenFoldersRaw(prev => {
    const next = typeof up === 'function' ? up(prev) : up;
    try { localStorage.setItem('docsHiddenFolders', JSON.stringify(next)); } catch (e) {}
    return next;
  });
  const setCustomFolders = (up) => setCustomFoldersRaw(prev => {
    const next = typeof up === 'function' ? up(prev) : up;
    try { localStorage.setItem('docsCustomFolders', JSON.stringify(next)); } catch (e) {}
    return next;
  });
  const [docsZoom, setDocsZoom] = useState(false);
  const [docsVErr, setDocsVErr] = useState(false);

  const loadDocs = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/docs?token=${token}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSections(data.sections || { home: [], auto: [], personal: [] });
      setDocsError(null);
    } catch (e) { setDocsError(e.message); }
  }, [token]);
  useEffect(() => { loadDocs(); }, [loadDocs]);

  // v70.1: файлы >40 МБ — прямая загрузка в облако (Cloudflare R2) частями по 32 МБ.
  // Причина: Supabase Storage отклоняет объекты больше ~50 МБ («object exceeded the maximum allowed size»),
  // поэтому обычный путь через сервер остаётся только для мелких файлов.
  // Сервер только подписывает URL — файл в память сервера НЕ попадает. Докачка: состояние в localStorage.
  const BIG_FILE_LIMIT = 40 * 1024 * 1024;         // до 40 МБ — обычный путь через сервер (Supabase)
  const BIG_MAX = 5 * 1024 * 1024 * 1024;          // потолок облачной загрузки
  const BIG_PART = 32 * 1024 * 1024;               // размер части
  const bigUpKey = (cat, f) => `bigup:${cat}:${f.name}:${f.size}`;
  const bigUploadDoc = async (cat, f, rel, onProgress) => {
    const total = f.size;
    const lsKey = bigUpKey(cat, f);
    let state = null;
    try { state = JSON.parse(localStorage.getItem(lsKey) || 'null'); } catch (e) { state = null; }
    if (!state || !state.key || !state.uploadId || !Array.isArray(state.parts)) {
      const r = await fetch(`${API_URL}/api/docs/${cat}/big/init?token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name, size: f.size, type: f.type || 'application/octet-stream' })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      state = { key: j.key, uploadId: j.uploadId, parts: [] };
      try { localStorage.setItem(lsKey, JSON.stringify(state)); } catch (e) {}
    }
    const partCount = Math.ceil(total / BIG_PART);
    const uploadedMap = new Map(state.parts.map(p => [p.PartNumber, p.ETag]));
    let doneBytes = state.parts.reduce((a, p) => a + (p.size || 0), 0);
    const putPart = (url, blob, pn) => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      docsXhrRef.current = xhr;
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && onProgress) onProgress(doneBytes + ev.loaded, `${f.name} · часть ${pn}/${partCount}`);
      };
      xhr.onload = () => {
        const et = xhr.getResponseHeader('ETag');
        if (xhr.status >= 200 && xhr.status < 300 && et) resolve(et);
        else reject(new Error(`часть ${pn}: HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('сетевая ошибка'));
      xhr.onabort = () => reject(new Error('ABORTED'));
      xhr.send(blob);
    });
    for (let pn = 1; pn <= partCount; pn++) {
      if (docsStopRef.current) throw new Error('ABORTED');
      if (uploadedMap.has(pn)) continue; // докачка: часть уже в облаке
      const blob = f.slice((pn - 1) * BIG_PART, Math.min(total, pn * BIG_PART));
      let etag = null;
      let lastErr = null;
      for (let attempt = 0; attempt < 3 && !etag; attempt++) {
        try {
          const sr = await fetch(`${API_URL}/api/docs/${cat}/big/sign?token=${token}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, uploadId: state.uploadId, parts: [pn] })
          });
          const sj = await sr.json().catch(() => ({}));
          if (!sr.ok) throw new Error(sj.error || `HTTP ${sr.status}`);
          etag = await putPart(sj.urls[pn], blob, pn);
        } catch (e) {
          if (e.message === 'ABORTED') throw e;
          lastErr = e;
          await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      docsXhrRef.current = null;
      if (!etag) throw new Error(`часть ${pn}/${partCount} не загрузилась: ${lastErr ? lastErr.message : 'ошибка'} — повторите загрузку, продолжится с этого места`);
      state.parts.push({ PartNumber: pn, ETag: etag, size: blob.size });
      uploadedMap.set(pn, etag);
      doneBytes += blob.size;
      try { localStorage.setItem(lsKey, JSON.stringify(state)); } catch (e) {}
      if (onProgress) onProgress(doneBytes, `${f.name} · часть ${pn}/${partCount} готова`);
    }
    // v70.2: финальная сборка — с таймаутом, чтобы не висеть на 100% молча
    setDocsUpload(prev => prev ? { ...prev, currentFile: `☁️ ${f.name} — сборка файла в облаке…` } : prev);
    const ac = new AbortController();
    const acTimer = setTimeout(() => ac.abort(), 120000);
    let cr;
    try {
      cr = await fetch(`${API_URL}/api/docs/${cat}/big/complete?token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ac.signal,
        body: JSON.stringify({ key: state.key, uploadId: state.uploadId, parts: state.parts.map(p => ({ PartNumber: p.PartNumber, ETag: p.ETag })), name: f.name, type: f.type, relPath: rel, size: f.size })
      });
    } catch (fe) {
      throw new Error(fe && fe.name === 'AbortError'
        ? 'Сборка файла в облаке заняла больше 2 минут — повторите загрузку, все части уже в облаке и продолжатся с этого места'
        : 'Сборка файла: ' + (fe && fe.message || 'сетевая ошибка'));
    } finally { clearTimeout(acTimer); }
    const cj = await cr.json().catch(() => ({}));
    if (!cr.ok) throw new Error(cj.error || `HTTP ${cr.status}`);
    try { localStorage.removeItem(lsKey); } catch (e) {}
    setSections(prev => ({ ...prev, [cat]: Array.isArray(cj.attachments) ? cj.attachments : prev[cat] }));
  };

  const addDocs = async (cat, fileList) => {
    let files = Array.from(fileList || []);
    const tooBig = files.filter(f => f.size > 5 * 1024 * 1024 * 1024);
    if (tooBig.length) alert(`Слишком большие файлы (максимум 5 ГБ) — пропущены:\n${tooBig.map(f => `${f.name} — ${(f.size / 1024 / 1024).toFixed(0)} МБ`).join('\n')}`);
    files = files.filter(f => f.size <= 5 * 1024 * 1024 * 1024);
    if (!files.length) return;
    // v69.5: партии — чтобы сервер не держал весь объём в памяти (16+ ГБ одним запросом = падение)
    const BATCH_MAX_FILES = 80;
    const BATCH_MAX_BYTES = 280 * 1024 * 1024;
    const totalBytes = Math.max(1, files.reduce((a, f) => a + f.size, 0));
    const estBatches = Math.max(1, Math.ceil(files.length / BATCH_MAX_FILES), Math.ceil(totalBytes / BATCH_MAX_BYTES));
    const curFolder = docFolder[cat] || 'All';
    const basePath = (docPath[cat] || '').replace(/^\/+|\/+$/g, '');
    const relOf = (f) => {
      let rel = '';
      if (f.webkitRelativePath) rel = f.webkitRelativePath.split('/').slice(1).join('/');
      return String(rel || '').replace(/^\/+|\/+$/g, '').slice(0, 200);
    };
    setDocsBusy(true);
    docsStopRef.current = false;
    setDocsUpload({ phase: 'prepare', percent: 0, done: 0, total: files.length, currentFile: '', batch: 0, batches: estBatches });
    let uploaded = 0;   // файлов уже СОХРАНЕНО на сервере (по завершённым партиям)
    let bytesDone = 0;  // байты (исходные) завершённых партий — для общего процента
    let compressFails = []; // v69.5.1: фото, которые не удалось сжать (уйдут как есть)
    try {
      let batch = []; // [{orig, prep, rel}]
      let batchOrigBytes = 0;
      let batchNo = 0;
      const flush = async () => {
        if (!batch.length) return;
        batchNo++;
        const thisBatch = batch;
        const thisBytes = Math.max(1, batchOrigBytes);
        batch = []; batchOrigBytes = 0;
        const fd = new FormData();
        thisBatch.forEach(p => fd.append('files', p.prep));
        if (curFolder !== 'All') fd.append('folder', curFolder); // v57.7: загрузка в выбранную подпапку
        // v57.9: относительные пути (структура папки) — для файлов ЭТОЙ партии
        const pathsArr = thisBatch.map(p => (basePath ? (p.rel ? basePath + '/' + p.rel : basePath) : p.rel));
        if (pathsArr.some(p => p)) fd.append('paths', JSON.stringify(pathsArr));
        const send = () => new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          docsXhrRef.current = xhr;
          xhr.open('POST', `${API_URL}/api/docs/${cat}/files?token=${token}`);
          xhr.upload.onprogress = (ev) => {
            if (!ev.lengthComputable) return;
            const frac = Math.min(1, ev.loaded / ev.total);
            const overall = Math.min(100, Math.round((bytesDone + frac * thisBytes) / totalBytes * 100));
            const estDone = Math.min(files.length, uploaded + Math.floor(frac * thisBatch.length));
            // v68.5.1: байты партии ушли целиком → сервер сохраняет; обрывать НЕЛЬЗЯ
            setDocsUpload(prev => prev ? { ...prev, percent: overall, done: estDone, batch: batchNo, phase: frac >= 1 ? 'save' : 'upload' } : prev);
          };
          xhr.onload = () => {
            let d = {};
            try { d = JSON.parse(xhr.responseText || '{}'); } catch (e) { d = {}; }
            if (xhr.status >= 200 && xhr.status < 300) resolve(d);
            else reject(new Error(d.error || (xhr.responseText && xhr.responseText.length < 300 ? xhr.responseText : `HTTP ${xhr.status}`)));
          };
          xhr.onerror = () => reject(new Error('сетевая ошибка'));
          xhr.onabort = () => reject(new Error('ABORTED'));
          xhr.send(fd);
        });
        // v69.5: одна автоматическая повторная попытка для сбойной партии (кроме ручной остановки)
        let data = null;
        let lastErr = null;
        for (let attempt = 0; attempt < 2 && !data; attempt++) {
          if (docsStopRef.current) throw new Error('ABORTED');
          try { data = await send(); }
          catch (e) {
            if (e.message === 'ABORTED') throw e;
            lastErr = e;
            setDocsUpload(prev => prev ? { ...prev, phase: 'upload', currentFile: `⚠️ партия ${batchNo}: сбой — повторная попытка…` } : prev);
            await new Promise(r => setTimeout(r, 2500));
          }
        }
        docsXhrRef.current = null;
        if (!data) throw new Error(`партия ${batchNo}: ${lastErr ? lastErr.message : 'не отправилась'}. Уже загружено и сохранено: ${uploaded} из ${files.length} — они НЕ потеряны.`);
        uploaded += thisBatch.length;
        bytesDone += thisBytes;
        setDocsUpload(prev => prev ? { ...prev, percent: Math.min(100, Math.round(bytesDone / totalBytes * 100)), done: uploaded, batch: batchNo } : prev);
        setSections(prev => ({ ...prev, [cat]: data.attachments || [] })); // файлы появляются по мере загрузки партий
        setDocsError(null);
      };
      for (let pi = 0; pi < files.length; pi++) {
        if (docsStopRef.current) throw new Error('ABORTED');
        const f = files[pi];
        setDocsUpload(prev => prev ? { ...prev, phase: 'prepare', currentFile: f.name } : prev);
        // v70: файл >1 ГБ — напрямую в облако частями (минуя сервер), с докачкой
        if (f.size > BIG_FILE_LIMIT) {
          await flush(); // сначала уходит накопленная партия обычных файлов
          const bigBase = bytesDone;
          setDocsUpload(prev => prev ? { ...prev, phase: 'upload', currentFile: `☁️ ${f.name} — прямая загрузка в облако…` } : prev);
          await bigUploadDoc(cat, f, relOf(f), (doneB, note) => {
            const overall = Math.min(100, Math.round((bigBase + doneB) / totalBytes * 100));
            setDocsUpload(prev => prev ? { ...prev, percent: overall, currentFile: `☁️ ${note}` } : prev);
          });
          uploaded++;
          bytesDone += f.size;
          setDocsUpload(prev => prev ? { ...prev, done: uploaded, percent: Math.min(100, Math.round(bytesDone / totalBytes * 100)) } : prev);
          continue;
        }
        // v69.5.2: ЛЮБАЯ ошибка подготовки (битое фото «Failed to load image», HEIC, сбой чтения) НЕ роняет
        // загрузку папки — файл уходит как есть, в конце будет сводка
        let prep = f;
        try {
          if (docKindOf(f) === 'photo') prep = await compressImageFile(f);
        } catch (ce) { compressFails.push(f.name); console.warn('Без сжатия (не удалось прочитать):', f.name, ce && ce.message); }
        batch.push({ orig: f, prep, rel: relOf(f) });
        batchOrigBytes += f.size;
        if (batch.length >= BATCH_MAX_FILES || batchOrigBytes >= BATCH_MAX_BYTES) await flush();
      }
      await flush();
      setDocsUpload(prev => prev ? { ...prev, percent: 100, done: files.length } : prev);
      // v69.5.1: сводка по несжавшимся фото — они на сервере в исходном качестве
      if (compressFails.length) alert(`Готово. ${compressFails.length} фото не удалось сжать в браузере (повреждённые/нестандартные) — они загружены как есть:\n${compressFails.slice(0, 20).join('\n')}${compressFails.length > 20 ? `\n… и ещё ${compressFails.length - 20}` : ''}`);
      // v68.5: АВТО-распознавание при загрузке УБРАНО — файлы просто сохраняются на сервер.
    } catch (e) {
      if (e.message === 'ABORTED') {
        console.log('Загрузка документов остановлена пользователем');
        if (uploaded) { alert(`Загрузка остановлена.\nУже загружено и сохранено на сервере: ${uploaded} из ${files.length} файлов — они НЕ потеряны.`); loadDocs(); }
      } else {
        alert('Не загрузилось: ' + e.message);
        if (uploaded) loadDocs();
      }
    } finally {
      docsXhrRef.current = null;
      docsStopRef.current = false;
      setDocsUpload(null);
      setDocsBusy(false);
    }
  };

  // v57.7: файл → страницы с текстом (оригинал+перевод); PDF раскрывается в страницы через pdf.js
  const recognizeFilePages = async (m) => {
    const resp = await fetch(m.url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} при скачивании файла`);
    const blob = await resp.blob();
    const fileName = m.name || 'file';
    let pageFiles;
    if (/\.pdf(\?|$)/i.test(fileName) || /\.pdf(\?|$)/i.test(m.url || '')) {
      pageFiles = await convertPdfToImages(new File([blob], fileName, { type: 'application/pdf' }));
      if (!pageFiles.length) throw new Error('Не удалось разобрать PDF на страницы');
    } else {
      pageFiles = [new File([blob], fileName, { type: blob.type || 'image/jpeg' })];
    }
    const fd = new FormData();
    pageFiles.forEach(f => fd.append('pages', f));
    const r = await fetch(`${API_URL}/api/docs/recognize-text?token=${token}`, { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return { pages: Array.isArray(j.pages) ? j.pages : [], pageUrls: pageFiles.map(f => URL.createObjectURL(f)) };
  };

  // v57.7: сохранить распознанный текст в карточке файла (PATCH на сервер + локальный state)
  const saveDocOcr = async (cat, url, pages, docDate) => {
    const body = { url, ocr: { pages } };
    if (docDate) body.docDate = docDate; // v59: дата документа из текста
    const r = await fetch(`${API_URL}/api/docs/${cat}/files?token=${token}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    setSections(prev => ({ ...prev, [cat]: Array.isArray(j.attachments) ? j.attachments : prev[cat] }));
  };

  const removeDoc = async (cat, url) => {
    if (!window.confirm('Удалить этот файл?')) return;
    try {
      const res = await fetch(`${API_URL}/api/docs/${cat}/files?token=${token}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSections(prev => ({ ...prev, [cat]: data.attachments || [] }));
    } catch (e) { alert('Не удалилось на сервере: ' + e.message); }
  };

  // v59: операции с папками — переименовать / удалить (файлы остаются в разделе)
  const docsFolderOp = async (body, okMsg) => {
    const r = await fetch(`${API_URL}/api/docs/${docSection}/files?token=${token}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    setSections(prev => ({ ...prev, [docSection]: Array.isArray(j.attachments) ? j.attachments : prev[docSection] }));
    if (body && body.moveTo) loadDocs(); // v68.8.2: при переносе между разделами обновляем ВСЕ вкладки с сервера
    if (okMsg) console.log(okMsg);
  };
  const renameDocsFolder = async (fn) => {
    const to = (window.prompt(`Переименовать папку «${fn}» в:\n(чтобы ВЛОЖИТЬ — введите «Родитель/Имя», например Volvo/3)`, fn) || '').trim().slice(0, 60);
    if (!to || to === fn) return;
    try {
      await docsFolderOp({ folderRename: { from: fn, to } });
    } catch (e) {
      // v59.1: на сервере могло не быть файлов с такой папкой — пустая папка тоже переименовывается (локальный реестр)
      if (!/не найден|404/i.test(e.message)) { alert('Не переименовалось: ' + e.message); return; }
    }
    if (curDocFolder === fn) setDocFolder(prev => ({ ...prev, [docSection]: to }));
    setCustomFolders(prev => {
      const list = (prev[docSection] || []).filter(f => f !== fn && f !== to);
      return { ...prev, [docSection]: [...list, to] };
    });
    if ((DOC_FOLDERS[docSection] || []).includes(fn)) {
      setHiddenFolders(prev => ({ ...prev, [docSection]: [...new Set([...(prev[docSection] || []), fn])] }));
    }
  };
  const deleteDocsFolder = async (fn) => {
    const cnt = allItems.filter(it => docMediaOf(it).folder === fn).length;
    if (!window.confirm(`Удалить папку «${fn}»?\n${cnt ? `Файлы (${cnt}) НЕ удалятся — попадут в «Все».` : 'Папка пустая.'}`)) return;
    try {
      await docsFolderOp({ folderDelete: fn });
    } catch (e) {
      if (!/не найден|404/i.test(e.message)) { alert('Не удалилось: ' + e.message); return; }
    }
    if (curDocFolder === fn) setDocFolder(prev => ({ ...prev, [docSection]: 'All' }));
    setCustomFolders(prev => ({ ...prev, [docSection]: (prev[docSection] || []).filter(f => f !== fn) }));
    setHiddenFolders(prev => ({ ...prev, [docSection]: [...new Set([...(prev[docSection] || []), fn])] }));
  };
  // v68.6: создать пустую папку (реестр в localStorage) и сразу перейти в неё
  // v69.4: rename/delete папок дерева — на УРОВНЕ КОМПОНЕНТА
  // (в v69.2–v69.3 по ошибке лежали ВНУТРИ createDocsFolder — ✎/✕ у вложенных папок молча падали)
  const renameTreeFolder = async (full) => {
    const segs = full.split('/');
    const parent = segs.slice(0, -1).join('/');
    const to = (window.prompt(`Переименовать папку «${full}» в:`, segs[segs.length - 1]) || '').trim().slice(0, 60).replace(/^[\/]+|[\/]+$/g, '');
    if (!to || to === segs[segs.length - 1]) return;
    const fullTo = parent ? parent + '/' + to : to;
    try {
      await docsFolderOp({ pathRename: { from: full, to: fullTo } });
    } catch (e) {
      if (!/не найден|404/i.test(e.message)) { alert('Не переименовалось: ' + e.message); return; }
    }
    setCustomTree(prev => ({ ...prev, [docSection]: (prev[docSection] || []).map(p => p === full ? fullTo : (p.startsWith(full + '/') ? fullTo + p.slice(full.length) : p)) }));
    if (curDocPath === full || curDocPath.startsWith(full + '/')) setDocPath(prev => ({ ...prev, [docSection]: fullTo + curDocPath.slice(full.length) }));
  };
  // v69.2: удалить папку дерева — файлы НЕ удаляются, поднимаются к родителю (или в корень)
  const deleteTreeFolder = async (full) => {
    const cnt = treeCountOf(full);
    const parent = full.split('/').slice(0, -1).join('/');
    if (!window.confirm(`Удалить папку «${full}»?\n${cnt ? `Файлы (${cnt}) НЕ удалятся — переместятся ${parent ? `в «${parent}»` : 'в корень'}.` : 'Папка пустая.'}`)) return;
    try {
      await docsFolderOp({ pathRename: { from: full, to: parent } });
    } catch (e) {
      if (!/не найден|404/i.test(e.message)) { alert('Не удалилось: ' + e.message); return; }
    }
    // folder-папки с таким вложенным именем — тоже поднимаем
    for (const nf of dynFolders.filter(f => f === full || f.startsWith(full + '/'))) {
      const to = parent ? parent + nf.slice(full.length) : nf.slice(full.length + 1);
      try { await docsFolderOp({ folderRename: { from: nf, to } }); } catch (e) {}
      setCustomFolders(prev => ({ ...prev, [docSection]: (prev[docSection] || []).map(f => f === nf ? to : f) }));
    }
    setCustomTree(prev => ({ ...prev, [docSection]: (prev[docSection] || []).filter(p => p !== full && !p.startsWith(full + '/')) }));
    if (curDocPath === full || curDocPath.startsWith(full + '/')) setDocPath(prev => ({ ...prev, [docSection]: parent }));
    loadDocs();
  };

  // v68.6/v69: создать пустую папку — внутри открытой (вложенную) или в корне раздела
  // v69.4: секция зафиксирована явно; в диалоге видно РАЗДЕЛ и путь назначения
  const createDocsFolder = () => {
    const sec = docSection;
    const secTitle = (DOC_SECTIONS.find(x => x.key === sec) || {}).title || sec;
    // v69: если открыта ЛЮБАЯ папка (ветка дерева или folder-чип, например Volvo) — папка создаётся ВНУТРИ неё
    const baseDir = curDocPath || (curDocFolder !== 'All' ? curDocFolder : '');
    if (baseDir) {
      const nm = (window.prompt(`Новая ВЛОЖЕННАЯ папка\nРаздел: ${secTitle}\nВнутри папки: «${baseDir}»\n\nИмя папки:`) || '').trim().slice(0, 60).replace(/^[\/]+|[\/]+$/g, '');
      if (!nm) return;
      const full = baseDir + '/' + nm;
      setCustomTree(prev => ({ ...prev, [sec]: [...new Set([...(prev[sec] || []), full])] }));
      setDocFolder(prev => ({ ...prev, [sec]: 'All' }));
      setDocPath(prev => ({ ...prev, [sec]: full }));
      return;
    }
    const nm = (window.prompt(`Новая папка в КОРНЕ раздела\nРаздел: ${secTitle}\n\nИмя папки:`) || '').trim().slice(0, 40);
    if (!nm) return;
    if (dynFolders.includes(nm)) { alert(`Папка «${nm}» уже есть`); return; }
    setCustomFolders(prev => ({ ...prev, [sec]: [...new Set([...(prev[sec] || []), nm])] }));
    setHiddenFolders(prev => ({ ...prev, [sec]: (prev[sec] || []).filter(f => f !== nm) }));
    setDocFolder(prev => ({ ...prev, [sec]: nm }));
  };

  // v69.4: 🧹 удалить ВСЕ пустые папки-заглушки реестра дерева в текущем разделе (мусор старых версий)
  // Удаляются только записи реестра без файлов (и без непустых потомков) — сами файлы не затрагиваются.
  const cleanEmptyTreeFolders = () => {
    const norm = (p) => String(p || '').replace(/^\/+|\/+$/g, '');
    const reg = [...new Set((customTree[docSection] || []).map(norm).filter(Boolean))];
    if (!reg.length) { alert('В этом разделе нет пустых папок-заглушек.'); return; }
    const removed = new Set();
    let again = true;
    while (again) {
      again = false;
      for (const p of reg) {
        if (removed.has(p) || treeCountOf(p) > 0) continue;
        const busyChild = treePathsAll.some(q => q !== p && q.startsWith(p + '/') && !removed.has(q));
        if (!busyChild) { removed.add(p); again = true; }
      }
    }
    if (!removed.size) { alert('Пустых папок-заглушек не найдено — во всех есть файлы.'); return; }
    const secTitle = (DOC_SECTIONS.find(x => x.key === docSection) || {}).title || docSection;
    if (!window.confirm(`Удалить ПУСТЫЕ папки без файлов в разделе «${secTitle}» (${removed.size})?\n\n${[...removed].join('\n')}\n\nФайлы НЕ затрагиваются.`)) return;
    setCustomTree(prev => ({ ...prev, [docSection]: (prev[docSection] || []).filter(x => !removed.has(norm(x))) }));
    if ([...removed].some(r => curDocPath === r || curDocPath.startsWith(r + '/'))) setDocPath(prev => ({ ...prev, [docSection]: '' }));
  };

  // v66: переименование папки из структуры загрузки (item.path) — через префикс пути
  const renameDocsSubfolder = async (fn) => {
    const full = curDocPath ? curDocPath + '/' + fn : fn;
    const to = (window.prompt(`Переименовать папку «${fn}» в:`, fn) || '').trim().slice(0, 60).replace(/^\/+|\/+$/g, '');
    if (!to || to === fn) return;
    const fullTo = curDocPath ? curDocPath + '/' + to : to;
    try {
      await docsFolderOp({ pathRename: { from: full, to: fullTo } });
      if (curDocPath) setDocPath(prev => ({ ...prev, [docSection]: curDocPath }));
    } catch (e) { alert('Не переименовалось: ' + e.message); }
  };

  // v59: мультивыбор — переместить в папку / удалить группой
  const selectedUrls = Object.keys(docsSelected).filter(u => docsSelected[u]);
  // v71: поделиться ссылкой на выбранные файлы (все загруженные разделы, не только текущий экран)
  const shareSelectedDocs = () => {
    const map = {};
    Object.values(sections).forEach(list => (list || []).forEach(e => { const m = docMediaOf(e); if (m && m.url) map[m.url] = m; }));
    const items = selectedUrls.map(u => map[u]).filter(Boolean)
      .map(m => ({ url: m.url, name: m.name || 'file', kind: m.kind || 'file', size: m.size || 0 }));
    if (!items.length) return alert('Выбранные файлы не найдены среди загруженных разделов');
    const secTitle = (DOC_SECTIONS.find(x => x.key === docSection) || {}).title || 'Документы';
    setShareDlg({ title: `${secTitle} · ${items.length} файл(ов)`, days: 30, items, busy: false, url: '', err: '' });
  };
  const moveSelectedDocs = async (folder) => {
    if (!selectedUrls.length) return;
    setDocsMove({ total: selectedUrls.length, target: folder ? `📁 ${folder}` : '🚫 Без папки', status: 'run', msg: '' });
    try {
      await docsFolderOp({ urls: selectedUrls, folder });
      setDocsMove(prev => prev ? { ...prev, status: 'ok' } : prev);
      setTimeout(() => setDocsMove(null), 1200);
      setDocsSelected({}); setDocsSelectMode(false);
    } catch (e) { setDocsMove(prev => prev ? { ...prev, status: 'err', msg: e.message } : prev); }
  };
  // v68.7: переместить выбранные файлы в папку СТРУКТУРЫ (item.path), '' — в корень дерева
  const moveSelectedDocsToPath = async (p) => {
    if (!selectedUrls.length) return;
    setDocsMove({ total: selectedUrls.length, target: `🌳 ${p || '(корень дерева)'}`, status: 'run', msg: '' });
    try {
      await docsFolderOp({ urls: selectedUrls, path: p });
      setDocsMove(prev => prev ? { ...prev, status: 'ok' } : prev);
      setTimeout(() => setDocsMove(null), 1200);
      setDocsSelected({}); setDocsSelectMode(false);
    } catch (e) { setDocsMove(prev => prev ? { ...prev, status: 'err', msg: e.message } : prev); }
  };
  // v68.8: переместить выбранные файлы в ДРУГОЙ раздел (и опционально в его папку/ветку дерева)
  const moveSelectedDocsToSection = async (target, folder, tpath) => {
    if (!selectedUrls.length) return;
    const secTitle = (DOC_SECTIONS.find(x => x.key === target) || {}).title || target;
    const dest = tpath ? `${secTitle} · 🌳 ${tpath}` : (folder ? `${secTitle} · 📁 ${folder}` : `${secTitle} · корень`);
    setDocsMove({ total: selectedUrls.length, target: dest, status: 'run', msg: '' });
    try {
      await docsFolderOp({ urls: selectedUrls, moveTo: { category: target, folder: folder || '', path: tpath || '' } });
      setDocsMove(prev => prev ? { ...prev, status: 'ok' } : prev);
      setTimeout(() => setDocsMove(null), 1200);
      setDocsSelected({}); setDocsSelectMode(false);
    } catch (e) { setDocsMove(prev => prev ? { ...prev, status: 'err', msg: e.message } : prev); }
  };
  const removeSelectedDocs = async () => {
    if (!selectedUrls.length) return;
    if (!window.confirm(`Удалить выбранные файлы (${selectedUrls.length})?`)) return;
    try {
      const r = await fetch(`${API_URL}/api/docs/${docSection}/files?token=${token}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: selectedUrls })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setSections(prev => ({ ...prev, [docSection]: Array.isArray(j.attachments) ? j.attachments : prev[docSection] }));
      setDocsSelected({}); setDocsSelectMode(false);
    } catch (e) { alert('Не удалилось: ' + e.message); }
  };

  // v57.6/v57.7: карточка «фото + текст по страницам». Если текст уже распознан и сохранён —
  // открываем мгновенно; иначе распознаём и СОХРАНЯЕМ в карточке файла (оригинал + перевод)
  const recognizeDoc = async (entry) => {
    const m = docMediaOf(entry);
    if (docsOcr && docsOcr.loading) return;
    if (m.ocr && Array.isArray(m.ocr.pages) && m.ocr.pages.length) {
      setDocsOcr({
        loading: false, saved: true, name: m.name || 'Файл', url: m.url, kind: m.kind,
        pageUrls: null, pages: m.ocr.pages, idx: 0, tab: 'ru'
      });
      return;
    }
    setDocsOcr({ loading: true, name: m.name || 'Файл' });
    try {
      const { pages, pageUrls } = await recognizeFilePages(m);
      const docDate = parseDocDateFromText((pages || []).map(p => p.original || '').join('\n')); // v59
      await saveDocOcr(docSection, m.url, pages, docDate); // сохранение в карточке (v57.7 + дата документа v59)
      setDocsOcr({
        loading: false, saved: true, name: m.name || 'Файл', url: m.url, kind: m.kind,
        pageUrls, pages, idx: 0, tab: 'ru'
      });
    } catch (e) {
      setDocsOcr(null);
      alert('Распознавание не удалось: ' + e.message);
    }
  };

  // v58: Excel → таблица прямо в приложении (SheetJS), без скачивания
  const openExcelDoc = async (m) => {
    if (docsExcel && docsExcel.loading) return;
    setDocsExcel({ loading: true, name: m.name || 'Таблица' });
    try {
      const XLSX = await loadXlsx();
      const resp = await fetch(m.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status} при скачивании файла`);
      const wb = XLSX.read(await resp.arrayBuffer(), { type: 'array' });
      const sheets = wb.SheetNames.map(sn => ({
        name: sn,
        html: XLSX.utils.sheet_to_html(wb.Sheets[sn], { header: '', footer: '' })
      }));
      if (!sheets.length) throw new Error('В файле нет листов');
      setDocsExcel({ loading: false, name: m.name || 'Таблица', url: m.url, sheets, idx: 0 });
    } catch (e) {
      setDocsExcel(null);
      alert('Не удалось открыть Excel: ' + e.message);
    }
  };

  const docThumb = (entry, key) => {
    const m = docMediaOf(entry);
    const openViewer = () => { setDocsViewer({ url: m.url, kind: m.kind, name: m.name || '' }); setDocsZoom(false); setDocsVErr(false); };
    const box = { width: 72, height: 72, borderRadius: 8, border: '1px solid #e0e0e0', background: '#f5f5f7', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 26, overflow: 'hidden' };
    const isPdfD = m.kind === 'doc' && (/\.pdf(\?|$)/i.test(m.name || '') || /\.pdf(\?|$)/i.test(m.url || ''));
    const canPreview = m.kind === 'photo' || m.kind === 'video' || isPdfD;
    const isSel = !!docsSelected[m.url]; // v59
    return (
      <span key={key} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', width: 96, borderRadius: 8, outline: isSel ? '3px solid #0071e3' : 'none', outlineOffset: 1 }} title={m.name || 'Файл'}
        onClickCapture={docsSelectMode ? (e) => { e.preventDefault(); e.stopPropagation(); setDocsSelected(prev => ({ ...prev, [m.url]: !prev[m.url] })); } : undefined}
        onMouseEnter={() => { if (canPreview && !docsSelectMode) setDocsHover({ url: m.url, kind: isPdfD ? 'pdf' : m.kind, name: m.name || '' }); }}
        onMouseLeave={() => setDocsHover(prev => (prev && prev.url === m.url ? null : prev))}>
        <span style={{ position: 'relative', display: 'inline-block' }}>
        {docsSelectMode && (
          <span style={{ position: 'absolute', top: -6, left: -6, width: 20, height: 20, borderRadius: '50%', background: isSel ? '#0071e3' : '#fff', border: '2px solid #0071e3', color: '#fff', fontSize: 12, lineHeight: '17px', textAlign: 'center', zIndex: 2 }}>{isSel ? '✓' : ''}</span>
        )}
        {m.kind === 'video' ? (
          <span onClick={openViewer} style={{ ...box, display: 'inline-block', position: 'relative', background: '#1d1d1f' }}>
            <video src={`${m.url}#t=0.1`} muted playsInline preload="auto" style={{ width: 72, height: 72, objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
            <span style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 24, textShadow: '0 1px 4px rgba(0,0,0,0.8)', pointerEvents: 'none' }}>▶</span>
          </span>
        ) : m.kind === 'audio' ? (
          <span onClick={openViewer} style={box}>🎵</span>
        ) : m.kind === 'doc' || m.kind === 'file' ? (
          isExcelName(m.name || '') || isExcelName(m.url || '') ? (
            <span onClick={() => openExcelDoc(m)} title={`${m.name || 'Excel'} — открыть таблицу`} style={{ ...box, fontSize: 24 }}>📊</span>
          ) : (
          <a href={m.url} target="_blank" rel="noreferrer" style={{ ...box, textDecoration: 'none', flexDirection: 'column', fontSize: 24 }}>
            {m.kind === 'doc' ? (/\.pdf(\?|$)/i.test(m.name || m.url || '') ? '📄' : '📝') : '📎'}
          </a>
          )
        ) : (
          <img src={m.url} alt="" onClick={openViewer} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, cursor: 'zoom-in', border: '1px solid #e0e0e0' }} />
        )}
        <button onClick={() => removeDoc(docSection, m.url)} title="Удалить файл" style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#e74c3c', color: '#fff', fontSize: 10, cursor: 'pointer', lineHeight: '18px', padding: 0, zIndex: 1 }}>✕</button>
        {(m.kind === 'photo' || m.kind === 'doc') && (
          <button onClick={(e) => { e.stopPropagation(); recognizeDoc(entry); }} title="Распознать текст (фото → текст по страницам + перевод)" style={{ position: 'absolute', top: -6, left: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#0071e3', color: '#fff', fontSize: 10, cursor: 'pointer', lineHeight: '18px', padding: 0, zIndex: 1 }}>📝</button>
        )}
        {m.ocr && Array.isArray(m.ocr.pages) && m.ocr.pages.length ? (
          <span title="Текст распознан и сохранён — откроется карточка" style={{ position: 'absolute', bottom: -6, right: -6, width: 16, height: 16, borderRadius: '50%', background: '#34c759', color: '#fff', fontSize: 9, lineHeight: '16px', textAlign: 'center', zIndex: 1 }}>Т</span>
        ) : null}
        </span>
        {m.name ? <div style={{ marginTop: 5, width: 96, fontSize: 10, color: '#555', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div> : null}
        <div style={{ marginTop: 1, width: 96, fontSize: 9, color: m.docDate ? '#1d1d1f' : '#c7c7cc', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
          {m.docDate ? `📅 ${fmtDocDate(m.docDate)}` : (m.ts ? `⇪ ${fmtDocDate(new Date(m.ts).toISOString().slice(0, 10))}` : '')}
        </div>
      </span>
    );
  };

  const curDocFolder = docFolder[docSection] || 'All';
  const allItems = sections[docSection] || [];
  const folderItems = allItems; // v69: фильтрация по местоположению — единая через relPathOf (path ИЛИ folder)
  // v57.9: навигация по структуре загруженных папок (item.path)
  const curDocPath = (docPath[docSection] || '').replace(/^\/+|\/+$/g, '');
  // v68.8.2: всеядно — path может хранить путь С именем файла ('Kit/IMG_1.jpeg')
  // или БЕЗ него (legacy 'Kit' от перемещений на старом backend): если последний сегмент
  // похож на имя файла (есть расширение) — папка без него, иначе весь путь — папка файла.
  const dirOfDocPath = (p) => {
    const q = String(p || '').replace(/^\/+|\/+$/g, '');
    if (!q) return '';
    const segs = q.split('/');
    const last = segs[segs.length - 1];
    return /\.[A-Za-z0-9]{1,15}$/.test(last) ? segs.slice(0, -1).join('/') : q;
  };
  // v68.9.3: точно — вычитаем ИМЯ файла из конца path (иначе 'Oleg/0E5E....textClipping' считался папкой)
  const dirOfDocItem = (it) => {
    const m = docMediaOf(it);
    const p = String(m.path || '').replace(/^\/+|\/+$/g, '');
    if (!p) return '';
    const nm = String(m.name || '').trim();
    if (nm) {
      if (p === nm) return '';
      if (p.endsWith('/' + nm)) return p.slice(0, p.length - nm.length - 1);
    }
    return dirOfDocPath(p);
  };
  // v69: единое местоположение — папка из path, иначе поле folder (обе системы слиты)
  const effDirOf = (it) => dirOfDocItem(it) || String(docMediaOf(it).folder || '').trim();
  const relPathOf = (it) => {
    const dir = effDirOf(it);
    if (curDocPath) {
      if (dir === curDocPath) return ''; // файл прямо в текущей папке
      if (dir.startsWith(curDocPath + '/')) return dir.slice(curDocPath.length + 1); // во вложенной подпапке
      return null; // файл вне текущей ветки — не показываем
    }
    return dir;
  };
  const subFolders = [];
  const seenSub = {};
  const items = folderItems.filter(it => {
    const p = relPathOf(it);
    if (p === null) return false;
    if (p === '') return true; // v68.7: файл прямо в текущей папке — только пустой относительный путь
    const first = p.split('/')[0]; // иначе первый сегмент — подпапка дерева
    if (!seenSub[first]) { seenSub[first] = 0; subFolders.push(first); }
    seenSub[first]++;
    return false;
  });
  // v68.9.2: подпапки из реестра пустых папок дерева — видны сразу после создания
  (customTree[docSection] || []).forEach(p => {
    const q = String(p || '').replace(/^\/+|\/+$/g, '');
    if (!q) return;
    let rel = null;
    if (curDocPath) {
      if (q.startsWith(curDocPath + '/')) rel = q.slice(curDocPath.length + 1);
    } else rel = q;
    if (rel === null || rel === '' ) return;
    const first = rel.split('/')[0];
    if (!seenSub[first]) { seenSub[first] = 0; subFolders.push(first); }
  });
  // v59: сортировка — по дате документа или по дате распознавания/загрузки
  const sortKeyOf = (it) => {
    const mm = docMediaOf(it);
    if (docsSort.by === 'docDate') return mm.docDate || '';
    return String(mm.ts || (mm.ocr && mm.ocr.ts) || '');
  };
  const itemsSorted = [...items].sort((a, b) => {
    const ka = sortKeyOf(a), kb = sortKeyOf(b);
    if (ka === kb) return 0;
    const cmp = ka < kb ? -1 : 1;
    return docsSort.dir === 'asc' ? cmp : -cmp;
  });
  // v59: папки = предустановленные + реально используемые, минус локально скрытые
  const usedFolders = [...new Set(allItems.map(it => docMediaOf(it).folder).filter(Boolean))];
  const dynFolders = [...new Set([...(DOC_FOLDERS[docSection] || []), ...(customFolders[docSection] || []), ...usedFolders])]
    .filter(f => !(hiddenFolders[docSection] || []).includes(f));
  // v68.7: все пути дерева структуры (item.path) — для перемещения в существующие папки дерева
  const allTreePaths = [...new Set(allItems.map(it => dirOfDocItem(it)).filter(Boolean))].sort();
  // v68.9.3: все пути дерева (файлы + реестр пустых папок)
  const treePathsAll = [...new Set([...allTreePaths, ...(customTree[docSection] || [])].map(p => String(p).replace(/^\/+|\/+$/g, '')).filter(Boolean))].sort();
  // v68.9: папки дерева первого уровня — чипами в строке «Папка:» (единый вид во всех вкладках)
  const topTreeFolders = [...new Set(treePathsAll.map(p => p.split('/')[0]))].sort();
  // v68.9.3: прямые дети каждой папки первого уровня — для чипов вложенных папок
  // v69.2: ВСЕ потомки папки (относительные пути любой глубины: '1', '1/2', …)
  const treeDescendantsOf = (tp) => [...new Set([
    ...treePathsAll.filter(p => p.startsWith(tp + '/')).map(p => p.slice(tp.length + 1)),
    ...dynFolders.filter(f => f.indexOf('/') !== -1 && f.startsWith(tp + '/')).map(f => f.slice(tp.length + 1))
  ].filter(Boolean))].sort();
  const treeCountOf = (tp) => allItems.filter(it => { const d = effDirOf(it); return d === tp || d.startsWith(tp + '/'); }).length;
  // v69: единый список папок верхнего уровня — folder-папки + папки дерева
  const topFoldersAll = [...dynFolders.filter(f => f.indexOf('/') === -1), ...topTreeFolders.filter(t => !dynFolders.includes(t) && t.indexOf('/') === -1)];
  // v68.8: папки и деревья ДРУГИХ разделов — для перемещения между вкладками
  const dirOfPath = dirOfDocPath;
  const otherSections = DOC_SECTIONS.filter(sec => sec.key !== docSection).map(sec => {
    const list = sections[sec.key] || [];
    const used = [...new Set(list.map(it => docMediaOf(it).folder).filter(Boolean))];
    const folders = [...new Set([...(DOC_FOLDERS[sec.key] || []), ...(customFolders[sec.key] || []), ...used])]
      .filter(f => !(hiddenFolders[sec.key] || []).includes(f));
    const tree = [...new Set(list.map(it => dirOfDocItem(it)).filter(Boolean))].sort();
    return { key: sec.key, title: sec.title, folders, tree };
  });
  return (
    <div style={{ padding: '12px 15px', maxWidth: 1100, margin: '0 auto' }}>
      <style>{'.docs-active-tab{background:#0071e3 !important;color:#fff !important;border-color:#0071e3 !important}.docs-active-tab:hover{background:#0066d6 !important}'}</style>
      <h2 style={{ margin: '4px 0 4px', fontSize: 20 }}>📁 Документы</h2>
      <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 12 }}>
        Файлы любых типов — фото, видео, аудио, текст, PDF и другие. Общее хранилище команды (сервер). Видео 50–300 МБ сжимаются на сервере автоматически; 300 МБ–1 ГБ загружаются как есть; больше 1 ГБ (до 5 ГБ) — напрямую в облако частями с докачкой.
      </div>
      {docsError && (
        <div style={{ background: '#fff4e5', border: '1px solid #ffd699', borderRadius: 10, padding: '8px 12px', fontSize: 13, color: '#8a6d3b', marginBottom: 10 }}>
          ⚠️ Сервер документов недоступен: {docsError}. Проверьте, что выполнена миграция supabase-migration-v25-docs.sql и сделан redeploy householder-api.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {(visibleDocSections).map(sec => (
          <button key={sec.key} className={docSection === sec.key ? 'docs-active-tab' : ''} onClick={() => { setDocSection(sec.key); setDocsHover(null); setDocsSelected({}); setDocsSelectMode(false); setDocPath(prev => ({ ...prev, [sec.key]: '' })); }}
            style={{ padding: '8px 18px', borderRadius: 980, border: docSection === sec.key ? '2px solid #0071e3' : '1px solid #c7c7cc', background: docSection === sec.key ? '#0071e3' : '#fff', color: docSection === sec.key ? '#fff' : '#1d1d1f', fontWeight: 700, fontSize: 14, cursor: 'pointer', boxShadow: docSection === sec.key ? '0 2px 8px rgba(0,113,227,0.35)' : 'none' }}>
            {sec.title} ({(sections[sec.key] || []).length})
          </button>
        ))}
      </div>
      {(
        <div style={{ marginBottom: 12 }}>
          {/* v69.3: ДЕРЕВО папок — вложенные выводятся ПОД основной папкой с отступом */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: topFoldersAll.length ? 6 : 0 }}>
            <span style={{ fontSize: 12, color: '#8e8e93', marginRight: 2 }}>Папка:</span>
            {!docsReadOnly && (
              <button onClick={createDocsFolder} title="Создать новую папку (внутри открытой — вложенную)"
                style={{ padding: '5px 12px', borderRadius: 980, border: '1px dashed #0071e3', background: '#fff', color: '#0071e3', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>＋ Папка</button>
            )}
            {docsReadOnly ? null : (
            <button onClick={cleanEmptyTreeFolders} title="Удалить все ПУСТЫЕ папки без файлов в этом разделе (убрать мусор)"
              style={{ padding: '5px 10px', borderRadius: 980, border: '1px solid #d0d0d5', background: '#fff', color: '#8e8e93', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>🧹</button>
            )}
            <button onClick={() => setDocsTreeExpanded({})} title="Свернуть все папки до верхнего уровня"
              style={{ padding: '5px 10px', borderRadius: 980, border: '1px solid #d0d0d5', background: '#fff', color: '#8e8e93', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>⊟ Свернуть</button>
            <button className={!curDocPath ? 'docs-active-tab' : ''} onClick={() => { setDocFolder(prev => ({ ...prev, [docSection]: 'All' })); setDocPath(prev => ({ ...prev, [docSection]: '' })); setDocsHover(null); setDocsSelected({}); setDocsSelectMode(false); }}
              style={{ padding: '5px 14px', borderRadius: 980, border: !curDocPath ? '2px solid #0071e3' : '1px solid #d0d0d5', background: !curDocPath ? '#0071e3' : '#fff', color: !curDocPath ? '#fff' : '#1d1d1f', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', boxShadow: !curDocPath ? '0 2px 8px rgba(0,113,227,0.35)' : 'none' }}>
              🗂 Все ({allItems.length})
            </button>
          </div>
          {topFoldersAll.map(fn => {
            const on = curDocPath === fn || curDocPath.startsWith(fn + '/');
            const isFolderField = dynFolders.includes(fn);
            const descs = treeDescendantsOf(fn);
            // v69.6: узел развёрнут, если его развернули явно ИЛИ он на пути к открытой папке
            const nodeOpen = (p) => (p in docsTreeExpanded) ? !!docsTreeExpanded[p] : (curDocPath === p || curDocPath.startsWith(p + '/'));
            const open = nodeOpen(fn);
            const visibleDescs = open ? descs.filter(rel => {
              const parts = rel.split('/');
              let anc = fn;
              for (let ai = 0; ai < parts.length - 1; ai++) { anc = anc + '/' + parts[ai]; if (!nodeOpen(anc)) return false; }
              return true;
            }) : [];
            return (
              <div key={fn} style={{ marginBottom: 2 }}>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {descs.length > 0 ? (
                    <button onClick={() => toggleTreeNode(fn)} title={open ? 'Свернуть ветку' : `Развернуть ветку (папок внутри: ${descs.length})`}
                      style={{ width: 18, height: 18, border: 'none', background: 'transparent', color: '#8e8e93', fontSize: 10, cursor: 'pointer', padding: 0, lineHeight: '18px' }}>{open ? '▼' : '▶'}</button>
                  ) : <span style={{ width: 18 }} />}
                  <button className={on ? 'docs-active-tab' : ''} onClick={() => { setDocFolder(prev => ({ ...prev, [docSection]: 'All' })); setDocPath(prev => ({ ...prev, [docSection]: fn })); setDocsHover(null); setDocsSelected({}); setDocsSelectMode(false); }}
                    style={{ padding: '5px 14px', borderRadius: 980, border: on ? '2px solid #0071e3' : '1px solid #d0d0d5', background: on ? '#0071e3' : '#fff', color: on ? '#fff' : '#1d1d1f', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', boxShadow: on ? '0 2px 8px rgba(0,113,227,0.35)' : 'none' }}>
                    📁 {fn} ({treeCountOf(fn)})
                  </button>
                  <button onClick={() => isFolderField ? renameDocsFolder(fn) : renameTreeFolder(fn)} title={`Переименовать папку «${fn}»`}
                    style={{ width: 20, height: 20, borderRadius: '50%', border: '1px solid #d0d0d5', background: '#fff', color: '#1d1d1f', fontSize: 10, cursor: 'pointer', padding: 0, lineHeight: '18px' }}>✎</button>
                  <button onClick={() => isFolderField ? deleteDocsFolder(fn) : deleteTreeFolder(fn)} title={`Удалить папку «${fn}» (файлы НЕ удалятся)`}
                    style={{ width: 20, height: 20, borderRadius: '50%', border: '1px solid #d0d0d5', background: '#fff', color: '#e74c3c', fontSize: 10, cursor: 'pointer', padding: 0, lineHeight: '18px' }}>✕</button>
                </div>
                {visibleDescs.map(rel => {
                  const full = fn + '/' + rel;
                  const parentName = full.split('/').slice(0, -1).join('/');
                  const short = rel.split('/').pop();
                  const depth = rel.split('/').length;
                  const con = curDocPath === full || curDocPath.startsWith(full + '/');
                  const hasKids = descs.some(r2 => r2 !== rel && r2.startsWith(rel + '/'));
                  return (
                    <div key={`tree-${full}`} style={{ display: 'flex', gap: 4, alignItems: 'center', paddingLeft: 14 + Math.min(depth - 1, 4) * 22, marginTop: 3, borderLeft: '2px solid #e3e6ea', marginLeft: 10 }}>
                      {hasKids ? (
                        <button onClick={() => toggleTreeNode(full)} title={nodeOpen(full) ? 'Свернуть ветку' : 'Развернуть ветку'}
                          style={{ width: 14, height: 14, border: 'none', background: 'transparent', color: '#8e8e93', fontSize: 8, cursor: 'pointer', padding: 0, lineHeight: '14px' }}>{nodeOpen(full) ? '▼' : '▶'}</button>
                      ) : <span style={{ width: 14 }} />}
                      <button className={con ? 'docs-active-tab' : ''}
                        onClick={() => { setDocFolder(prev => ({ ...prev, [docSection]: 'All' })); setDocPath(prev => ({ ...prev, [docSection]: full })); setDocsHover(null); setDocsSelected({}); setDocsSelectMode(false); }}
                        title={`Вложенная папка «${full}» — файлов: ${treeCountOf(full)}`}
                        style={{ padding: '3px 12px', borderRadius: 980, border: con ? '2px solid #0071e3' : '1px dashed #b9b9bf', background: con ? '#0071e3' : '#f5f5f7', color: con ? '#fff' : '#3a3a3c', fontWeight: 600, fontSize: 11.5, cursor: 'pointer' }}>
                        ↳ 📁 {short} <span style={{ fontSize: 9, fontWeight: 500, color: con ? '#d4e7ff' : '#8e8e93' }}>вложенная в {parentName}</span> ({treeCountOf(full)})
                      </button>
                      <button onClick={() => renameTreeFolder(full)} title={`Переименовать «${full}»`}
                        style={{ width: 18, height: 18, borderRadius: '50%', border: '1px solid #d0d0d5', background: '#fff', color: '#1d1d1f', fontSize: 9, cursor: 'pointer', padding: 0, lineHeight: '16px' }}>✎</button>
                      <button onClick={() => deleteTreeFolder(full)} title={`Удалить «${full}» (файлы поднимутся к родителю)`}
                        style={{ width: 18, height: 18, borderRadius: '50%', border: '1px solid #d0d0d5', background: '#fff', color: '#e74c3c', fontSize: 9, cursor: 'pointer', padding: 0, lineHeight: '16px' }}>✕</button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      {/* v59: панель сортировки и мультивыбора */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#8e8e93' }}>Сортировка:</span>
        <select value={docsSort.by} onChange={e => setDocsSort(prev => ({ ...prev, by: e.target.value }))}
          style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #d0d0d5', fontSize: 12, background: '#fff' }}>
          <option value="docDate">по дате документа</option>
          <option value="ts">по дате распознавания/загрузки</option>
        </select>
        <button onClick={() => setDocsSort(prev => ({ ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' }))} title="Сменить направление"
          style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid #d0d0d5', background: '#fff', fontSize: 12, cursor: 'pointer' }}>
          {docsSort.dir === 'asc' ? '↑ сначала старые' : '↓ сначала новые'}
        </button>
        <span style={{ flex: 1 }} />
        {!docsSelectMode ? (
          docsReadOnly ? null : (
          <button onClick={() => setDocsSelectMode(true)}
            style={{ padding: '5px 14px', borderRadius: 980, border: '1px solid #d0d0d5', background: '#fff', color: '#1d1d1f', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}>☑ Выбрать</button>
          )
        ) : (
          <React.Fragment>
            <span style={{ fontSize: 12, color: '#1d1d1f', fontWeight: 600 }}>Выбрано: {selectedUrls.length}</span>
            <button onClick={() => setDocsSelected(Object.fromEntries(itemsSorted.map(it => [docMediaOf(it).url, true])))} title="Выделить все файлы на экране"
              style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid #d0d0d5', background: '#fff', fontSize: 12, cursor: 'pointer' }}>☑ Все</button>
            <button onClick={() => setDocsSelected({})} title="Снять выделение"
              style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid #d0d0d5', background: '#fff', fontSize: 12, cursor: 'pointer' }}>☐ Снять</button>
            <select defaultValue="" title="Переместить выбранные файлы в папку" onChange={e => {
              const v = e.target.value;
              e.target.value = '';
              if (v === '__new') {
                const nm = (window.prompt('Имя новой папки:') || '').trim().slice(0, 40);
                if (nm) {
                  setCustomFolders(prev => ({ ...prev, [docSection]: [...new Set([...(prev[docSection] || []), nm])] }));
                  moveSelectedDocs(nm);
                }
              }
              else if (v === '__none') moveSelectedDocs('');
              else if (v === '__newpath') {
                const nm = (window.prompt(`Новая подпапка в дереве${curDocPath ? ` «${curDocPath}»` : ''} (имя):`) || '').trim().slice(0, 60).replace(/^[\/]+|[\/]+$/g, '');
                if (nm) moveSelectedDocsToPath(curDocPath ? curDocPath + '/' + nm : nm);
              }
              else if (v.startsWith('path::')) moveSelectedDocsToPath(v.slice(6));
              else if (v.startsWith('sec::')) {
                const parts = v.split('::');
                const tKey = parts[1];
                if (parts[2] === 'root') moveSelectedDocsToSection(tKey, '', '');
                else if (parts[2] === 'folder') moveSelectedDocsToSection(tKey, parts.slice(3).join('::'), '');
                else if (parts[2] === 'path') moveSelectedDocsToSection(tKey, '', parts.slice(3).join('::'));
              }
              else if (v !== '') moveSelectedDocs(v);
            }} style={{ padding: '5px 14px', borderRadius: 980, border: 'none', background: selectedUrls.length ? '#0071e3' : '#f0f0f2', color: selectedUrls.length ? '#fff' : '#8e8e93', fontWeight: 600, fontSize: 12.5, cursor: selectedUrls.length ? 'pointer' : 'not-allowed' }} disabled={!selectedUrls.length}>
              <option value="" disabled>📁 Переместить в папку…</option>
              {dynFolders.map(fn => <option key={fn} value={fn}>📁 {fn}</option>)}
              <option value="__new">＋ Новая папка…</option>
              <option value="__none">🚫 Без папки</option>
              {allTreePaths.length > 0 && <option value="" disabled>── Дерево папок ──</option>}
              {treePathsAll.map(tp => <option key={tp} value={`path::${tp}`}>🌳 {tp}</option>)}
              <option value="__newpath">🌳＋ Новая подпапка в текущей ветке…</option>
              {otherSections.map(os => (
                <React.Fragment key={os.key}>
                  <option value="" disabled>── {os.title} ──</option>
                  <option value={`sec::${os.key}::root`}>📂 {os.title} — в корень раздела</option>
                  {os.folders.map(fn => <option key={fn} value={`sec::${os.key}::folder::${fn}`}>{os.title} · 📁 {fn}</option>)}
                  {os.tree.map(tp => <option key={tp} value={`sec::${os.key}::path::${tp}`}>{os.title} · 🌳 {tp}</option>)}
                </React.Fragment>
              ))}
            </select>
            <button onClick={shareSelectedDocs} disabled={!selectedUrls.length} title="Публичная ссылка на выбранные файлы"
              style={{ padding: '5px 14px', borderRadius: 980, border: 'none', background: selectedUrls.length ? '#0071e3' : '#f0f0f2', color: selectedUrls.length ? '#fff' : '#8e8e93', fontWeight: 600, fontSize: 12.5, cursor: selectedUrls.length ? 'pointer' : 'not-allowed' }}>🔗 Ссылка</button>
            <button onClick={removeSelectedDocs} disabled={!selectedUrls.length}
              style={{ padding: '5px 14px', borderRadius: 980, border: 'none', background: selectedUrls.length ? '#e74c3c' : '#f0f0f2', color: selectedUrls.length ? '#fff' : '#8e8e93', fontWeight: 600, fontSize: 12.5, cursor: selectedUrls.length ? 'pointer' : 'not-allowed' }}>🗑 Удалить</button>
            <button onClick={() => { setDocsSelectMode(false); setDocsSelected({}); }}
              style={{ padding: '5px 14px', borderRadius: 980, border: '1px solid #d0d0d5', background: '#fff', color: '#1d1d1f', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}>Отмена</button>
            {shareDlg && <ShareDialog dlg={shareDlg} setDlg={setShareDlg} token={token} />}
          </React.Fragment>
        )}
      </div>
      <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e3e6ea', padding: 14 }}>
        {(curDocPath || subFolders.length > 0) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <button onClick={() => setDocPath(prev => ({ ...prev, [docSection]: '' }))} title="В корень"
              style={{ padding: '4px 10px', borderRadius: 980, border: curDocPath ? '1px solid #d0d0d5' : 'none', background: curDocPath ? '#fff' : '#e8e8ed', color: '#1d1d1f', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>🏠</button>
            {curDocPath && curDocPath.split('/').map((seg, si, arr) => (
              <span key={si} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: '#c7c7cc', fontSize: 12 }}>/</span>
                <button onClick={() => setDocPath(prev => ({ ...prev, [docSection]: arr.slice(0, si + 1).join('/') }))}
                  style={{ padding: '4px 10px', borderRadius: 980, border: 'none', background: si === arr.length - 1 ? '#e8e8ed' : 'transparent', color: si === arr.length - 1 ? '#1d1d1f' : '#0071e3', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>{seg}</button>
              </span>
            ))}
            {subFolders.map(fn => (
              <span key={fn} style={{ display: 'inline-flex', alignItems: 'center' }}>
                <button onClick={() => setDocPath(prev => ({ ...prev, [docSection]: curDocPath ? curDocPath + '/' + fn : fn }))}
                  style={{ padding: '5px 12px', borderRadius: 10, border: '1px solid #d0d0d5', background: '#f5f5f7', color: '#1d1d1f', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}>
                  📁 {fn} ({seenSub[fn]})
                </button>
                <button onClick={() => renameDocsSubfolder(fn)} title={`Переименовать папку «${fn}» (все файлы внутри сохранят структуру)`}
                  style={{ marginLeft: 2, width: 20, height: 20, borderRadius: '50%', border: '1px solid #d0d0d5', background: '#fff', color: '#1d1d1f', fontSize: 10, cursor: 'pointer', padding: 0, lineHeight: '18px' }}>✎</button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 18, rowGap: 34, flexWrap: 'wrap', alignItems: 'flex-start', paddingBottom: 12 }}>
          {itemsSorted.map((entry, i) => docThumb(entry, i))}
          {!docsReadOnly && (
          <label title="Добавить файлы любого типа" style={{ width: 72, height: 72, borderRadius: 8, border: '1px dashed #c7c7cc', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: docsBusy ? 'wait' : 'pointer', fontSize: 24, color: '#8e8e93', background: '#f5f5f7' }}>
            {docsBusy ? '⏳' : '📎'}
            <input type="file" accept="*/*" multiple disabled={docsBusy} style={{ display: 'none' }} onChange={(e) => { addDocs(docSection, e.target.files); e.target.value = ''; }} />
          </label>
          )}
          {!docsReadOnly && (
          <label title="Загрузить папку целиком — внутренняя структура сохранится" style={{ width: 72, height: 72, borderRadius: 8, border: '1px dashed #c7c7cc', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: docsBusy ? 'wait' : 'pointer', fontSize: 24, color: '#8e8e93', background: '#f5f5f7' }}>
            {docsBusy ? '⏳' : '📂'}
            <input type="file" multiple disabled={docsBusy} style={{ display: 'none' }} {...{ webkitdirectory: '', directory: '' }} onChange={(e) => { addDocs(docSection, e.target.files); e.target.value = ''; }} />
          </label>
          )}
          {items.length === 0 && subFolders.length === 0 && !docsBusy && <div style={{ fontSize: 13, color: '#8e8e93', alignSelf: 'center' }}>Файлов пока нет — нажмите 📎 (файлы) или 📂 (папку со структурой), чтобы загрузить.</div>}
        </div>
      </div>

      {docsMove && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 410, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '24px 28px', width: 'min(420px, 92vw)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)', textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
              {docsMove.status === 'run' && '📁 Перемещение файлов…'}
              {docsMove.status === 'ok' && '✅ Перемещено!'}
              {docsMove.status === 'err' && '❌ Не переместилось'}
            </div>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 4 }}>Файлов: {docsMove.total}</div>
            <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{docsMove.target}</div>
            {docsMove.status === 'run' && (
              <React.Fragment>
                <div style={{ height: 10, borderRadius: 6, background: '#e8e8ed', overflow: 'hidden', margin: '6px 0 4px' }}>
                  <div className="docs-move-ind" style={{ height: '100%', width: '40%', borderRadius: 6, background: 'linear-gradient(90deg, #34c759, #0071e3)' }} />
                </div>
                <style>{'@keyframes docsMoveSlide{0%{margin-left:-40%}100%{margin-left:100%}}.docs-move-ind{animation:docsMoveSlide 1s ease-in-out infinite alternate}'}</style>
              </React.Fragment>
            )}
            {docsMove.status === 'err' && (
              <React.Fragment>
                <div style={{ fontSize: 12, color: '#e74c3c', marginBottom: 12, whiteSpace: 'pre-wrap' }}>{docsMove.msg}</div>
                <button onClick={() => setDocsMove(null)} style={{ padding: '8px 22px', borderRadius: 980, border: 'none', background: '#0071e3', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Понятно</button>
              </React.Fragment>
            )}
          </div>
        </div>
      )}

      {docsUpload && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '24px 28px', width: 'min(420px, 92vw)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)', textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
              {docsUpload.phase === 'prepare' && '⚙️ Подготовка файлов…'}
              {docsUpload.phase === 'upload' && '📤 Загрузка на сервер…'}
              {docsUpload.phase === 'save' && '💾 Сохранение на сервере…'}
            </div>
            <div style={{ fontSize: 11, color: '#b9b9bf', marginBottom: 2 }}>сборка · v83 ·</div>
            <div style={{ fontSize: 34, fontWeight: 800, color: '#0071e3', margin: '8px 0 2px' }}>{docsUpload.percent}%</div>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 2 }}>
              {`Загружено ${docsUpload.done} из ${docsUpload.total} файлов · осталось ${Math.max(0, docsUpload.total - docsUpload.done)}`}
            </div>
            {docsUpload.batch > 0 && (
              <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 2 }}>{`Партия ${docsUpload.batch} из ~${docsUpload.batches || docsUpload.batch} · порционная загрузка (память сервера не перегружается)`}</div>
            )}
            {docsUpload.currentFile && (
              <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{docsUpload.currentFile}</div>
            )}
            <div style={{ height: 10, borderRadius: 6, background: '#e8e8ed', overflow: 'hidden', margin: '10px 0 16px' }}>
              <div style={{ height: '100%', width: `${docsUpload.percent}%`, borderRadius: 6, background: 'linear-gradient(90deg, #34c759, #0071e3)', transition: 'width 0.25s' }} />
            </div>
            {docsUpload.phase === 'save' ? (
              <div style={{ fontSize: 13, color: '#8e8e93' }}>⏳ Файлы переданы — сервер сохраняет, прерывать уже нельзя…</div>
            ) : (
              <button onClick={() => { docsStopRef.current = true; if (docsXhrRef.current) { try { docsXhrRef.current.abort(); } catch (e) {} } }}
                style={{ padding: '9px 22px', borderRadius: 980, border: 'none', background: '#ff3b30', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                ⏹ Остановить
              </button>
            )}
          </div>
        </div>
      )}

      {docsExcel && (
        <div onClick={() => { if (!docsExcel.loading) setDocsExcel(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 210, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(1100px, 94vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #eee', gap: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📊 {docsExcel.name}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {!docsExcel.loading && docsExcel.url && (
                  <a href={docsExcel.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#0071e3', textDecoration: 'none', whiteSpace: 'nowrap' }}>⬇ Скачать</a>
                )}
                <button onClick={() => !docsExcel.loading && setDocsExcel(null)} style={{ border: 'none', background: '#f0f0f2', borderRadius: '50%', width: 28, height: 28, cursor: docsExcel.loading ? 'not-allowed' : 'pointer', fontSize: 13 }}>✕</button>
              </div>
            </div>
            {docsExcel.loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#8e8e93' }}>⏳ Открываю таблицу…</div>
            ) : (
              <React.Fragment>
                {docsExcel.sheets.length > 1 && (
                  <div style={{ display: 'flex', gap: 6, padding: '8px 14px', borderBottom: '1px solid #eee', flexWrap: 'wrap' }}>
                    {docsExcel.sheets.map((sh, si) => (
                      <button key={si} onClick={() => setDocsExcel(prev => ({ ...prev, idx: si }))}
                        style={{ padding: '4px 12px', borderRadius: 980, border: si === docsExcel.idx ? 'none' : '1px solid #d0d0d5', background: si === docsExcel.idx ? '#0071e3' : '#fff', color: si === docsExcel.idx ? '#fff' : '#1d1d1f', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>{sh.name}</button>
                    ))}
                  </div>
                )}
                <style>{'.xlsx-view table{border-collapse:collapse;font-size:12px}.xlsx-view td,.xlsx-view th{border:1px solid #d8dce1;padding:3px 8px;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}.xlsx-view tr:nth-child(even){background:#fafafc}'}</style>
                <div className="xlsx-view" style={{ overflow: 'auto', padding: 12, flex: 1 }}
                  dangerouslySetInnerHTML={{ __html: docsExcel.sheets[docsExcel.idx].html }} />
              </React.Fragment>
            )}
          </div>
        </div>
      )}

      {docsHover && (
        <div style={{ position: 'fixed', right: 24, top: '50%', transform: 'translateY(-50%)', zIndex: 190, pointerEvents: 'none', background: '#fff', borderRadius: 14, boxShadow: '0 16px 48px rgba(0,0,0,0.35)', padding: 10, width: 'min(520px, 44vw)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#1d1d1f', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{docsHover.name || 'Документ'}</div>
          {docsHover.kind === 'photo' ? (
            <img src={docsHover.url} alt="" style={{ width: '100%', maxHeight: '72vh', objectFit: 'contain', borderRadius: 8, display: 'block' }} />
          ) : docsHover.kind === 'video' ? (
            <video src={`${docsHover.url}#t=0.1`} muted playsInline preload="auto" style={{ width: '100%', maxHeight: '72vh', borderRadius: 8, display: 'block', background: '#000' }} />
          ) : (
            <iframe src={docsHover.url} title="preview" style={{ width: '100%', height: '72vh', border: 'none', borderRadius: 8, background: '#f5f5f7' }} />
          )}
        </div>
      )}

      {docsOcr && (
        <div onClick={() => { if (!docsOcr.loading) setDocsOcr(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 210, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: 'min(1100px, 94vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #eee' }}>
              <div style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📝 Распознавание текста — {docsOcr.name}{docsOcr.saved ? ' · 💾 сохранено в карточке' : ''}</div>
              <button onClick={() => !docsOcr.loading && setDocsOcr(null)} style={{ border: 'none', background: '#f0f0f2', borderRadius: '50%', width: 28, height: 28, cursor: docsOcr.loading ? 'not-allowed' : 'pointer', fontSize: 13 }}>✕</button>
            </div>
            {docsOcr.loading ? (
              <div style={{ padding: 40, textAlign: 'center' }}>
                <div className="spinner" style={{ margin: '0 auto 12px' }}></div>
                <div style={{ fontSize: 14, color: '#555' }}>Распознаём текст (vision) и переводим…</div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>Многостраничный PDF может занять 1–3 минуты</div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 0, minHeight: 0, flex: 1 }}>
                <div style={{ flex: '0 0 46%', borderRight: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa', minHeight: 300, overflow: 'auto', padding: 8 }}>
                  <img src={(docsOcr.pageUrls && docsOcr.pageUrls[docsOcr.idx]) || docsOcr.url} alt="" style={{ maxWidth: '100%', maxHeight: '74vh', borderRadius: 6 }} />
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid #eee', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid #d0d0d5' }}>
                      <button onClick={() => setDocsOcr({ ...docsOcr, tab: 'ru' })} style={{ padding: '5px 12px', fontSize: 12, border: 'none', cursor: 'pointer', background: docsOcr.tab === 'ru' ? '#0071e3' : '#fff', color: docsOcr.tab === 'ru' ? '#fff' : '#333', fontWeight: 600 }}>🇷🇺 Перевод</button>
                      <button onClick={() => setDocsOcr({ ...docsOcr, tab: 'orig' })} style={{ padding: '5px 12px', fontSize: 12, border: 'none', cursor: 'pointer', background: docsOcr.tab === 'orig' ? '#0071e3' : '#fff', color: docsOcr.tab === 'orig' ? '#fff' : '#333', fontWeight: 600 }}>Оригинал</button>
                    </div>
                    {docsOcr.pages.length > 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <button disabled={docsOcr.idx === 0} onClick={() => setDocsOcr({ ...docsOcr, idx: docsOcr.idx - 1 })} style={{ border: '1px solid #d0d0d5', background: '#fff', borderRadius: 6, width: 24, height: 24, cursor: 'pointer' }}>‹</button>
                        <span style={{ color: '#555' }}>Стр. {docsOcr.idx + 1} из {docsOcr.pages.length}</span>
                        <button disabled={docsOcr.idx >= docsOcr.pages.length - 1} onClick={() => setDocsOcr({ ...docsOcr, idx: docsOcr.idx + 1 })} style={{ border: '1px solid #d0d0d5', background: '#fff', borderRadius: 6, width: 24, height: 24, cursor: 'pointer' }}>›</button>
                      </div>
                    )}
                  </div>
                  <pre style={{ flex: 1, overflow: 'auto', margin: 0, padding: '10px 14px', fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', color: '#1d1d1f' }}>
                    {(docsOcr.pages[docsOcr.idx] && (docsOcr.tab === 'ru' ? docsOcr.pages[docsOcr.idx].russian : docsOcr.pages[docsOcr.idx].original)) || '(пусто)'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {docsViewer && (
        <div onClick={() => setDocsViewer(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {docsViewer.kind === 'video' ? (
            docsVErr ? (
              <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 20, maxWidth: 420, textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>🎬</div>
                <div style={{ fontSize: 14, marginBottom: 12 }}>Браузер не смог воспроизвести это видео.</div>
                <a href={docsViewer.url} target="_blank" rel="noreferrer" style={{ color: '#0071e3', fontSize: 14 }}>Открыть/скачать оригинал ↗</a>
              </div>
            ) : (
              <video src={docsViewer.url} controls autoPlay playsInline onError={() => setDocsVErr(true)} onClick={e => e.stopPropagation()} style={{ maxWidth: '92vw', maxHeight: '88vh', borderRadius: 10 }} />
            )
          ) : docsViewer.kind === 'audio' ? (
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 20, maxWidth: 420 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🎵 {docsViewer.name || 'Аудио'}</div>
              <audio src={docsViewer.url} controls autoPlay style={{ width: '100%' }} />
            </div>
          ) : (
            <img src={docsViewer.url} alt="" onClick={(e) => { e.stopPropagation(); setDocsZoom(!docsZoom); }}
              style={docsZoom ? { maxWidth: 'none', maxHeight: 'none', cursor: 'zoom-out' } : { maxWidth: '94vw', maxHeight: '90vh', cursor: 'zoom-in', borderRadius: 6 }} />
          )}
        </div>
      )}
    </div>
  );
}

// ===================== v83: ЧАТ (общий + личные сообщения) =====================
function ChatTab({ user, token }) {
  const myId = (user && user.id) || 'admin';
  const myName = (user && user.name) || myId;
  const [users, setUsers] = useState([]);
  const [chan, setChan] = useState('general');   // 'general' | {dm:'userId'}
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState({});
  const [loadErr, setLoadErr] = useState('');
  const listRef = useRef(null);
  const fileRef = useRef(null);
  const hdr = { Authorization: `Bearer ${token}` };

  const chanKey = chan === 'general' ? 'general' : `dm:${[myId, chan.dm].sort().join(':')}`;

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/api/users/names?token=${token}`).then(r => r.json()).then(j => {
      if (Array.isArray(j)) setUsers(j.filter(u => u.id !== myId));
    }).catch(() => {});
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadUnread = useCallback(() => {
    if (!token) return;
    fetch(`${API_URL}/api/chat/unread`, { headers: hdr }).then(r => r.json()).then(j => {
      if (j && typeof j === 'object' && !j.error) setUnread(j);
    }).catch(() => {});
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const markRead = useCallback((key) => {
    fetch(`${API_URL}/api/chat/read`, { method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: key }) })
      .then(() => loadUnread()).catch(() => {});
  }, [token, loadUnread]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMsgs = useCallback(() => {
    if (!token) return;
    const q = chan === 'general' ? 'channel=general' : `dm=${encodeURIComponent(chan.dm)}`;
    fetch(`${API_URL}/api/chat/messages?${q}`, { headers: hdr }).then(r => r.json()).then(j => {
      if (Array.isArray(j)) { setMsgs(j); setLoadErr(''); markRead(chanKey); }
      else if (j && j.error) setLoadErr(j.error);
    }).catch(() => {});
  }, [token, chan, chanKey, markRead]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadMsgs(); const t = setInterval(loadMsgs, 4000); return () => clearInterval(t); }, [loadMsgs]);
  useEffect(() => { loadUnread(); const t = setInterval(loadUnread, 10000); return () => clearInterval(t); }, [loadUnread]);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [msgs.length, chan]);

  const send = async () => {
    if (sending || (!text.trim() && !file)) return;
    setSending(true);
    try {
      let file_url = null, file_name = null;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        const ur = await fetch(`${API_URL}/api/chat/upload`, { method: 'POST', headers: hdr, body: fd }).then(r => r.json());
        if (ur.error) { alert(ur.error); setSending(false); return; }
        file_url = ur.url; file_name = ur.name;
      }
      const body = { text: text.trim(), file_url, file_name };
      if (chan !== 'general') body.to = chan.dm; else body.channel = 'general';
      const r = await fetch(`${API_URL}/api/chat/messages`, { method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
      if (r.error) { alert(r.error); } else { setText(''); setFile(null); if (fileRef.current) fileRef.current.value = ''; loadMsgs(); }
    } finally { setSending(false); }
  };

  const fmtTime = (iso) => { const d = new Date(iso); const today = new Date().toDateString() === d.toDateString();
    return today ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); };

  const chanLabel = chan === 'general' ? '📢 Общий чат' : `💬 ${(users.find(u => u.id === chan.dm) || {}).name || chan.dm}`;
  const isImg = (n) => /\.(png|jpe?g|gif|webp|heic)$/i.test(n || '');

  return (
    <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 210px)', minHeight: 420 }}>
      {/* Каналы */}
      <div style={{ flex: '0 0 220px', background: '#fff', borderRadius: 14, border: '1px solid #e5e5ea', overflowY: 'auto', padding: 8 }}>
        <div onClick={() => setChan('general')}
          style={{ padding: '9px 10px', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: chan === 'general' ? '#e8f0fe' : 'transparent' }}>
          <span>📢 Общий чат</span>
          {unread.general > 0 && chan !== 'general' && <span style={{ background: '#ff3b30', color: '#fff', borderRadius: 10, fontSize: 11, padding: '1px 7px' }}>{unread.general}</span>}
        </div>
        <div style={{ fontSize: 11, color: '#8e8e93', padding: '8px 10px 4px', fontWeight: 700 }}>ЛИЧНЫЕ СООБЩЕНИЯ</div>
        {users.map(u => {
          const key = `dm:${[myId, u.id].sort().join(':')}`;
          const cnt = unread[key] || 0;
          const active = chan !== 'general' && chan.dm === u.id;
          return (
            <div key={u.id} onClick={() => setChan({ dm: u.id })}
              style={{ padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontSize: 13.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: active ? '#e8f0fe' : 'transparent' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>👤 {u.name || u.id}</span>
              {cnt > 0 && !active && <span style={{ background: '#ff3b30', color: '#fff', borderRadius: 10, fontSize: 11, padding: '1px 7px' }}>{cnt}</span>}
            </div>
          );
        })}
      </div>
      {/* Сообщения */}
      <div style={{ flex: 1, background: '#fff', borderRadius: 14, border: '1px solid #e5e5ea', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0f2', fontWeight: 700, fontSize: 14 }}>{chanLabel}</div>
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, background: '#fafafc' }}>
          {loadErr && <div style={{ color: '#b00', fontSize: 13, background: '#fff2f0', padding: 10, borderRadius: 8 }}>{loadErr}</div>}
          {!loadErr && msgs.length === 0 && <div style={{ color: '#8e8e93', fontSize: 13, textAlign: 'center', marginTop: 30 }}>Сообщений пока нет — напишите первым!</div>}
          {msgs.map(m => {
            const mine = m.from_id === myId;
            return (
              <div key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '72%' }}>
                <div style={{ fontSize: 11, color: '#8e8e93', margin: mine ? '0 4px 2px 0' : '0 0 2px 4px', textAlign: mine ? 'right' : 'left' }}>
                  {!mine && <b style={{ color: '#555' }}>{m.from_name || m.from_id}</b>} {fmtTime(m.created_at)}
                </div>
                <div style={{ padding: '8px 12px', borderRadius: 14, fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  background: mine ? '#0071e3' : '#fff', color: mine ? '#fff' : '#1d1d1f',
                  border: mine ? 'none' : '1px solid #e5e5ea', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                  {m.text}
                  {m.file_url && (
                    <div style={{ marginTop: m.text ? 6 : 0 }}>
                      {isImg(m.file_name)
                        ? <a href={m.file_url} target="_blank" rel="noreferrer"><img src={m.file_url} alt={m.file_name} style={{ maxWidth: 240, maxHeight: 180, borderRadius: 8, display: 'block' }} /></a>
                        : <a href={m.file_url} target="_blank" rel="noreferrer" style={{ color: mine ? '#d6e9ff' : '#0071e3', fontSize: 13 }}>📎 {m.file_name}</a>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {/* Ввод */}
        <div style={{ padding: '10px 12px', borderTop: '1px solid #f0f0f2', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0] || null)} />
          <button onClick={() => fileRef.current && fileRef.current.click()} title="Прикрепить файл"
            style={{ border: 'none', background: '#f0f0f2', borderRadius: 10, padding: '8px 11px', cursor: 'pointer', fontSize: 16 }}>📎</button>
          {file && <span style={{ fontSize: 12, color: '#555', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}
            <span onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }} style={{ cursor: 'pointer', color: '#b00', marginLeft: 4 }}>✕</span></span>}
          <input value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={`Сообщение от ${myName}…`}
            style={{ flex: 1, padding: '9px 13px', borderRadius: 12, border: '1px solid #d0d0d5', fontSize: 14, outline: 'none' }} />
          <button onClick={send} disabled={sending || (!text.trim() && !file)}
            style={{ border: 'none', background: '#0071e3', color: '#fff', borderRadius: 12, padding: '9px 18px', cursor: 'pointer', fontSize: 14, fontWeight: 600, opacity: sending ? 0.6 : 1 }}>
            {sending ? '…' : '➤'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CrmTab({ user, token }) {
  const currentUser = (user && user.name && user.name !== 'admin' && !String(user.name).startsWith('user'))
    ? user.name
    : (user && user.email ? user.email.split('@')[0] : (user && user.role === 'admin' ? 'Admin' : 'User'));

  const [tasks, setTasks] = useState(() => crmLoad(CRM_LS_TASKS));
  const [cps, setCps] = useState(() => crmLoad(CRM_LS_CPS));
  const [contacts, setContacts] = useState(() => crmLoad(CRM_LS_CONTACTS));
  const [section, setSection] = useState('calendar'); // calendar | tasks | cps | contacts
  const [crmUsers, setCrmUsers] = useState([]); // v80: имена всех пользователей для выбора исполнителя
  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/api/users/names?token=${token}`).then(r => r.json()).then(j => {
      if (Array.isArray(j)) setCrmUsers(j.map(u => u.name || u.id));
    }).catch(() => {});
  }, [token]);

  // Календарь
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState(crmTodayIso);

  // Задачи: фильтры и лента событий
  const [taskFilter, setTaskFilter] = useState('active'); // active | open | pending_confirm | overdue | closed | all
  const [taskSearch, setTaskSearch] = useState('');
  const [showFeed, setShowFeed] = useState(false);
  const [expandedTl, setExpandedTl] = useState({});

  // Модалки: задача / контрагент / контакт / действие со статусом
  const [taskModal, setTaskModal] = useState(null);       // null | {} | {id}
  const [taskForm, setTaskForm] = useState({});
  const [cpModal, setCpModal] = useState(null);           // null | {} | {id}
  const [cpForm, setCpForm] = useState({});
  const [contactModal, setContactModal] = useState(null); // null | {} | {id}
  const [contactForm, setContactForm] = useState({});
  const [actionModal, setActionModal] = useState(null);   // null | {type:'done'|'confirm'|'return'|'comment', taskId}
  const [actionNote, setActionNote] = useState('');

  // Поиск в справочниках
  const [cpSearch, setCpSearch] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const [contactCpFilter, setContactCpFilter] = useState('');

  // Серверный режим (v33): данные CRM на бэкенде; при недоступности — локальный fallback
  const [crmLoading, setCrmLoading] = useState(true);
  const [useServer, setUseServer] = useState(false);
  const [crmError, setCrmError] = useState(null);
  const [crmRetry, setCrmRetry] = useState(0); // увеличение = перезагрузить CRM с сервера

  // Карточки-просмотры (v34): открываются по клику на задачу/контрагента/контакт из любого места
  const [viewTaskId, setViewTaskId] = useState(null);
  const [viewCpId, setViewCpId] = useState(null);
  const [viewContactId, setViewContactId] = useState(null);

  // Медиа (v36): photoBusy = `${taskId}_${kind}` | `cp_${id}` пока идёт загрузка; photoViewer — {url, kind: photo|video|audio}
  const [photoBusy, setPhotoBusy] = useState(null);
  const [photoViewer, setPhotoViewer] = useState(null);
  const [photoZoom, setPhotoZoom] = useState(false); // false — уместить в экран, true — натуральный размер
  const [mediaProgress, setMediaProgress] = useState(null); // текст прогресса сжатия видео (v37), null — скрыт
  const [viewerError, setViewerError] = useState(false); // браузер не смог воспроизвести видео (v37.4)

  // ---- Загрузка CRM (v33): с сервера; при недоступности — локальный режим (localStorage) ----
  const crmApi = useCallback(async (path, options) => {
    const res = await fetch(`${API_URL}${path}${path.includes('?') ? '&' : '?'}token=${token}`,
      options ? { ...options, headers: { 'Content-Type': 'application/json' } } : undefined);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    setCrmLoading(true);
    (async () => {
      if (!token) { if (!cancelled) setCrmLoading(false); return; }
      try {
        let data = await crmApi('/api/crm');
        // Одноразовый перенос локальных данных на сервер: если на сервере пусто, а в
        // localStorage есть записи (CRM v32) — заливаем их с пересадкой id (строковые → bigserial)
        let migratedFlag = null;
        try { migratedFlag = localStorage.getItem('crm_migrated_v1'); } catch (e) {}
        if (!(data.counterparties || []).length && !(data.contacts || []).length && !(data.tasks || []).length && !migratedFlag) {
          const locCps = crmLoad(CRM_LS_CPS) || [];
          const locContacts = crmLoad(CRM_LS_CONTACTS) || [];
          const locTasks = crmLoad(CRM_LS_TASKS) || [];
          if (locCps.length || locContacts.length || locTasks.length) {
            const cpIdMap = {}, ctIdMap = {};
            for (const cp of locCps) {
              const r = await crmApi('/api/crm/counterparties', { method: 'POST', body: JSON.stringify({ name: cp.name, type: cp.type, phone: cp.phone, email: cp.email, address: cp.address, comment: cp.comment }) });
              cpIdMap[cp.id] = r.counterparty.id;
            }
            for (const ct of locContacts) {
              const r = await crmApi('/api/crm/contacts', { method: 'POST', body: JSON.stringify({ counterparty_id: cpIdMap[ct.counterpartyId] || null, name: ct.name, position: ct.position, phone: ct.phone, email: ct.email, comment: ct.comment }) });
              ctIdMap[ct.id] = r.contact.id;
            }
            for (const t of locTasks) {
              await crmApi('/api/crm/tasks', { method: 'POST', body: JSON.stringify({ title: t.title, description: t.description, counterparty_id: cpIdMap[t.counterpartyId] || null, contact_id: ctIdMap[t.contactId] || null, assignee: t.assignee, due_date: t.dueDate || null, priority: t.priority }) });
            }
            data = await crmApi('/api/crm');
          }
          try { localStorage.setItem('crm_migrated_v1', '1'); } catch (e) {}
        }
        if (cancelled) return;
        setCps(data.counterparties || []);
        setContacts(data.contacts || []);
        setTasks(data.tasks || []);
        setUseServer(true);
        setCrmError(null);
      } catch (e) {
        if (cancelled) return;
        // fallback: локальный режим, как в v32 (при совсем пустом localStorage — демо-данные)
        const locCps = crmLoad(CRM_LS_CPS), locContacts = crmLoad(CRM_LS_CONTACTS), locTasks = crmLoad(CRM_LS_TASKS);
        if (locCps === null && locContacts === null && locTasks === null) {
          const seed = crmSeed();
          setCps(seed.cps); setContacts(seed.contacts); setTasks(seed.tasks);
        } else {
          setCps(locCps || []); setContacts(locContacts || []); setTasks(locTasks || []);
        }
        setUseServer(false);
        setCrmError('Сервер CRM недоступен — показаны локальные данные этого браузера. ' + e.message);
      }
      if (!cancelled) setCrmLoading(false);
    })();
  }, [token, crmApi, crmRetry]);

  // Автосохранение в localStorage при любом изменении
  useEffect(() => { if (tasks !== null) crmSave(CRM_LS_TASKS, tasks); }, [tasks]);
  useEffect(() => { if (cps !== null) crmSave(CRM_LS_CPS, cps); }, [cps]);
  useEffect(() => { if (contacts !== null) crmSave(CRM_LS_CONTACTS, contacts); }, [contacts]);

  const tasksL = tasks || [], cpsL = cps || [], contactsL = contacts || [];
  const todayIso = crmTodayIso();
  // id с сервера — числа, из <select> — строки: сравниваем как строки, чтобы не терять связи
  const cpById = (id) => (id === '' || id === null || id === undefined) ? null : (cpsL.find(c => String(c.id) === String(id)) || null);
  const contactById = (id) => (id === '' || id === null || id === undefined) ? null : (contactsL.find(c => String(c.id) === String(id)) || null);
  const isOverdue = (t) => t.status !== 'closed' && !!t.dueDate && t.dueDate < todayIso;

  // ---- стили (apple-theme: пилюльные кнопки, мягкие карточки, #0071e3) ----
  const stCard = { background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: '12px 16px' };
  const stPill = (active) => ({ padding: '7px 14px', borderRadius: 999, border: `1px solid ${active ? '#0071e3' : '#d2d2d7'}`, background: active ? '#0071e3' : '#fff', color: active ? '#fff' : '#1d1d1f', fontSize: 13, fontWeight: 600, cursor: 'pointer' });
  const stInput = { padding: '8px 10px', borderRadius: 8, border: '1px solid #c7c7cc', fontSize: 14, width: '100%', boxSizing: 'border-box' };
  const stBtn = { background: '#0071e3', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 999, fontWeight: 600, cursor: 'pointer', fontSize: 13 };
  const stBtnGhost = { background: '#fff', color: '#1d1d1f', border: '1px solid #d2d2d7', padding: '6px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12 };
  const stBadge = (color, bg) => ({ display: 'inline-block', fontSize: 11, fontWeight: 700, color, background: bg, borderRadius: 8, padding: '2px 8px' });
  const stOverlay = { position: 'fixed', inset: 0, zIndex: 2500, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 };
  const stModal = { background: '#fff', borderRadius: 14, padding: '18px 20px', width: '100%', maxWidth: 520, maxHeight: '88vh', overflow: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' };
  const stField = { marginBottom: 10 };
  const stLabel = { display: 'block', fontSize: 12, fontWeight: 600, color: '#6e6e73', marginBottom: 4 };
  const stLink = { color: '#0071e3', cursor: 'pointer', fontWeight: 600 };

  // ---- операции с задачами (каждая пишет событие в таймлайн) ----
  const logEvent = (t, action, note) => [...(t.timeline || []), { ts: Date.now(), actor: currentUser, action, note: note || '' }];

  const openTaskModal = (task, presetDate, presetCpId) => {
    if (task) {
      setTaskModal({ id: task.id });
      setTaskForm({ title: task.title, description: task.description || '', counterpartyId: task.counterpartyId || '', contactId: task.contactId || '', assignee: task.assignee || '', dueDate: task.dueDate || '', priority: task.priority || 'normal' });
    } else {
      setTaskModal({});
      setTaskForm({ title: '', description: '', counterpartyId: presetCpId || '', contactId: '', assignee: '', dueDate: presetDate || todayIso, priority: 'normal' });
    }
  };
  const saveTask = async () => {
    if (!taskForm.title || !taskForm.title.trim()) { alert('Введите название задачи'); return; }
    const data = {
      title: taskForm.title.trim(), description: (taskForm.description || '').trim(),
      counterpartyId: taskForm.counterpartyId || '', contactId: taskForm.contactId || '',
      assignee: (taskForm.assignee || '').trim(), dueDate: taskForm.dueDate || '',
      priority: taskForm.priority || 'normal'
    };
    if (useServer) {
      try {
        const body = JSON.stringify({ title: data.title, description: data.description, counterparty_id: data.counterpartyId || null, contact_id: data.contactId || null, assignee: data.assignee, due_date: data.dueDate || null, priority: data.priority });
        if (taskModal && taskModal.id) {
          const r = await crmApi(`/api/crm/tasks/${taskModal.id}`, { method: 'PUT', body });
          setTasks(prev => (prev || []).map(t => t.id === taskModal.id ? r.task : t));
        } else {
          const r = await crmApi('/api/crm/tasks', { method: 'POST', body });
          setTasks(prev => [r.task, ...(prev || [])]);
        }
        setTaskModal(null);
      } catch (e) { alert('Не сохранилось на сервере: ' + e.message); }
      return;
    }
    if (taskModal && taskModal.id) {
      setTasks(prev => (prev || []).map(t => t.id === taskModal.id ? { ...t, ...data, timeline: logEvent(t, 'edited', '') } : t));
    } else {
      const t = { id: crmUid(), createdAt: Date.now(), createdBy: currentUser, status: 'open', timeline: [], ...data };
      t.timeline = logEvent(t, 'created', data.dueDate ? `Срок: ${crmFmtDate(data.dueDate)}` : '');
      setTasks(prev => [t, ...(prev || [])]);
    }
    setTaskModal(null);
  };
  const removeTask = async (t) => {
    if (!window.confirm(`Удалить задачу «${t.title}»? История исполнения будет удалена.`)) return;
    if (useServer) {
      try { await crmApi(`/api/crm/tasks/${t.id}`, { method: 'DELETE', body: '{}' }); }
      catch (e) { alert('Не удалилось на сервере: ' + e.message); return; }
    }
    setTasks(prev => (prev || []).filter(x => x.id !== t.id));
  };

  // Действия со статусом: done (исполнитель), confirm/return (постановщик), comment (все)
  const openAction = (type, taskId) => { setActionModal({ type, taskId }); setActionNote(''); };
  const submitAction = async () => {
    if (!actionModal) return;
    const { type, taskId } = actionModal;
    const note = actionNote.trim();
    if ((type === 'return' || type === 'comment') && !note) { alert('Напишите комментарий'); return; }
    if (useServer) {
      try {
        const r = await crmApi(`/api/crm/tasks/${taskId}/action`, { method: 'POST', body: JSON.stringify({ action: type, note }) });
        setTasks(prev => (prev || []).map(t => t.id === taskId ? r.task : t));
        setActionModal(null);
      } catch (e) { alert(e.message); }
      return;
    }
    setTasks(prev => (prev || []).map(t => {
      if (t.id !== taskId) return t;
      if (type === 'done')    return { ...t, status: 'pending_confirm', doneAt: Date.now(), timeline: logEvent(t, 'done', note) };
      if (type === 'confirm') return { ...t, status: 'closed', closedAt: Date.now(), timeline: logEvent(t, 'confirmed', note) };
      if (type === 'return')  return { ...t, status: 'open', timeline: logEvent(t, 'returned', note) };
      return { ...t, timeline: logEvent(t, 'comment', note) };
    }));
    setActionModal(null);
  };

  // ---- медиаотчёт задачи (v36): фото/видео/аудио «до» и «после» выполнения ----
  // Сервер: multipart POST /api/crm/tasks/:id/photos?kind=..., фото жмём compressImageFile до ~2 МБ,
  // видео/аудио отправляем как есть (до 100 МБ). Локальный fallback: dataURL прямо в задаче.
  // Запись в photosBefore/photosAfter: объект {url, kind: photo|video|audio, name, ts, actor}
  // (старые записи — просто строка-URL, трактуем как фото).
  const mediaOf = (entry) => (entry && typeof entry === 'object') ? entry : { url: entry, kind: 'photo', name: '' };
  const fileMediaKind = (f) => /^image\//.test(f.type || '') ? 'photo' : /^video\//.test(f.type || '') ? 'video' : /^audio\//.test(f.type || '') ? 'audio' : 'doc';

  // Сжатие видео до ~targetMB (v37): realtime-транскодинг в браузере —
  // кадры через <canvas> → captureStream(30), звук через AudioContext, запись MediaRecorder.
  // Результат: mp4 (Safari/новый Chrome) или webm — что поддержит браузер. Время ≈ длительности видео.
  const compressVideoFile = (file, targetMB, onProgress, maxW, maxH) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true; // на поток через AudioContext не влияет
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    let settled = false;
    let audioCtx = null;
    let watchdog = null;
    const cleanup = () => {
      if (watchdog) clearInterval(watchdog);
      URL.revokeObjectURL(url);
      if (audioCtx) audioCtx.close().catch(() => {});
    };
    const fail = (msg) => { if (settled) return; settled = true; cleanup(); reject(new Error(msg)); };
    video.onerror = () => fail('браузер не может прочитать это видео');
    video.onloadedmetadata = () => {
      const duration = video.duration;
      if (!duration || !isFinite(duration)) return fail('не удалось определить длительность видео');
      // целевой битрейт: ёмкость targetMB на длительность, запас ~8%, звук 96 кбит/с
      const audioBps = 96000;
      let videoBps = Math.floor((targetMB * 8 * 1024 * 1024) / duration * 0.92 - audioBps);
      if (videoBps < 300000) videoBps = 300000; // ниже — нечитаемая каша
      let w = video.videoWidth || 640, h = video.videoHeight || 360;
      const scale = Math.min(1, (maxW || 1280) / w, (maxH || 720) / h); // больше 720p не нужно для отчётов
      w = Math.max(2, Math.round(w * scale / 2) * 2);
      h = Math.max(2, Math.round(h * scale / 2) * 2);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(30);
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const srcNode = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();
        srcNode.connect(dest);
        audioCtx.resume().catch(() => {});
        dest.stream.getAudioTracks().forEach(tr => stream.addTrack(tr));
      } catch (e) { console.warn('видео без звуковой дорожки:', e); }
      const mimeCandidates = ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
      const mimeType = mimeCandidates.find(m => { try { return window.MediaRecorder && MediaRecorder.isTypeSupported(m); } catch (e) { return false; } }) || '';
      let rec;
      try {
        rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: videoBps, audioBitsPerSecond: audioBps });
      } catch (e) { return fail('MediaRecorder недоступен в этом браузере'); }
      const chunks = [];
      let stopped = false;
      let rafId = null;
      let lastProgressAt = Date.now();
      // Финализация — общая для onstop и форс-фолбэка (v37.2: в Safari onstop после stop() часто НЕ приходит)
      const finalize = () => {
        if (settled) return;
        settled = true;
        try { stream.getTracks().forEach(tr => tr.stop()); } catch (e) {}
        cleanup();
        const type = mimeType ? mimeType.split(';')[0].replace(/"/g, '') : 'video/webm';
        const ext = type === 'video/mp4' ? '.mp4' : '.webm';
        const blob = new Blob(chunks, { type });
        if (!blob.size) return reject(new Error('пустой результат кодирования'));
        resolve(new File([blob], file.name.replace(/\.[^.]+$/, ext), { type, lastModified: Date.now() }));
      };
      // Завершение — по ПЕРВОМУ из событий: 'ended', currentTime почти у duration
      // (некоторые .mov глохнут за долю секунды до конца и 'ended' не приходит — v37.1)
      const finish = () => {
        if (stopped) return;
        stopped = true;
        try { video.pause(); } catch (e) {}
        if (rafId) cancelAnimationFrame(rafId);
        try { rec.requestData(); } catch (e) {}
        try { if (rec.state !== 'inactive') rec.stop(); } catch (e) {}
        setTimeout(finalize, 5000); // Safari: если onstop не пришёл за 5 сек — собираем из накопленных кусков
      };
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = () => fail('ошибка кодирования видео');
      rec.onstop = finalize;
      video.ontimeupdate = () => {
        lastProgressAt = Date.now();
        if (onProgress && duration) onProgress(Math.min(99, Math.round(video.currentTime / duration * 100)));
        if (video.currentTime >= duration - 0.25) finish();
      };
      video.onended = finish;
      // Сторожевой таймер: нет прогресса 15 сек — у конца дорисовываем хвост, иначе честная ошибка
      watchdog = setInterval(() => {
        if (settled || stopped) return;
        if (Date.now() - lastProgressAt < 15000) return;
        if (video.currentTime >= duration - 1) finish();
        else fail(`видео остановилось на ${Math.round(video.currentTime / duration * 100)}% — файл повреждён или формат не поддерживается браузером`);
      }, 3000);
      const hasRvfc = typeof video.requestVideoFrameCallback === 'function';
      const drawFrame = () => {
        if (stopped) return;
        ctx.drawImage(video, 0, 0, w, h);
        if (hasRvfc) video.requestVideoFrameCallback(drawFrame);
      };
      video.onplay = () => {
        if (hasRvfc) { video.requestVideoFrameCallback(drawFrame); }
        else {
          const loop = () => { if (stopped) return; ctx.drawImage(video, 0, 0, w, h); rafId = requestAnimationFrame(loop); };
          loop();
        }
      };
      rec.start(1000);
      video.play().catch(() => fail('браузер запретил воспроизведение для сжатия'));
    };
  });
  const mediaNote = (kind, items) => {
    const nP = items.filter(u => u.kind === 'photo').length;
    const nV = items.filter(u => u.kind === 'video').length;
    const nA = items.filter(u => u.kind === 'audio').length;
    const parts = [];
    if (nP) parts.push(`фото +${nP}`);
    if (nV) parts.push(`видео +${nV}`);
    if (nA) parts.push(`аудио +${nA}`);
    const nD = items.filter(u => u.kind === 'doc').length;
    if (nD) parts.push(`документы +${nD}`);
    return `Медиа «${kind === 'after' ? 'после' : 'до'}»: ${parts.join(', ')}`;
  };
  const addTaskPhotos = async (taskId, kind, fileList) => {
    let files = Array.from(fileList || []).filter(f => /^(image|video|audio|text)\//.test(f.type || '') || f.type === 'application/pdf' || /\.(pdf|txt|md|csv)$/i.test(f.name || ''));
    const tooBig = files.filter(f => f.size > 500 * 1024 * 1024 && fileMediaKind(f) !== 'video');
    if (tooBig.length) alert(`Слишком большие файлы (максимум 500 МБ) — пропущены:\n${tooBig.map(f => `${f.name} — ${(f.size / 1024 / 1024).toFixed(0)} МБ`).join('\n')}`);
    files = files.filter(f => !(f.size > 500 * 1024 * 1024 && fileMediaKind(f) !== 'video'));
    if (!files.length) { alert('Выберите фото, видео, аудио, текст или PDF'); return; }
    setPhotoBusy(`${taskId}_${kind}`);
    try {
      const prepared = [];
      for (const f of files) {
        const mk = fileMediaKind(f);
        if (mk === 'photo') { prepared.push(await compressImageFile(f)); continue; }
        if (mk === 'video' && f.size > 48 * 1024 * 1024) {
          // До 3 проходов (v37.3): Safari может игнорировать битрейт MediaRecorder → результат > 50 МБ;
          // тогда жмём повторно с меньшим разрешением/битрейтом, пока не влезет в лимит хранилища
          const attempts = [
            { mb: 45, maxW: 1280, maxH: 720 },
            { mb: 38, maxW: 960, maxH: 540 },
            { mb: 28, maxW: 640, maxH: 360 }
          ];
          let best = null;
          for (let ai = 0; ai < attempts.length; ai++) {
            const att = attempts[ai];
            try {
              const cv = await compressVideoFile(f, att.mb, (pct) => setMediaProgress(`🎬 Сжатие видео${ai ? ` (проход ${ai + 1}/3)` : ''} до ~50 МБ: ${pct}%`), att.maxW, att.maxH);
              if (!best || cv.size < best.size) best = cv;
              if (cv.size <= 47 * 1024 * 1024) break;
            } catch (e) {
              console.warn('Сжатие видео не удалось:', e && e.message);
              break;
            }
          }
          setMediaProgress(null);
          const chosen = (best && best.size < f.size) ? best : f;
          if (chosen.size > 50 * 1024 * 1024) {
            if (useServer) {
              setMediaProgress(`🎬 Сжатие на сервере (ffmpeg) «${f.name}» — это займёт некоторое время…`);
              try {
                const fdV = new FormData();
                fdV.append('photos', f);
                const resV = await fetch(`${API_URL}/api/crm/tasks/${taskId}/photos?kind=${kind}&compress=1&token=${token}`, { method: 'POST', body: fdV });
                const rawV = await resV.text().catch(() => '');
                let dataV = {};
                try { dataV = JSON.parse(rawV); } catch (e) { dataV = {}; }
                if (resV.ok && dataV.task) {
                  setTasks(prev => (prev || []).map(t => String(t.id) === String(taskId) ? dataV.task : t));
                  setMediaProgress(null);
                  continue;
                }
                throw new Error(dataV.error || (rawV && rawV.length < 300 ? rawV : `HTTP ${resV.status}`));
              } catch (ev) {
                setMediaProgress(null);
                alert(`Видео «${f.name}» (${(f.size / 1024 / 1024).toFixed(0)} МБ) не удалось сжать даже на сервере: ${ev && ev.message ? ev.message : ev}. Файл пропущен: сократите ролик или понизьте качество исходника.`);
                continue;
              }
            }
            alert(`Видео «${f.name}» даже после сжатия весит ${(chosen.size / 1024 / 1024).toFixed(0)} МБ — больше лимита хранилища (~50 МБ). Файл пропущен: сократите ролик или понизьте качество исходника.`);
            continue;
          }
          prepared.push(chosen);
          continue;
        }
        prepared.push(f);
      }
      if (useServer) {
        const fd = new FormData();
        prepared.forEach(f => fd.append('photos', f));
        const res = await fetch(`${API_URL}/api/crm/tasks/${taskId}/photos?kind=${kind}&token=${token}`, { method: 'POST', body: fd });
        const rawText = await res.text().catch(() => '');
        let data = {};
        try { data = JSON.parse(rawText); } catch (e) { data = {}; }
        if (!res.ok) throw new Error(data.error || (rawText && rawText.length < 300 ? rawText : `HTTP ${res.status}`));
        setTasks(prev => (prev || []).map(t => String(t.id) === String(taskId) ? data.task : t));
      } else {
        const items = await Promise.all(prepared.map(f => new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve({ url: r.result, kind: fileMediaKind(f), name: f.name || '', ts: Date.now(), actor: currentUser });
          r.onerror = () => reject(new Error('read error'));
          r.readAsDataURL(f);
        })));
        setTasks(prev => (prev || []).map(t => {
          if (String(t.id) !== String(taskId)) return t;
          const field = kind === 'after' ? 'photosAfter' : 'photosBefore';
          return { ...t, [field]: [...(t[field] || []), ...items], timeline: logEvent(t, 'photo', mediaNote(kind, items)) };
        }));
      }
    } catch (e) {
      alert('Не загрузился файл: ' + e.message);
    } finally {
      setPhotoBusy(null);
    }
  };
  const removeTaskPhoto = async (taskId, kind, url) => {
    if (!window.confirm('Удалить этот файл из отчёта?')) return;
    if (useServer) {
      try {
        const r = await crmApi(`/api/crm/tasks/${taskId}/photos`, { method: 'DELETE', body: JSON.stringify({ kind, url }) });
        setTasks(prev => (prev || []).map(t => String(t.id) === String(taskId) ? r.task : t));
      } catch (e) { alert('Не удалилось на сервере: ' + e.message); }
      return;
    }
    setTasks(prev => (prev || []).map(t => {
      if (String(t.id) !== String(taskId)) return t;
      const field = kind === 'after' ? 'photosAfter' : 'photosBefore';
      return { ...t, [field]: (t[field] || []).filter(u => mediaOf(u).url !== url), timeline: logEvent(t, 'photo_del', `Медиа «${kind === 'after' ? 'после' : 'до'}»`) };
    }));
  };

  // Миниатюра медиа (v36): фото — img (клик → просмотр с зумом), видео — кадр с ▶, аудио — плитка 🎵
  const renderMediaThumb = (entry, key, onDelete) => {
    const m = mediaOf(entry);
    return (
      <span key={key} style={{ position: 'relative', display: 'inline-block' }}>
        {m.kind === 'video' ? (
          <span onClick={() => { setPhotoViewer({ url: m.url, kind: 'video', name: m.name || '' }); setViewerError(false); }} title={m.name || 'Видео — открыть'} style={{ cursor: 'pointer', display: 'inline-block' }}>
            <video src={`${m.url}#t=0.1`} muted playsInline preload="auto" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #e0e0e0', display: 'block', pointerEvents: 'none', background: '#1d1d1f' }} />
            <span style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 22, textShadow: '0 1px 4px rgba(0,0,0,0.8)', pointerEvents: 'none' }}>▶</span>
          </span>
        ) : m.kind === 'audio' ? (
          <span onClick={() => setPhotoViewer({ url: m.url, kind: 'audio', name: m.name || '' })} title={m.name || 'Аудио — прослушать'} style={{ width: 64, height: 64, borderRadius: 8, background: '#f5f5f7', border: '1px solid #e0e0e0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 24 }}>🎵</span>
        ) : m.kind === 'doc' ? (
          <a href={m.url} target="_blank" rel="noreferrer" title={m.name || 'Документ — открыть в новой вкладке'} style={{ width: 64, height: 64, borderRadius: 8, background: '#f5f5f7', border: '1px solid #e0e0e0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 24, textDecoration: 'none' }}>{/\.pdf(\?|$)/i.test(m.name || m.url || '') ? '📄' : '📝'}</a>
        ) : (
          <img src={m.url} alt="" onClick={() => { setPhotoViewer({ url: m.url, kind: 'photo' }); setPhotoZoom(false); }} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, cursor: 'zoom-in', border: '1px solid #e0e0e0' }} />
        )}
        {onDelete && (
          <button onClick={onDelete} title="Удалить файл" style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#e74c3c', color: '#fff', fontSize: 10, cursor: 'pointer', lineHeight: '18px', padding: 0, zIndex: 1 }}>✕</button>
        )}
      </span>
    );
  };

  // Блок медиаотчёта задачи: две секции «до»/«после», миниатюры + добавление/удаление.
  // Редактировать могут постановщик и исполнитель, пока задача не закрыта (как на сервере).
  const renderPhotoReport = (t) => {
    const canEdit = t.status !== 'closed' && (t.createdBy === currentUser || !t.assignee || t.assignee === currentUser);
    const block = (kind, title, hint) => {
      const photos = kind === 'after' ? (t.photosAfter || []) : (t.photosBefore || []);
      const busy = photoBusy === `${t.id}_${kind}`;
      return (
        <div style={{ flex: '1 1 220px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6e6e73', marginBottom: 4 }}>{title} ({photos.length})</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {photos.map((entry, i) => renderMediaThumb(entry, i, canEdit ? () => removeTaskPhoto(t.id, kind, mediaOf(entry).url) : null))}
            {canEdit && (
              <label title={hint} style={{ width: 64, height: 64, borderRadius: 8, border: '1px dashed #c7c7cc', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: busy ? 'wait' : 'pointer', fontSize: 20, color: '#8e8e93', background: '#f5f5f7' }}>
                {busy ? '⏳' : '📷'}
                <input type="file" accept="image/*,video/*,audio/*,application/pdf,text/*,.pdf,.txt,.md,.csv" multiple disabled={busy} style={{ display: 'none' }} onChange={(e) => { addTaskPhotos(t.id, kind, e.target.files); e.target.value = ''; }} />
              </label>
            )}
          </div>
        </div>
      );
    };
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#6e6e73', marginBottom: 6 }}>📷 Фотоотчёт (фото · видео · аудио)</div>
        <div style={{ fontSize: 11, color: '#8e8e93', marginBottom: 6 }}>Видео больше ~50 МБ сжимаются автоматически (время ≈ длительности видео; если не влезло в 50 МБ — повторные проходы сильнее).</div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {block('before', '🕐 До выполнения', 'Добавить фото/видео/аудио «до»')}
          {block('after', '✅ После выполнения', 'Добавить фото/видео/аудио «после»')}
        </div>
      </div>
    );
  };

  // ---- файлы контрагента (v36): фото/видео/аудио, attachments в crm_counterparties (миграция v23) ----
  const addCpFiles = async (cpId, fileList) => {
    let files = Array.from(fileList || []).filter(f => /^(image|video|audio|text)\//.test(f.type || '') || f.type === 'application/pdf' || /\.(pdf|txt|md|csv)$/i.test(f.name || ''));
    const tooBig = files.filter(f => f.size > 500 * 1024 * 1024 && fileMediaKind(f) !== 'video');
    if (tooBig.length) alert(`Слишком большие файлы (максимум 500 МБ) — пропущены:\n${tooBig.map(f => `${f.name} — ${(f.size / 1024 / 1024).toFixed(0)} МБ`).join('\n')}`);
    files = files.filter(f => !(f.size > 500 * 1024 * 1024 && fileMediaKind(f) !== 'video'));
    if (!files.length) { alert('Выберите фото, видео, аудио, текст или PDF'); return; }
    setPhotoBusy(`cp_${cpId}`);
    try {
      const prepared = [];
      for (const f of files) {
        const mk = fileMediaKind(f);
        if (mk === 'photo') { prepared.push(await compressImageFile(f)); continue; }
        if (mk === 'video' && f.size > 48 * 1024 * 1024) {
          // До 3 проходов (v37.3): Safari может игнорировать битрейт MediaRecorder → результат > 50 МБ;
          // тогда жмём повторно с меньшим разрешением/битрейтом, пока не влезет в лимит хранилища
          const attempts = [
            { mb: 45, maxW: 1280, maxH: 720 },
            { mb: 38, maxW: 960, maxH: 540 },
            { mb: 28, maxW: 640, maxH: 360 }
          ];
          let best = null;
          for (let ai = 0; ai < attempts.length; ai++) {
            const att = attempts[ai];
            try {
              const cv = await compressVideoFile(f, att.mb, (pct) => setMediaProgress(`🎬 Сжатие видео${ai ? ` (проход ${ai + 1}/3)` : ''} до ~50 МБ: ${pct}%`), att.maxW, att.maxH);
              if (!best || cv.size < best.size) best = cv;
              if (cv.size <= 47 * 1024 * 1024) break;
            } catch (e) {
              console.warn('Сжатие видео не удалось:', e && e.message);
              break;
            }
          }
          setMediaProgress(null);
          const chosen = (best && best.size < f.size) ? best : f;
          if (chosen.size > 50 * 1024 * 1024) {
            if (useServer) {
              setMediaProgress(`🎬 Сжатие на сервере (ffmpeg) «${f.name}» — это займёт некоторое время…`);
              try {
                const fdV = new FormData();
                fdV.append('files', f);
                const resV = await fetch(`${API_URL}/api/crm/counterparties/${cpId}/files?compress=1&token=${token}`, { method: 'POST', body: fdV });
                const rawV = await resV.text().catch(() => '');
                let dataV = {};
                try { dataV = JSON.parse(rawV); } catch (e) { dataV = {}; }
                if (resV.ok && dataV.counterparty) {
                  setCps(prev => (prev || []).map(c => String(c.id) === String(cpId) ? dataV.counterparty : c));
                  setMediaProgress(null);
                  continue;
                }
                throw new Error(dataV.error || (rawV && rawV.length < 300 ? rawV : `HTTP ${resV.status}`));
              } catch (ev) {
                setMediaProgress(null);
                alert(`Видео «${f.name}» (${(f.size / 1024 / 1024).toFixed(0)} МБ) не удалось сжать даже на сервере: ${ev && ev.message ? ev.message : ev}. Файл пропущен: сократите ролик или понизьте качество исходника.`);
                continue;
              }
            }
            alert(`Видео «${f.name}» даже после сжатия весит ${(chosen.size / 1024 / 1024).toFixed(0)} МБ — больше лимита хранилища (~50 МБ). Файл пропущен: сократите ролик или понизьте качество исходника.`);
            continue;
          }
          prepared.push(chosen);
          continue;
        }
        prepared.push(f);
      }
      if (useServer) {
        const fd = new FormData();
        prepared.forEach(f => fd.append('files', f));
        const res = await fetch(`${API_URL}/api/crm/counterparties/${cpId}/files?token=${token}`, { method: 'POST', body: fd });
        const rawText = await res.text().catch(() => '');
        let data = {};
        try { data = JSON.parse(rawText); } catch (e) { data = {}; }
        if (!res.ok) throw new Error(data.error || (rawText && rawText.length < 300 ? rawText : `HTTP ${res.status}`));
        setCps(prev => (prev || []).map(c => String(c.id) === String(cpId) ? data.counterparty : c));
      } else {
        const items = await Promise.all(prepared.map(f => new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve({ url: r.result, kind: fileMediaKind(f), name: f.name || '', ts: Date.now(), actor: currentUser });
          r.onerror = () => reject(new Error('read error'));
          r.readAsDataURL(f);
        })));
        setCps(prev => (prev || []).map(c => String(c.id) === String(cpId) ? { ...c, attachments: [...(c.attachments || []), ...items] } : c));
      }
    } catch (e) {
      alert('Не загрузился файл: ' + e.message);
    } finally {
      setPhotoBusy(null);
    }
  };
  const removeCpFile = async (cpId, url) => {
    if (!window.confirm('Удалить этот файл?')) return;
    if (useServer) {
      try {
        const r = await crmApi(`/api/crm/counterparties/${cpId}/files`, { method: 'DELETE', body: JSON.stringify({ url }) });
        setCps(prev => (prev || []).map(c => String(c.id) === String(cpId) ? r.counterparty : c));
      } catch (e) { alert('Не удалилось на сервере: ' + e.message); }
      return;
    }
    setCps(prev => (prev || []).map(c => String(c.id) === String(cpId) ? { ...c, attachments: (c.attachments || []).filter(u => mediaOf(u).url !== url) } : c));
  };

  // Блок «📎 Файлы» в карточке контрагента: сетка миниатюр + добавление (любой участник команды)
  const renderCpAttachments = (cp) => {
    const items = cp.attachments || [];
    const busy = photoBusy === `cp_${cp.id}`;
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#6e6e73', marginBottom: 6 }}>📎 Файлы — фото · видео · аудио · текст · PDF ({items.length})</div>
        <div style={{ fontSize: 11, color: '#8e8e93', marginBottom: 6 }}>Видео больше ~50 МБ сжимаются автоматически (время ≈ длительности видео; если не влезло в 50 МБ — повторные проходы сильнее).</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {items.map((entry, i) => renderMediaThumb(entry, i, () => removeCpFile(cp.id, mediaOf(entry).url)))}
          <label title="Добавить фото, видео, аудио, текст или PDF" style={{ width: 64, height: 64, borderRadius: 8, border: '1px dashed #c7c7cc', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: busy ? 'wait' : 'pointer', fontSize: 20, color: '#8e8e93', background: '#f5f5f7' }}>
            {busy ? '⏳' : '📎'}
            <input type="file" accept="image/*,video/*,audio/*,application/pdf,text/*,.pdf,.txt,.md,.csv" multiple disabled={busy} style={{ display: 'none' }} onChange={(e) => { addCpFiles(cp.id, e.target.files); e.target.value = ''; }} />
          </label>
        </div>
      </div>
    );
  };

  // ---- файлы контакта (v38): attachments в crm_contacts (миграция v24) ----
  const addContactFiles = async (ctId, fileList) => {
    let files = Array.from(fileList || []).filter(f => /^(image|video|audio|text)\//.test(f.type || '') || f.type === 'application/pdf' || /\.(pdf|txt|md|csv)$/i.test(f.name || ''));
    const tooBig = files.filter(f => f.size > 500 * 1024 * 1024 && fileMediaKind(f) !== 'video');
    if (tooBig.length) alert(`Слишком большие файлы (максимум 500 МБ) — пропущены:\n${tooBig.map(f => `${f.name} — ${(f.size / 1024 / 1024).toFixed(0)} МБ`).join('\n')}`);
    files = files.filter(f => !(f.size > 500 * 1024 * 1024 && fileMediaKind(f) !== 'video'));
    if (!files.length) { alert('Выберите фото, видео, аудио, текст или PDF'); return; }
    setPhotoBusy(`ct_${ctId}`);
    try {
      const prepared = [];
      for (const f of files) {
        const mk = fileMediaKind(f);
        if (mk === 'photo') { prepared.push(await compressImageFile(f)); continue; }
        if (mk === 'video' && f.size > 48 * 1024 * 1024) {
          // До 3 проходов (v37.3): Safari может игнорировать битрейт MediaRecorder → результат > 50 МБ;
          // тогда жмём повторно с меньшим разрешением/битрейтом, пока не влезет в лимит хранилища
          const attempts = [
            { mb: 45, maxW: 1280, maxH: 720 },
            { mb: 38, maxW: 960, maxH: 540 },
            { mb: 28, maxW: 640, maxH: 360 }
          ];
          let best = null;
          for (let ai = 0; ai < attempts.length; ai++) {
            const att = attempts[ai];
            try {
              const cv = await compressVideoFile(f, att.mb, (pct) => setMediaProgress(`🎬 Сжатие видео${ai ? ` (проход ${ai + 1}/3)` : ''} до ~50 МБ: ${pct}%`), att.maxW, att.maxH);
              if (!best || cv.size < best.size) best = cv;
              if (cv.size <= 47 * 1024 * 1024) break;
            } catch (e) {
              console.warn('Сжатие видео не удалось:', e && e.message);
              break;
            }
          }
          setMediaProgress(null);
          const chosen = (best && best.size < f.size) ? best : f;
          if (chosen.size > 50 * 1024 * 1024) {
            if (useServer) {
              setMediaProgress(`🎬 Сжатие на сервере (ffmpeg) «${f.name}» — это займёт некоторое время…`);
              try {
                const fdV = new FormData();
                fdV.append('files', f);
                const resV = await fetch(`${API_URL}/api/crm/contacts/${ctId}/files?compress=1&token=${token}`, { method: 'POST', body: fdV });
                const rawV = await resV.text().catch(() => '');
                let dataV = {};
                try { dataV = JSON.parse(rawV); } catch (e) { dataV = {}; }
                if (resV.ok && dataV.contact) {
                  setContacts(prev => (prev || []).map(c => String(c.id) === String(ctId) ? dataV.contact : c));
                  setMediaProgress(null);
                  continue;
                }
                throw new Error(dataV.error || (rawV && rawV.length < 300 ? rawV : `HTTP ${resV.status}`));
              } catch (ev) {
                setMediaProgress(null);
                alert(`Видео «${f.name}» (${(f.size / 1024 / 1024).toFixed(0)} МБ) не удалось сжать даже на сервере: ${ev && ev.message ? ev.message : ev}. Файл пропущен: сократите ролик или понизьте качество исходника.`);
                continue;
              }
            }
            alert(`Видео «${f.name}» даже после сжатия весит ${(chosen.size / 1024 / 1024).toFixed(0)} МБ — больше лимита хранилища (~50 МБ). Файл пропущен: сократите ролик или понизьте качество исходника.`);
            continue;
          }
          prepared.push(chosen);
          continue;
        }
        prepared.push(f);
      }
      if (useServer) {
        const fd = new FormData();
        prepared.forEach(f => fd.append('files', f));
        const res = await fetch(`${API_URL}/api/crm/contacts/${ctId}/files?token=${token}`, { method: 'POST', body: fd });
        const rawText = await res.text().catch(() => '');
        let data = {};
        try { data = JSON.parse(rawText); } catch (e) { data = {}; }
        if (!res.ok) throw new Error(data.error || (rawText && rawText.length < 300 ? rawText : `HTTP ${res.status}`));
        setContacts(prev => (prev || []).map(c => String(c.id) === String(ctId) ? data.contact : c));
      } else {
        const items = await Promise.all(prepared.map(f => new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve({ url: r.result, kind: fileMediaKind(f), name: f.name || '', ts: Date.now(), actor: currentUser });
          r.onerror = () => reject(new Error('read error'));
          r.readAsDataURL(f);
        })));
        setContacts(prev => (prev || []).map(c => String(c.id) === String(ctId) ? { ...c, attachments: [...(c.attachments || []), ...items] } : c));
      }
    } catch (e) {
      alert('Не загрузился файл: ' + e.message);
    } finally {
      setPhotoBusy(null);
    }
  };
  const removeContactFile = async (ctId, url) => {
    if (!window.confirm('Удалить этот файл?')) return;
    if (useServer) {
      try {
        const r = await crmApi(`/api/crm/contacts/${ctId}/files`, { method: 'DELETE', body: JSON.stringify({ url }) });
        setContacts(prev => (prev || []).map(c => String(c.id) === String(ctId) ? r.contact : c));
      } catch (e) { alert('Не удалилось на сервере: ' + e.message); }
      return;
    }
    setContacts(prev => (prev || []).map(c => String(c.id) === String(ctId) ? { ...c, attachments: (c.attachments || []).filter(u => mediaOf(u).url !== url) } : c));
  };
  // Блок «📎 Файлы» в карточке контакта (v38): фото/видео/аудио/текст/PDF, attachments в crm_contacts (миграция v24)
  const renderContactAttachments = (ct) => {
    const items = ct.attachments || [];
    const busy = photoBusy === `ct_${ct.id}`;
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#6e6e73', marginBottom: 6 }}>📎 Файлы — фото · видео · аудио · текст · PDF ({items.length})</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {items.map((entry, i) => renderMediaThumb(entry, i, () => removeContactFile(ct.id, mediaOf(entry).url)))}
          <label title="Добавить фото, видео, аудио, текст или PDF" style={{ width: 64, height: 64, borderRadius: 8, border: '1px dashed #c7c7cc', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: busy ? 'wait' : 'pointer', fontSize: 20, color: '#8e8e93', background: '#f5f5f7' }}>
            {busy ? '⏳' : '📎'}
            <input type="file" accept="image/*,video/*,audio/*,application/pdf,text/*,.pdf,.txt,.md,.csv" multiple disabled={busy} style={{ display: 'none' }} onChange={(e) => { addContactFiles(ct.id, e.target.files); e.target.value = ''; }} />
          </label>
        </div>
      </div>
    );
  };

  // ---- контрагенты ----
  const openCpModal = (cp) => {
    setCpModal(cp ? { id: cp.id } : {});
    setCpForm(cp
      ? { name: cp.name, type: cp.type || 'client', phone: cp.phone || '', email: cp.email || '', address: cp.address || '', comment: cp.comment || '' }
      : { name: '', type: 'client', phone: '', email: '', address: '', comment: '' });
  };
  const saveCp = async () => {
    if (!cpForm.name || !cpForm.name.trim()) { alert('Введите название контрагента'); return; }
    const data = { ...cpForm, name: cpForm.name.trim() };
    if (useServer) {
      try {
        if (cpModal && cpModal.id) {
          const r = await crmApi(`/api/crm/counterparties/${cpModal.id}`, { method: 'PUT', body: JSON.stringify(data) });
          setCps(prev => (prev || []).map(c => c.id === cpModal.id ? r.counterparty : c));
        } else {
          const r = await crmApi('/api/crm/counterparties', { method: 'POST', body: JSON.stringify(data) });
          setCps(prev => [r.counterparty, ...(prev || [])]);
        }
        setCpModal(null);
      } catch (e) { alert('Не сохранилось на сервере: ' + e.message); }
      return;
    }
    if (cpModal && cpModal.id) setCps(prev => (prev || []).map(c => c.id === cpModal.id ? { ...c, ...data } : c));
    else setCps(prev => [{ id: crmUid(), createdAt: Date.now(), ...data }, ...(prev || [])]);
    setCpModal(null);
  };
  const removeCp = async (cp) => {
    const nC = contactsL.filter(c => c.counterpartyId === cp.id).length;
    const nT = tasksL.filter(t => t.counterpartyId === cp.id).length;
    if (!window.confirm(`Удалить контрагента «${cp.name}»?` +
        (nC ? `\n${nC} контакт(ов) останутся без привязки.` : '') +
        (nT ? `\n${nT} задач(и) потеряют привязку.` : ''))) return;
    if (useServer) {
      try { await crmApi(`/api/crm/counterparties/${cp.id}`, { method: 'DELETE', body: '{}' }); }
      catch (e) { alert('Не удалилось на сервере: ' + e.message); return; }
    }
    setCps(prev => (prev || []).filter(c => c.id !== cp.id));
    setContacts(prev => (prev || []).map(c => c.counterpartyId === cp.id ? { ...c, counterpartyId: '' } : c));
    setTasks(prev => (prev || []).map(t => t.counterpartyId === cp.id ? { ...t, counterpartyId: '' } : t));
  };

  // ---- контакты ----
  const openContactModal = (ct, presetCpId) => {
    setContactModal(ct ? { id: ct.id } : {});
    setContactForm(ct
      ? { name: ct.name, counterpartyId: ct.counterpartyId || '', position: ct.position || '', phone: ct.phone || '', email: ct.email || '', comment: ct.comment || '' }
      : { name: '', counterpartyId: presetCpId || '', position: '', phone: '', email: '', comment: '' });
  };
  const saveContact = async () => {
    if (!contactForm.name || !contactForm.name.trim()) { alert('Введите имя контакта'); return; }
    const data = { ...contactForm, name: contactForm.name.trim() };
    if (useServer) {
      try {
        const body = JSON.stringify({ counterparty_id: data.counterpartyId || null, name: data.name, position: data.position, phone: data.phone, email: data.email, comment: data.comment });
        if (contactModal && contactModal.id) {
          const r = await crmApi(`/api/crm/contacts/${contactModal.id}`, { method: 'PUT', body });
          setContacts(prev => (prev || []).map(c => c.id === contactModal.id ? r.contact : c));
        } else {
          const r = await crmApi('/api/crm/contacts', { method: 'POST', body });
          setContacts(prev => [r.contact, ...(prev || [])]);
        }
        setContactModal(null);
      } catch (e) { alert('Не сохранилось на сервере: ' + e.message); }
      return;
    }
    if (contactModal && contactModal.id) setContacts(prev => (prev || []).map(c => c.id === contactModal.id ? { ...c, ...data } : c));
    else setContacts(prev => [{ id: crmUid(), createdAt: Date.now(), ...data }, ...(prev || [])]);
    setContactModal(null);
  };
  const removeContact = async (ct) => {
    if (!window.confirm(`Удалить контакт «${ct.name}»?`)) return;
    if (useServer) {
      try { await crmApi(`/api/crm/contacts/${ct.id}`, { method: 'DELETE', body: '{}' }); }
      catch (e) { alert('Не удалилось на сервере: ' + e.message); return; }
    }
    setContacts(prev => (prev || []).filter(c => c.id !== ct.id));
    setTasks(prev => (prev || []).map(t => t.contactId === ct.id ? { ...t, contactId: '' } : t));
  };

  // ---- производные данные ----
  const knownAssignees = [...new Set(tasksL.flatMap(t => [t.assignee, t.createdBy]).concat([currentUser]).concat(crmUsers).filter(n => n && n !== 'CRM'))]; // v80: + все пользователи системы
  const cntOpen = tasksL.filter(t => t.status === 'open').length;
  const cntPending = tasksL.filter(t => t.status === 'pending_confirm').length;
  const cntOverdue = tasksL.filter(isOverdue).length;
  const cntClosedMonth = tasksL.filter(t => {
    if (t.status !== 'closed' || !t.closedAt) return false;
    const d = new Date(t.closedAt), n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
  }).length;

  const filteredTasks = tasksL.filter(t => {
    if (taskFilter === 'active' && t.status === 'closed') return false;
    if (taskFilter === 'open' && t.status !== 'open') return false;
    if (taskFilter === 'pending_confirm' && t.status !== 'pending_confirm') return false;
    if (taskFilter === 'closed' && t.status !== 'closed') return false;
    if (taskFilter === 'overdue' && !isOverdue(t)) return false;
    if (taskSearch) {
      const hay = [t.title, t.description, t.assignee, t.createdBy, (cpById(t.counterpartyId) || {}).name, (contactById(t.contactId) || {}).name]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(taskSearch.toLowerCase())) return false;
    }
    return true;
  }).sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));

  const feed = tasksL
    .flatMap(t => (t.timeline || []).map(ev => ({ ...ev, taskTitle: t.title, taskId: t.id })))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 30);

  const filteredCps = cpsL.filter(c => !cpSearch ||
    [c.name, c.phone, c.email, c.comment].filter(Boolean).join(' ').toLowerCase().includes(cpSearch.toLowerCase()));
  const filteredContacts = contactsL.filter(c => {
    if (contactCpFilter && String(c.counterpartyId) !== String(contactCpFilter)) return false;
    if (contactSearch) {
      const hay = [c.name, c.position, c.phone, c.email, c.comment, (cpById(c.counterpartyId) || {}).name].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(contactSearch.toLowerCase())) return false;
    }
    return true;
  });

  // ---- календарь (неделя с понедельника) ----
  const tasksByDate = {};
  tasksL.forEach(t => { if (t.dueDate) { (tasksByDate[t.dueDate] = tasksByDate[t.dueDate] || []).push(t); } });
  const leadBlanks = (new Date(calYear, calMonth, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const calCells = [];
  for (let i = 0; i < leadBlanks; i++) calCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) calCells.push(d);
  while (calCells.length % 7) calCells.push(null);
  const shiftMonth = (delta) => {
    const d = new Date(calYear, calMonth + delta, 1);
    setCalYear(d.getFullYear()); setCalMonth(d.getMonth());
  };

  // ---- рендеры ----
  const renderTimeline = (events) => (
    <div style={{ marginTop: 10, borderLeft: '2px solid #e5e5ea', paddingLeft: 16 }}>
      {(events || []).map((ev, i) => {
        const meta = CRM_ACTION_META[ev.action] || { label: ev.action, color: '#8e8e93' };
        return (
          <div key={i} style={{ position: 'relative', padding: '3px 0 9px' }}>
            <span style={{ position: 'absolute', left: -21, top: 7, width: 9, height: 9, borderRadius: '50%', background: meta.color, border: '2px solid #fff', boxShadow: `0 0 0 1px ${meta.color}` }} />
            <div style={{ fontSize: 13 }}>
              <strong>{ev.actor}</strong> {meta.label}
              {ev.taskTitle ? <span style={{ color: '#0071e3', cursor: 'pointer', fontWeight: 600 }} title="Открыть карточку задачи" onClick={() => setViewTaskId(ev.taskId)}> — {ev.taskTitle}</span> : null}
              <span style={{ color: '#8e8e93' }}> · {crmFmtTs(ev.ts)}</span>
            </div>
            {ev.note ? <div style={{ fontSize: 13, color: '#555', fontStyle: 'italic', marginTop: 2 }}>«{ev.note}»</div> : null}
          </div>
        );
      })}
    </div>
  );

  const renderTaskCard = (t) => {
    const meta = CRM_STATUS_META[t.status] || CRM_STATUS_META.open;
    const pr = CRM_PRIORITY_META[t.priority] || CRM_PRIORITY_META.normal;
    const cp = cpById(t.counterpartyId);
    const ct = contactById(t.contactId);
    const over = isOverdue(t);
    const iAmAssignee = !t.assignee || t.assignee === currentUser; // пустой исполнитель = закрыть может любой
    const iAmCreator = t.createdBy === currentUser;
    const expanded = !!expandedTl[t.id];
    return (
      <div key={t.id} style={{ ...stCard, marginBottom: 10, borderLeft: `4px solid ${meta.color}`, background: over ? '#fff9f8' : '#fff' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 240px' }}>
            <div onClick={() => setViewTaskId(t.id)} title="Открыть карточку задачи" style={{ fontWeight: 700, fontSize: 15, cursor: 'pointer', textDecoration: t.status === 'closed' ? 'line-through' : 'none', color: t.status === 'closed' ? '#6e6e73' : '#1d1d1f' }}>{t.title}</div>
            {t.description ? <div style={{ fontSize: 13, color: '#555', marginTop: 3, whiteSpace: 'pre-wrap' }}>{t.description}</div> : null}
          </div>
          <span style={stBadge(meta.color, meta.bg)}>{meta.label}</span>
          <span style={stBadge(pr.color, '#f5f5f7')}>{pr.label}</span>
          {over ? <span style={stBadge('#e74c3c', '#fdecea')}>⏰ Просрочена</span> : null}
          {(t.photosBefore || []).length + (t.photosAfter || []).length > 0 ? <span style={stBadge('#5856d6', '#efeffa')} title="Фотоотчёт: до / после">📷 {(t.photosBefore || []).length}/{(t.photosAfter || []).length}</span> : null}
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, color: '#555', marginTop: 8 }}>
          <span>📅 Срок: <strong>{crmFmtDate(t.dueDate)}</strong></span>
          <span>👤 Исполнитель: <strong>{t.assignee || 'любой'}</strong></span>
          <span>✍️ Постановщик: {t.createdBy}</span>
          {cp ? <span>🏢 <span style={stLink} title="Открыть карточку контрагента" onClick={() => setViewCpId(cp.id)}>{cp.name}</span></span> : null}
          {ct ? <span>📇 <span style={stLink} title="Открыть карточку контакта" onClick={() => setViewContactId(ct.id)}>{ct.name}</span>{ct.position ? ` (${ct.position})` : ''}</span> : null}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
          {t.status === 'open' && iAmAssignee && (
            <button onClick={() => openAction('done', t.id)} style={{ ...stBtn, background: '#27ae60', padding: '6px 12px', fontSize: 12 }}>✅ Выполнена</button>
          )}
          {t.status === 'pending_confirm' && iAmCreator && (
            <>
              <button onClick={() => openAction('confirm', t.id)} style={{ ...stBtn, background: '#27ae60', padding: '6px 12px', fontSize: 12 }}>👍 Подтвердить закрытие</button>
              <button onClick={() => openAction('return', t.id)} style={{ ...stBtnGhost, color: '#e74c3c', borderColor: '#e74c3c' }}>↩ На доработку</button>
            </>
          )}
          {t.status === 'open' && !iAmAssignee && (
            <span style={{ fontSize: 12, color: '#8e8e93' }}>закрыть может только исполнитель: {t.assignee}</span>
          )}
          {t.status === 'pending_confirm' && !iAmCreator && (
            <span style={{ fontSize: 12, color: '#8e8e93' }}>ждёт подтверждения постановщика: {t.createdBy}</span>
          )}
          {t.status !== 'closed' && (
            <button onClick={() => openAction('comment', t.id)} style={stBtnGhost}>💬 Комментарий</button>
          )}
          {(iAmCreator || iAmAssignee) && t.status !== 'closed' && (
            <button onClick={() => openTaskModal(t)} style={stBtnGhost}>✎ Изменить</button>
          )}
          <button onClick={() => setExpandedTl(prev => ({ ...prev, [t.id]: !prev[t.id] }))} style={stBtnGhost}>🕓 История ({(t.timeline || []).length}) {expanded ? '▲' : '▼'}</button>
          {iAmCreator && (
            <button onClick={() => removeTask(t)} style={{ ...stBtnGhost, color: '#e74c3c' }}>🗑</button>
          )}
        </div>
        {renderPhotoReport(t)}
        {expanded && renderTimeline(t.timeline)}
      </div>
    );
  };

  return (
    <div style={{ padding: '6px 15px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '4px 0 10px' }}>
        <h2 style={{ margin: 0 }}>🤝 CRM</h2>
        <button onClick={() => setSection('calendar')} style={stPill(section === 'calendar')}>📅 Календарь</button>
        <button onClick={() => setSection('tasks')} style={stPill(section === 'tasks')}>📋 Задачи ({tasksL.filter(t => t.status !== 'closed').length})</button>
        <button onClick={() => setSection('cps')} style={stPill(section === 'cps')}>👥 Контрагенты ({cpsL.length})</button>
        <button onClick={() => setSection('contacts')} style={stPill(section === 'contacts')}>📇 Контакты ({contactsL.length})</button>
        <button onClick={() => openTaskModal(null)} style={{ ...stBtn, marginLeft: 'auto' }}>＋ Новая задача</button>
      </div>
      <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 10 }}>
        {useServer
          ? <>Данные CRM хранятся на сервере (Supabase) и общие для всей команды. Вы вошли как <strong>{currentUser}</strong>: задачу закрывает исполнитель («✅ Выполнена»), постановщик подтверждает закрытие или возвращает на доработку.</>
          : <>Данные CRM хранятся локально в этом браузере (localStorage). Вы вошли как <strong>{currentUser}</strong>: задачу закрывает исполнитель («✅ Выполнена»), постановщик подтверждает закрытие или возвращает на доработку.</>}
      </div>

      {crmError && (
        <div style={{ background: '#fdf2e3', border: '1px solid #e67e22', borderRadius: 10, padding: '8px 12px', fontSize: 13, marginBottom: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>⚠️ {crmError}</span>
          <button onClick={() => setCrmRetry(n => n + 1)} style={stBtnGhost}>🔄 Повторить</button>
        </div>
      )}
      {crmLoading && <div style={{ ...stCard, color: '#8e8e93', fontSize: 14, marginBottom: 10 }}>⏳ Загрузка CRM…</div>}

      {!crmLoading && (<>
      {/* Сводка по задачам */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {[
          { label: 'В работе', n: cntOpen, color: '#0071e3' },
          { label: 'На подтверждении', n: cntPending, color: '#e67e22' },
          { label: 'Просрочено', n: cntOverdue, color: '#e74c3c' },
          { label: 'Закрыто за месяц', n: cntClosedMonth, color: '#27ae60' }
        ].map(x => (
          <div key={x.label} style={{ ...stCard, padding: '10px 16px', minWidth: 130 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: x.color }}>{x.n}</div>
            <div style={{ fontSize: 12, color: '#6e6e73' }}>{x.label}</div>
          </div>
        ))}
      </div>

      {/* ======== РАЗДЕЛ: КАЛЕНДАРЬ ======== */}
      {section === 'calendar' && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ ...stCard, flex: '1 1 560px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <button onClick={() => shiftMonth(-1)} style={stBtnGhost}>←</button>
              <strong style={{ fontSize: 16, minWidth: 150, textAlign: 'center' }}>{MONTH_NAMES[calMonth]} {calYear}</strong>
              <button onClick={() => shiftMonth(1)} style={stBtnGhost}>→</button>
              <button onClick={() => { const n = new Date(); setCalYear(n.getFullYear()); setCalMonth(n.getMonth()); setSelectedDate(crmTodayIso()); }} style={stBtnGhost}>Сегодня</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
              {CRM_WEEKDAYS.map(w => <div key={w} style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#8e8e93', padding: '4px 0' }}>{w}</div>)}
              {calCells.map((d, i) => {
                if (!d) return <div key={i} />;
                const iso = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const dayTasks = tasksByDate[iso] || [];
                const isToday = iso === todayIso;
                const isSel = iso === selectedDate;
                return (
                  <div key={i} onClick={() => setSelectedDate(iso)}
                    style={{ minHeight: 64, borderRadius: 8, padding: 4, cursor: 'pointer', border: isSel ? '2px solid #0071e3' : '1px solid #e5e5ea', background: isToday ? '#e8f0fe' : '#fff' }}>
                    <div style={{ fontSize: 12, fontWeight: isToday ? 800 : 600, color: isToday ? '#0071e3' : '#1d1d1f' }}>{d}</div>
                    {dayTasks.slice(0, 3).map(t => {
                      const m = CRM_STATUS_META[t.status] || CRM_STATUS_META.open;
                      return (
                        <div key={t.id} title={`Открыть задачу: ${t.title}`} onClick={(e) => { e.stopPropagation(); setSelectedDate(iso); setViewTaskId(t.id); }} style={{ fontSize: 10, marginTop: 2, padding: '1px 4px', borderRadius: 4, background: m.bg, color: m.color, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', borderLeft: isOverdue(t) ? '2px solid #e74c3c' : 'none', cursor: 'pointer' }}>{t.title}</div>
                      );
                    })}
                    {dayTasks.length > 3 ? <div style={{ fontSize: 10, color: '#8e8e93', marginTop: 1 }}>+{dayTasks.length - 3} ещё</div> : null}
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ flex: '1 1 320px', minWidth: 300 }}>
            <div style={{ ...stCard, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 15 }}>📋 {crmFmtDate(selectedDate)}</strong>
                <button onClick={() => openTaskModal(null, selectedDate)} style={{ ...stBtn, marginLeft: 'auto', padding: '6px 12px', fontSize: 12 }}>＋ Задача на этот день</button>
              </div>
              {(tasksByDate[selectedDate] || []).length === 0 && <div style={{ fontSize: 13, color: '#8e8e93', marginTop: 6 }}>На этот день задач нет.</div>}
            </div>
            {(tasksByDate[selectedDate] || []).map(renderTaskCard)}
          </div>
        </div>
      )}

      {/* ======== РАЗДЕЛ: ЗАДАЧИ ======== */}
      {section === 'tasks' && (
        <div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            {[['active', 'Активные'], ['open', 'В работе'], ['pending_confirm', 'На подтверждении'], ['overdue', 'Просроченные'], ['closed', 'Закрытые'], ['all', 'Все']].map(([k, label]) => (
              <button key={k} onClick={() => setTaskFilter(k)} style={stPill(taskFilter === k)}>{label}</button>
            ))}
            <input value={taskSearch} onChange={e => setTaskSearch(e.target.value)} placeholder="🔍 поиск по задачам…" style={{ ...stInput, width: 220 }} />
            <button onClick={() => setShowFeed(v => !v)} style={stPill(showFeed)}>🕓 Таймлайн всех событий</button>
          </div>
          {showFeed && (
            <div style={{ ...stCard, marginBottom: 14 }}>
              <strong style={{ fontSize: 15 }}>🕓 Таймлайн исполнения заданий (последние 30 событий)</strong>
              {feed.length === 0
                ? <div style={{ fontSize: 13, color: '#8e8e93', marginTop: 6 }}>Событий пока нет.</div>
                : renderTimeline(feed)}
            </div>
          )}
          {filteredTasks.length === 0 && <div style={{ ...stCard, color: '#8e8e93', fontSize: 14 }}>Задач по этому фильтру нет. Нажмите «＋ Новая задача».</div>}
          {filteredTasks.map(renderTaskCard)}
        </div>
      )}

      {/* ======== РАЗДЕЛ: КОНТРАГЕНТЫ ======== */}
      {section === 'cps' && (
        <div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <input value={cpSearch} onChange={e => setCpSearch(e.target.value)} placeholder="🔍 поиск контрагентов…" style={{ ...stInput, width: 260 }} />
            <button onClick={() => openCpModal(null)} style={stBtn}>＋ Контрагент</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {filteredCps.map(cp => {
              const cpContacts = contactsL.filter(c => c.counterpartyId === cp.id);
              const cpOpenTasks = tasksL.filter(t => t.counterpartyId === cp.id && t.status !== 'closed').length;
              return (
                <div key={cp.id} style={stCard}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 15, flex: 1, cursor: 'pointer' }} title="Открыть карточку контрагента" onClick={() => setViewCpId(cp.id)}>{cp.name}</strong>
                    <span style={stBadge('#1d1d1f', '#f5f5f7')}>{CRM_CP_TYPE_LABELS[cp.type] || CRM_CP_TYPE_LABELS.other}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#555', marginTop: 6, display: 'grid', gap: 2 }}>
                    {cp.phone ? <span>📞 {cp.phone}</span> : null}
                    {cp.email ? <span>✉️ {cp.email}</span> : null}
                    {cp.address ? <span>📍 {cp.address}</span> : null}
                    {cp.comment ? <span style={{ fontStyle: 'italic' }}>💬 {cp.comment}</span> : null}
                  </div>
                  {cpContacts.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {cpContacts.map(c => <span key={c.id} title="Открыть карточку контакта" onClick={() => setViewContactId(c.id)} style={{ ...stBadge('#0071e3', '#e8f0fe'), cursor: 'pointer' }}>📇 {c.name}</span>)}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    {cpOpenTasks > 0 ? <span title="Показать задачи контрагента" onClick={() => { setTaskSearch(cp.name); setTaskFilter('all'); setSection('tasks'); }} style={{ fontSize: 12, color: '#e67e22', fontWeight: 700, cursor: 'pointer' }}>📋 открытых задач: {cpOpenTasks}</span> : null}
                    <button onClick={() => openContactModal(null, cp.id)} style={{ ...stBtnGhost, marginLeft: 'auto' }}>＋ Контакт</button>
                    <button onClick={() => openCpModal(cp)} style={stBtnGhost}>✎</button>
                    <button onClick={() => removeCp(cp)} style={{ ...stBtnGhost, color: '#e74c3c' }}>🗑</button>
                  </div>
                </div>
              );
            })}
          </div>
          {filteredCps.length === 0 && <div style={{ ...stCard, marginTop: 12, color: '#8e8e93', fontSize: 14 }}>Контрагентов нет — добавьте первого кнопкой «＋ Контрагент».</div>}
        </div>
      )}

      {/* ======== РАЗДЕЛ: КОНТАКТЫ ======== */}
      {section === 'contacts' && (
        <div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <input value={contactSearch} onChange={e => setContactSearch(e.target.value)} placeholder="🔍 поиск контактов…" style={{ ...stInput, width: 240 }} />
            <select value={contactCpFilter} onChange={e => setContactCpFilter(e.target.value)} style={{ ...stInput, width: 220 }}>
              <option value="">Все контрагенты</option>
              {cpsL.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={() => openContactModal(null, contactCpFilter)} style={stBtn}>＋ Контакт</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            {filteredContacts.map(ct => {
              const cp = cpById(ct.counterpartyId);
              return (
                <div key={ct.id} style={stCard}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 15, flex: 1, cursor: 'pointer' }} title="Открыть карточку контакта" onClick={() => setViewContactId(ct.id)}>{ct.name}</strong>
                    {ct.position ? <span style={stBadge('#6e6e73', '#f5f5f7')}>{ct.position}</span> : null}
                  </div>
                  <div style={{ fontSize: 13, color: '#555', marginTop: 6, display: 'grid', gap: 2 }}>
                    {cp ? <span>🏢 <span style={stLink} title="Открыть карточку контрагента" onClick={() => setViewCpId(cp.id)}>{cp.name}</span></span> : <span style={{ color: '#8e8e93' }}>🏢 без контрагента</span>}
                    {ct.phone ? <span>📞 {ct.phone}</span> : null}
                    {ct.email ? <span>✉️ {ct.email}</span> : null}
                    {ct.comment ? <span style={{ fontStyle: 'italic' }}>💬 {ct.comment}</span> : null}
                  </div>
                  {renderContactAttachments(ct)}
                  <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
                    <button onClick={() => openContactModal(ct)} style={stBtnGhost}>✎</button>
                    <button onClick={() => removeContact(ct)} style={{ ...stBtnGhost, color: '#e74c3c' }}>🗑</button>
                  </div>
                </div>
              );
            })}
          </div>
          {filteredContacts.length === 0 && <div style={{ ...stCard, marginTop: 12, color: '#8e8e93', fontSize: 14 }}>Контактов нет — добавьте первый кнопкой «＋ Контакт».</div>}
        </div>
      )}

      </>)}

      {/* ======== КАРТОЧКА ЗАДАЧИ (просмотр по клику из календаря/списка/ленты, v34) ======== */}
      {viewTaskId !== null && (() => {
        const t = tasksL.find(x => String(x.id) === String(viewTaskId));
        if (!t) return null;
        const meta = CRM_STATUS_META[t.status] || CRM_STATUS_META.open;
        const pr = CRM_PRIORITY_META[t.priority] || CRM_PRIORITY_META.normal;
        const cp = cpById(t.counterpartyId);
        const ct = contactById(t.contactId);
        const over = isOverdue(t);
        const iAmAssignee = !t.assignee || t.assignee === currentUser;
        const iAmCreator = t.createdBy === currentUser;
        return (
          <div style={stOverlay} onClick={() => setViewTaskId(null)}>
            <div style={{ ...stModal, borderLeft: `5px solid ${meta.color}` }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <h3 style={{ margin: 0, flex: 1, textDecoration: t.status === 'closed' ? 'line-through' : 'none' }}>{t.title}</h3>
                <button onClick={() => setViewTaskId(null)} style={{ ...stBtnGhost, border: 'none', fontSize: 16 }}>✕</button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
                <span style={stBadge(meta.color, meta.bg)}>{meta.label}</span>
                <span style={stBadge(pr.color, '#f5f5f7')}>{pr.label}</span>
                {over ? <span style={stBadge('#e74c3c', '#fdecea')}>⏰ Просрочена</span> : null}
              </div>
              {t.description ? <div style={{ fontSize: 14, color: '#555', whiteSpace: 'pre-wrap', marginBottom: 8 }}>{t.description}</div> : null}
              <div style={{ display: 'grid', gap: 4, fontSize: 13, color: '#555', marginBottom: 10 }}>
                <span>📅 Срок: <strong>{crmFmtDate(t.dueDate)}</strong></span>
                <span>👤 Исполнитель: <strong>{t.assignee || 'любой'}</strong></span>
                <span>✍️ Постановщик: {t.createdBy}</span>
                {cp ? <span>🏢 Контрагент: <span style={stLink} title="Открыть карточку контрагента" onClick={() => setViewCpId(cp.id)}>{cp.name}</span></span> : null}
                {ct ? <span>📇 Контакт: <span style={stLink} title="Открыть карточку контакта" onClick={() => setViewContactId(ct.id)}>{ct.name}</span>{ct.position ? ` (${ct.position})` : ''}{ct.phone ? ` · ${ct.phone}` : ''}</span> : null}
                {t.createdAt ? <span>🗓 Создана: {crmFmtTs(t.createdAt)}</span> : null}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {t.status === 'open' && iAmAssignee && (
                  <button onClick={() => openAction('done', t.id)} style={{ ...stBtn, background: '#27ae60', padding: '6px 12px', fontSize: 12 }}>✅ Выполнена</button>
                )}
                {t.status === 'pending_confirm' && iAmCreator && (
                  <>
                    <button onClick={() => openAction('confirm', t.id)} style={{ ...stBtn, background: '#27ae60', padding: '6px 12px', fontSize: 12 }}>👍 Подтвердить закрытие</button>
                    <button onClick={() => openAction('return', t.id)} style={{ ...stBtnGhost, color: '#e74c3c', borderColor: '#e74c3c' }}>↩ На доработку</button>
                  </>
                )}
                {t.status !== 'closed' && <button onClick={() => openAction('comment', t.id)} style={stBtnGhost}>💬 Комментарий</button>}
                {(iAmCreator || iAmAssignee) && t.status !== 'closed' && <button onClick={() => openTaskModal(t)} style={stBtnGhost}>✎ Изменить</button>}
                {iAmCreator && <button onClick={() => { setViewTaskId(null); removeTask(t); }} style={{ ...stBtnGhost, color: '#e74c3c' }}>🗑 Удалить</button>}
              </div>
              {renderPhotoReport(t)}
              <div style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: '#6e6e73' }}>🕓 Таймлайн исполнения</div>
              {renderTimeline(t.timeline)}
            </div>
          </div>
        );
      })()}

      {/* ======== КАРТОЧКА КОНТРАГЕНТА (просмотр по клику, v34) ======== */}
      {viewCpId !== null && (() => {
        const cp = cpById(viewCpId);
        if (!cp) return null;
        const cpContacts = contactsL.filter(c => String(c.counterpartyId) === String(cp.id));
        const cpTasks = tasksL.filter(t => String(t.counterpartyId) === String(cp.id));
        return (
          <div style={stOverlay} onClick={() => setViewCpId(null)}>
            <div style={stModal} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <h3 style={{ margin: 0, flex: 1 }}>🏢 {cp.name}</h3>
                <span style={stBadge('#1d1d1f', '#f5f5f7')}>{CRM_CP_TYPE_LABELS[cp.type] || CRM_CP_TYPE_LABELS.other}</span>
                <button onClick={() => setViewCpId(null)} style={{ ...stBtnGhost, border: 'none', fontSize: 16 }}>✕</button>
              </div>
              <div style={{ fontSize: 13, color: '#555', marginTop: 8, display: 'grid', gap: 3 }}>
                {cp.phone ? <span>📞 {cp.phone}</span> : null}
                {cp.email ? <span>✉️ {cp.email}</span> : null}
                {cp.address ? <span>📍 {cp.address}</span> : null}
                {cp.comment ? <span style={{ fontStyle: 'italic' }}>💬 {cp.comment}</span> : null}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
                <button onClick={() => openCpModal(cp)} style={stBtnGhost}>✎ Изменить</button>
                <button onClick={() => openContactModal(null, cp.id)} style={stBtnGhost}>＋ Контакт</button>
                <button onClick={() => openTaskModal(null, '', cp.id)} style={stBtnGhost}>＋ Задача</button>
                <button onClick={() => { setViewCpId(null); removeCp(cp); }} style={{ ...stBtnGhost, color: '#e74c3c' }}>🗑 Удалить</button>
              </div>
              {renderCpAttachments(cp)}
              <div style={{ fontSize: 13, fontWeight: 700, color: '#6e6e73', marginTop: 6 }}>📇 Контакты ({cpContacts.length})</div>
              {cpContacts.length === 0 ? <div style={{ fontSize: 13, color: '#8e8e93', margin: '4px 0 8px' }}>Контактов нет — добавьте кнопкой «＋ Контакт».</div> : (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '6px 0 8px' }}>
                  {cpContacts.map(c => <span key={c.id} title="Открыть карточку контакта" onClick={() => setViewContactId(c.id)} style={{ ...stBadge('#0071e3', '#e8f0fe'), cursor: 'pointer', fontSize: 12, padding: '4px 10px' }}>📇 {c.name}{c.position ? ` · ${c.position}` : ''}</span>)}
                </div>
              )}
              <div style={{ fontSize: 13, fontWeight: 700, color: '#6e6e73' }}>📋 Задачи ({cpTasks.length})</div>
              {cpTasks.length === 0 ? <div style={{ fontSize: 13, color: '#8e8e93', marginTop: 4 }}>Задач нет — добавьте кнопкой «＋ Задача».</div> : cpTasks.map(t => {
                const m = CRM_STATUS_META[t.status] || CRM_STATUS_META.open;
                return (
                  <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}>
                    <span style={stBadge(m.color, m.bg)}>{m.label}</span>
                    <span style={{ ...stLink, flex: 1 }} title="Открыть карточку задачи" onClick={() => setViewTaskId(t.id)}>{t.title}</span>
                    <span style={{ color: '#8e8e93', fontSize: 12 }}>{crmFmtDate(t.dueDate)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ======== КАРТОЧКА КОНТАКТА (просмотр по клику, v34) ======== */}
      {viewContactId !== null && (() => {
        const ct = contactById(viewContactId);
        if (!ct) return null;
        const cp = cpById(ct.counterpartyId);
        const ctTasks = tasksL.filter(t => String(t.contactId) === String(ct.id));
        return (
          <div style={stOverlay} onClick={() => setViewContactId(null)}>
            <div style={stModal} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <h3 style={{ margin: 0, flex: 1 }}>📇 {ct.name}</h3>
                {ct.position ? <span style={stBadge('#6e6e73', '#f5f5f7')}>{ct.position}</span> : null}
                <button onClick={() => setViewContactId(null)} style={{ ...stBtnGhost, border: 'none', fontSize: 16 }}>✕</button>
              </div>
              <div style={{ fontSize: 13, color: '#555', marginTop: 8, display: 'grid', gap: 3 }}>
                {cp ? <span>🏢 <span style={stLink} title="Открыть карточку контрагента" onClick={() => setViewCpId(cp.id)}>{cp.name}</span></span> : <span style={{ color: '#8e8e93' }}>🏢 без контрагента</span>}
                {ct.phone ? <span>📞 {ct.phone}</span> : null}
                {ct.email ? <span>✉️ {ct.email}</span> : null}
                {ct.comment ? <span style={{ fontStyle: 'italic' }}>💬 {ct.comment}</span> : null}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
                <button onClick={() => openContactModal(ct)} style={stBtnGhost}>✎ Изменить</button>
                <button onClick={() => openTaskModal(null, '', ct.counterpartyId || '')} style={stBtnGhost}>＋ Задача</button>
                <button onClick={() => { setViewContactId(null); removeContact(ct); }} style={{ ...stBtnGhost, color: '#e74c3c' }}>🗑 Удалить</button>
              </div>
              {renderContactAttachments(ct)}
              <div style={{ fontSize: 13, fontWeight: 700, color: '#6e6e73' }}>📋 Задачи контакта ({ctTasks.length})</div>
              {ctTasks.length === 0 ? <div style={{ fontSize: 13, color: '#8e8e93', marginTop: 4 }}>Задач нет.</div> : ctTasks.map(t => {
                const m = CRM_STATUS_META[t.status] || CRM_STATUS_META.open;
                return (
                  <div key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}>
                    <span style={stBadge(m.color, m.bg)}>{m.label}</span>
                    <span style={{ ...stLink, flex: 1 }} title="Открыть карточку задачи" onClick={() => setViewTaskId(t.id)}>{t.title}</span>
                    <span style={{ color: '#8e8e93', fontSize: 12 }}>{crmFmtDate(t.dueDate)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ======== МОДАЛКА: ЗАДАЧА ======== */}
      {taskModal && (
        <div style={stOverlay} onClick={() => setTaskModal(null)}>
          <div style={stModal} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px' }}>{taskModal.id ? '✎ Редактировать задачу' : '＋ Новая задача'}</h3>
            <div style={stField}>
              <label style={stLabel}>Название *</label>
              <input autoFocus value={taskForm.title || ''} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} style={stInput} placeholder="Например: отправить акт сверки" />
            </div>
            <div style={stField}>
              <label style={stLabel}>Описание</label>
              <textarea value={taskForm.description || ''} onChange={e => setTaskForm(f => ({ ...f, description: e.target.value }))} style={{ ...stInput, minHeight: 60, resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ ...stField, flex: '1 1 160px' }}>
                <label style={stLabel}>Срок исполнения</label>
                <input type="date" value={taskForm.dueDate || ''} onChange={e => setTaskForm(f => ({ ...f, dueDate: e.target.value }))} style={stInput} />
              </div>
              <div style={{ ...stField, flex: '1 1 140px' }}>
                <label style={stLabel}>Приоритет</label>
                <select value={taskForm.priority || 'normal'} onChange={e => setTaskForm(f => ({ ...f, priority: e.target.value }))} style={stInput}>
                  <option value="high">🔴 Высокий</option>
                  <option value="normal">⚪ Обычный</option>
                  <option value="low">🔵 Низкий</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ ...stField, flex: '1 1 180px' }}>
                <label style={stLabel}>Контрагент</label>
                <select value={taskForm.counterpartyId || ''} onChange={e => setTaskForm(f => ({ ...f, counterpartyId: e.target.value, contactId: '' }))} style={stInput}>
                  <option value="">— не выбран —</option>
                  {cpsL.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {taskForm.counterpartyId ? <button type="button" onClick={() => setViewCpId(taskForm.counterpartyId)} style={{ ...stBtnGhost, marginTop: 6, padding: '4px 10px' }}>👁 Карточка контрагента</button> : null}
              </div>
              <div style={{ ...stField, flex: '1 1 180px' }}>
                <label style={stLabel}>Контакт</label>
                <select value={taskForm.contactId || ''} onChange={e => setTaskForm(f => ({ ...f, contactId: e.target.value }))} style={stInput}>
                  <option value="">— не выбран —</option>
                  {contactsL.filter(c => !taskForm.counterpartyId || String(c.counterpartyId) === String(taskForm.counterpartyId)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {taskForm.contactId ? <button type="button" onClick={() => setViewContactId(taskForm.contactId)} style={{ ...stBtnGhost, marginTop: 6, padding: '4px 10px' }}>👁 Карточка контакта</button> : null}
              </div>
            </div>
            <div style={stField}>
              <label style={stLabel}>Исполнитель (пусто — отметить выполненной может любой)</label>
              <input value={taskForm.assignee || ''} onChange={e => setTaskForm(f => ({ ...f, assignee: e.target.value }))} style={stInput} list="crm-assignees" placeholder={currentUser} />
              <datalist id="crm-assignees">{knownAssignees.map(n => <option key={n} value={n} />)}</datalist>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
              <button onClick={() => setTaskModal(null)} style={stBtnGhost}>Отмена</button>
              <button onClick={saveTask} style={stBtn}>💾 Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {/* ======== МОДАЛКА: КОНТРАГЕНТ ======== */}
      {cpModal && (
        <div style={stOverlay} onClick={() => setCpModal(null)}>
          <div style={stModal} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px' }}>{cpModal.id ? '✎ Контрагент' : '＋ Новый контрагент'}</h3>
            <div style={stField}>
              <label style={stLabel}>Название *</label>
              <input autoFocus value={cpForm.name || ''} onChange={e => setCpForm(f => ({ ...f, name: e.target.value }))} style={stInput} placeholder="ООО «Ромашка»" />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ ...stField, flex: '1 1 150px' }}>
                <label style={stLabel}>Тип</label>
                <select value={cpForm.type || 'client'} onChange={e => setCpForm(f => ({ ...f, type: e.target.value }))} style={stInput}>
                  <option value="client">🤝 Клиент</option>
                  <option value="supplier">📦 Поставщик</option>
                  <option value="partner">🏢 Партнёр</option>
                  <option value="other">📎 Прочее</option>
                </select>
              </div>
              <div style={{ ...stField, flex: '1 1 170px' }}>
                <label style={stLabel}>Телефон</label>
                <input value={cpForm.phone || ''} onChange={e => setCpForm(f => ({ ...f, phone: e.target.value }))} style={stInput} />
              </div>
            </div>
            <div style={stField}>
              <label style={stLabel}>Email</label>
              <input value={cpForm.email || ''} onChange={e => setCpForm(f => ({ ...f, email: e.target.value }))} style={stInput} />
            </div>
            <div style={stField}>
              <label style={stLabel}>Адрес</label>
              <input value={cpForm.address || ''} onChange={e => setCpForm(f => ({ ...f, address: e.target.value }))} style={stInput} />
            </div>
            <div style={stField}>
              <label style={stLabel}>Комментарий</label>
              <textarea value={cpForm.comment || ''} onChange={e => setCpForm(f => ({ ...f, comment: e.target.value }))} style={{ ...stInput, minHeight: 50, resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setCpModal(null)} style={stBtnGhost}>Отмена</button>
              <button onClick={saveCp} style={stBtn}>💾 Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {/* ======== МОДАЛКА: КОНТАКТ ======== */}
      {contactModal && (
        <div style={stOverlay} onClick={() => setContactModal(null)}>
          <div style={stModal} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 12px' }}>{contactModal.id ? '✎ Контакт' : '＋ Новый контакт'}</h3>
            <div style={stField}>
              <label style={stLabel}>Имя *</label>
              <input autoFocus value={contactForm.name || ''} onChange={e => setContactForm(f => ({ ...f, name: e.target.value }))} style={stInput} placeholder="Иван Иванов" />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ ...stField, flex: '1 1 180px' }}>
                <label style={stLabel}>Контрагент</label>
                <select value={contactForm.counterpartyId || ''} onChange={e => setContactForm(f => ({ ...f, counterpartyId: e.target.value }))} style={stInput}>
                  <option value="">— без контрагента —</option>
                  {cpsL.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div style={{ ...stField, flex: '1 1 150px' }}>
                <label style={stLabel}>Должность</label>
                <input value={contactForm.position || ''} onChange={e => setContactForm(f => ({ ...f, position: e.target.value }))} style={stInput} placeholder="Менеджер" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ ...stField, flex: '1 1 160px' }}>
                <label style={stLabel}>Телефон</label>
                <input value={contactForm.phone || ''} onChange={e => setContactForm(f => ({ ...f, phone: e.target.value }))} style={stInput} />
              </div>
              <div style={{ ...stField, flex: '1 1 170px' }}>
                <label style={stLabel}>Email</label>
                <input value={contactForm.email || ''} onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))} style={stInput} />
              </div>
            </div>
            <div style={stField}>
              <label style={stLabel}>Комментарий</label>
              <textarea value={contactForm.comment || ''} onChange={e => setContactForm(f => ({ ...f, comment: e.target.value }))} style={{ ...stInput, minHeight: 50, resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setContactModal(null)} style={stBtnGhost}>Отмена</button>
              <button onClick={saveContact} style={stBtn}>💾 Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {/* ======== МОДАЛКА: ДЕЙСТВИЕ СО СТАТУСОМ (закрытие исполнителем / подтверждение / возврат / комментарий) ======== */}
      {actionModal && (() => {
        const t = tasksL.find(x => String(x.id) === String(actionModal.taskId));
        if (!t) return null;
        const titles = { done: '✅ Отметить задачу выполненной', confirm: '👍 Подтвердить закрытие задачи', return: '↩ Вернуть задачу на доработку', comment: '💬 Комментарий к задаче' };
        const hints = {
          done: 'Задача перейдёт в статус «На подтверждении» — постановщик проверит результат и закроет её.',
          confirm: 'Задача будет закрыта. Действие запишется в таймлайн.',
          return: 'Задача вернётся в статус «В работе» — напишите, что нужно исправить.',
          comment: 'Комментарий запишется в таймлайн задачи.'
        };
        const btnLabels = { done: '✅ Выполнена', confirm: '👍 Подтвердить', return: '↩ Вернуть', comment: '💬 Добавить' };
        const btnColors = { done: '#27ae60', confirm: '#27ae60', return: '#e74c3c', comment: '#0071e3' };
        return (
          <div style={stOverlay} onClick={() => setActionModal(null)}>
            <div style={stModal} onClick={e => e.stopPropagation()}>
              <h3 style={{ margin: '0 0 6px' }}>{titles[actionModal.type]}</h3>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{t.title}</div>
              <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 10 }}>{hints[actionModal.type]}</div>
              <textarea autoFocus value={actionNote} onChange={e => setActionNote(e.target.value)}
                placeholder={actionModal.type === 'comment' ? 'Комментарий…' : 'Комментарий (что сделано / что исправить)…'}
                style={{ ...stInput, minHeight: 70, resize: 'vertical' }} />
              {actionModal.type === 'done' && (
                <div>
                  <div style={{ fontSize: 12, color: '#8e8e93', margin: '10px 0 0' }}>Приложите фото/видео/аудио результата — прикрепляются к задаче сразу после выбора:</div>
                  {renderPhotoReport(t)}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
                <button onClick={() => setActionModal(null)} style={stBtnGhost}>Отмена</button>
                <button onClick={submitAction} style={{ ...stBtn, background: btnColors[actionModal.type] }}>{btnLabels[actionModal.type]}</button>
              </div>
            </div>
          </div>
        );
      })()}
      {/* ======== ИНДИКАТОР СЖАТИЯ ВИДЕО (v37) ======== */}
      {mediaProgress && (
        <div style={{ position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', background: '#1d1d1f', color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, fontWeight: 600, zIndex: 2700, boxShadow: '0 8px 24px rgba(0,0,0,0.3)', whiteSpace: 'nowrap' }}>{mediaProgress}</div>
      )}

      {/* ======== ПРОСМОТР ФОТО ИЗ ФОТООТЧЁТА (v35) ======== */}
      {photoViewer && (
        <div
          style={{ ...stOverlay, zIndex: 2600, background: 'rgba(0,0,0,0.9)', alignItems: photoZoom && photoViewer.kind === 'photo' ? 'flex-start' : 'center', justifyContent: photoZoom && photoViewer.kind === 'photo' ? 'flex-start' : 'center', overflow: 'auto', cursor: 'zoom-out' }}
          onClick={() => { setPhotoViewer(null); setPhotoZoom(false); }}
        >
          {photoViewer.kind === 'video' ? (
            viewerError ? (
              <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: '22px 26px', maxWidth: 420, textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🎬</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1d1d1f', marginBottom: 6 }}>Браузер не смог воспроизвести это видео</div>
                <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 12 }}>Формат записан другим браузером (например, webm из Chrome не играет в Safari). Новые сжатия сохраняются в mp4, где возможно.</div>
                <a href={photoViewer.url} target="_blank" rel="noopener noreferrer" style={{ color: '#0071e3', fontWeight: 600, fontSize: 14 }}>Открыть/скачать оригинал ↗</a>
              </div>
            ) : (
              <video src={photoViewer.url} controls autoPlay onClick={e => e.stopPropagation()} onError={() => setViewerError(true)} style={{ maxWidth: '96vw', maxHeight: '92vh', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.5)', background: '#000' }} />
            )
          ) : photoViewer.kind === 'audio' ? (
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 8, maxWidth: '92vw', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1d1d1f' }}>🎵 {photoViewer.name || 'Аудио'}</div>
              <audio src={photoViewer.url} controls autoPlay style={{ width: 'min(420px, 84vw)' }} />
            </div>
          ) : (
            <img
              src={photoViewer.url}
              alt=""
              onClick={(e) => { e.stopPropagation(); setPhotoZoom(z => !z); }}
              title={photoZoom ? 'Клик — уместить в экран' : 'Клик — натуральный размер (с прокруткой)'}
              style={photoZoom
                ? { maxWidth: 'none', maxHeight: 'none', margin: 'auto', borderRadius: 8, cursor: 'zoom-out', boxShadow: '0 8px 40px rgba(0,0,0,0.7)' }
                : { maxWidth: '96vw', maxHeight: '92vh', objectFit: 'contain', borderRadius: 12, cursor: 'zoom-in', boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || null);
  const [user, setUser] = useState(null);
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeTab, setActiveTab] = useState('upload');
  const [chatUnread, setChatUnread] = useState({}); // v83: непрочитанные по каналам
  const chatUnreadTotal = Object.values(chatUnread).reduce((a, b) => a + (b || 0), 0);
  const [password, setPassword] = useState('');
  const [loginName, setLoginName] = useState(''); // v76: вход по логину + паролю
  const [loginError, setLoginError] = useState('');
  const [serverStatus, setServerStatus] = useState('checking');

  const [selectedFiles, setSelectedFiles] = useState([]);
  const pdfExpandedRef = useRef(false); // файлы — JPEG-страницы из PDF (v32.4): распознаём как ОДИН документ
  const pdfSourcesRef = useRef([]); // v56: исходные PDF — для MarkItDown (текстовый слой вместо OCR/vision)
  const folderStartRef = useRef(0); // v56.1: старт пакетной обработки — для оценки оставшегося времени
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
    let lastBeat = Date.now();
    let settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; clearInterval(watchdog); fn(arg); };
    // v53.2: сторож фазы ЗАГРУЗКИ — если прогресс замер (сеть/VPN/прокси), не висим бесконечно.
    // Отключается, когда тело отправлено (upload.onload): ОТВЕТ сервер может готовиться долго — это нормально.
    const watchdog = setInterval(() => {
      if (!settled && Date.now() - lastBeat > 120000) {
        try { xhr.abort(); } catch (_) { /* noop */ }
        finish(reject, new Error('Загрузка на сервер встала — 2 минуты без прогресса (сеть/VPN/прокси). Просто повторите; если повторится — загружайте меньше страниц за раз.'));
      }
    }, 10000);
    xhr.open('POST', url);
    xhr.timeout = 900000; // 15 мин: многостраничные документы (эскритура 29 стр.) распознаются постранично
    xhr.upload.onprogress = (e) => {
      lastBeat = Date.now();
      if (e.lengthComputable) onUploadProgress(e.loaded / e.total);
    };
    xhr.upload.onload = () => clearInterval(watchdog); // тело ушло — дальше ждём ответ сколько нужно
    xhr.onload = () => finish(resolve, { ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => finish(reject, new Error('Соединение оборвано (прокси или сеть). Если документ был многостраничным — обновите список: он мог успеть сохраниться на сервере'));
    xhr.ontimeout = () => finish(reject, new Error('Превышено время ожидания (15 мин). Проверьте список документов — документ мог успеть сохраниться на сервере'));
    xhr.send(formData);
  });
  const [lastSavedReceipt, setLastSavedReceipt] = useState(null);
  const [scanResultOpen, setScanResultOpen] = useState(false);
  // По умолчанию — Kimi K3 (бывший дефолт Groq Llama 4 Scout снят Groq с поддержки)
  const [selectedModel, setSelectedModel] = useState('kimi-kimi-k3');
  // Свой URL Mac OCR (v52.2): Safari/Chrome блокируют fetch с https-страницы на http://127.0.0.1 (mixed content).
  // Решение — HTTPS-туннель cloudflared на порт 8787; URL хранится в localStorage 'mac_ocr_url_v1'
  const [macOcrUrl, setMacOcrUrl] = useState(() => {
    try { return localStorage.getItem('mac_ocr_url_v1') || ''; } catch { return ''; }
  });
  const configureMacOcr = () => {
    const url = window.prompt(
      'Адрес Mac OCR-сервера (mac-ocr-server.py).\n\nПусто = прямой http://127.0.0.1:8787 (может блокироваться Safari/Chrome с https-страницы!).\n\nЕсли не работает — поднимите HTTPS-туннель:\nbrew install cloudflared\ncloudflared tunnel --url http://127.0.0.1:8787\nи вставьте сюда выданный https://….trycloudflare.com',
      macOcrUrl
    );
    if (url === null) return;
    const v = url.trim().replace(/\/+$/, '');
    try { v ? localStorage.setItem('mac_ocr_url_v1', v) : localStorage.removeItem('mac_ocr_url_v1'); } catch { /* приватный режим */ }
    setMacOcrUrl(v);
    if (v) {
      // v52.3: сразу проверяем связь, чтобы не узнавать об обрыве в середине распознавания
      testMacOcr(v).then(res => window.alert(res.ok
        ? `✅ Связь есть: ${v}\nMac OCR-сервер отвечает, можно распознавать.`
        : `❌ Нет связи с ${v}\nПричина: ${res.detail}\n\nПроверьте на Mac:\n1) запущен ли python3 mac-ocr-server.py;\n2) запущен ли cloudflared tunnel --url http://127.0.0.1:8787;\n3) URL скопирован из ТЕКУЩЕГО окна туннеля — при каждом перезапуске cloudflared выдаёт НОВЫЙ адрес.`));
    }
  };
  // v52.3: базовый адрес Mac OCR и проверка связи (GET / отвечает {"status":"ok"})
  const macOcrBase = () => (macOcrUrl || LOCAL_MAC_OCR_DEFAULT).replace(/\/+$/, '');
  const testMacOcr = async (base) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(`${base}/`, { signal: ctrl.signal });
      const j = await r.json().catch(() => ({}));
      return r.ok && j.status === 'ok' ? { ok: true } : { ok: false, detail: `HTTP ${r.status} — это не mac-ocr-server` };
    } catch (e) {
      return { ok: false, detail: (e && e.name === 'AbortError') ? 'таймаут 8 сек' : ((e && e.message) || 'сеть недоступна') };
    } finally {
      clearTimeout(timer);
    }
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
  const [freeModelTipOpen, setFreeModelTipOpen] = useState(true); // v57.2: рекомендация бесплатной модели
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
  const [rcLinkPicker, setRcLinkPicker] = useState(null); // v68: фактура, для которой открыт выбор ПЛАТЕЖА из выписки
  const [rcLinkSearch, setRcLinkSearch] = useState('');
  // Таймлайн повторяющихся платежей (v41): ручные плановые платежи (сервер, таблица planned_payments)
  const [plannedPayments, setPlannedPayments] = useState([]);
  const [plannedModal, setPlannedModal] = useState(false);
  const [plannedPickMode, setPlannedPickMode] = useState(false); // режим выбора чека для планового платежа на вкладке «Чеки/фактуры»
  const [plannedForm, setPlannedForm] = useState({ title: '', amount: '', day: '1', category: 'utilities', freq: '1', object: '', counterparty: '', fileUrl: '', fileName: '' });
  const [plannedSaving, setPlannedSaving] = useState(false);
  const [payCalOffset, setPayCalOffset] = useState(0); // сдвиг 2-месячного окна календаря платежей (v42.1)
  const [payCalCollapsed, setPayCalCollapsed] = useState(false);   // свёрнут блок «Обязательные платежи» (v48)
  const [tlFrom, setTlFrom] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }); // диапазон таймлайна (v50)
  const [tlTo, setTlTo] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() + 11); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const [bankListCollapsed, setBankListCollapsed] = useState(false); // свёрнута выписка (v48)
  const [calPicker, setCalPicker] = useState(null);    // id движения с открытым меню «в календарь» (v44)
  useEffect(() => {
    if (calPicker === null) return undefined;
    const close = () => setCalPicker(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [calPicker]);
  const [linkSearch, setLinkSearch] = useState('');
  const [linkSaving, setLinkSaving] = useState(false);
  // Вкладка «Налоги» (v30): черновик форм (отдельный выбор квартала убран в v30.5 — платежи следуют за диапазоном «с/по»)
  const [taxDraft, setTaxDraft] = useState(null);
  const [taxFormPopup, setTaxFormPopup] = useState(null); // {form:'420'|'130', q:<квартал из taxDraft>} — попап заполненной модели (v30.2)
  const [taxShowOptional, setTaxShowOptional] = useState(false);
  // Диапазон кварталов для автозаполнения форм (v30.1): «с … по …»
  const [taxQFrom, setTaxQFrom] = useState('2025-1T');
  const [taxQTo, setTaxQTo] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${Math.floor(now.getMonth() / 3) + 1}T`;
  });
  // Календарь/справочник — иконки в шапке вкладки (v30.4); авто-диапазон из дат движений банка
  const [taxCalOpen, setTaxCalOpen] = useState(false);
  const [taxGuideOpen, setTaxGuideOpen] = useState(false);
  const taxRangeTouched = useRef(false); // пользователь сам менял диапазон — не перезаписывать
  useEffect(() => {
    if (taxRangeTouched.current || !bankMovements.length) return;
    const dates = bankMovements.map(m => m.operation_date).filter(Boolean).sort();
    if (!dates.length) return;
    const qk = d => `${d.slice(0, 4)}-${Math.floor((+d.slice(5, 7) - 1) / 3) + 1}T`;
    setTaxQFrom(qk(dates[0]));
    setTaxQTo(qk(dates[dates.length - 1]));
  }, [bankMovements]);
  const [filterDiffs, setFilterDiffs] = useState([]); // фильтр по разнице Δ (итог чека vs сумма товаров)
  const [searchQuery, setSearchQuery] = useState('');
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  // Сортировка списка: 'receipt' — по дате чека, 'recognized' — по дате распознавания
  const [sortMode, setSortMode] = useState('receipt');
  const [sortDir, setSortDir] = useState('desc');
  // Режим поиска дубликатов
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [copiesFirstOrder, setCopiesFirstOrder] = useState(false); // v68.1: режим «Выбрать все копии» — копии слева, оригинал справа в каждой группе
  // Фокус на группе дубликатов ОДНОЙ выбранной карточки (кнопка «Показать копии»)
  const [dupFocusId, setDupFocusId] = useState(null);
  const [exportProgress, setExportProgress] = useState(null); // v68.2: {done, total, files} — окно прогресса «Загрузить»
  const [exportMenuOpen, setExportMenuOpen] = useState(false); // v69.7: всплывающее меню «Загрузить» (файлы / ZIP)
  const [shareDlg, setShareDlg] = useState(null); // v71: ссылка на выбранные чеки
  const [backupBusy, setBackupBusy] = useState(false); // v72: бэкап проекта (admin)
  const [restoreBusy, setRestoreBusy] = useState(false); // v73: восстановление из бэкапа (admin)
  // v77: уровень доступа к разделу: tabs null/[] — всё; массив — перечисленное; объект {tab:'full'|'read'|'none'}
  const tabAllowed = (t) => {
    const x = user && user.tabs;
    if (!x) return true;
    if (Array.isArray(x)) return !x.length || x.includes(t);
    return x[t] !== 'none';
  };
  // v83: бейдж непрочитанных в шапке — опрос каждые 15 с
  useEffect(() => {
    if (!token) return;
    const tick = () => fetch(`${API_URL}/api/chat/unread`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(j => { if (j && typeof j === 'object' && !j.error) setChatUnread(j); }).catch(() => {});
    tick();
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, [token]);

  // v74/v75: viewer — только просмотр; закрытые разделы (user.tabs) — перебрасываем на доступное
  useEffect(() => {
    if (!user) return;
    const needList = (user.role === 'viewer' || !tabAllowed('upload')) && activeTab === 'upload';
    const closed = !tabAllowed(activeTab) && activeTab !== 'users';
    if (needList || closed) {
      const fallback = ['list', 'docs', 'analysis', 'taxes'].find(t => tabAllowed(t));
      setActiveTab(fallback || 'list');
      if ((fallback || 'list') === 'list') loadReceipts();
    }
  }, [user]); // eslint-disable-line
  const [confirmDlg, setConfirmDlg] = useState(null); // v68.3: {title, text, yesLabel, danger, onYes} — подтверждение действий (загрузка/удаление)
  const exportStopRef = useRef(false);

  const [selectedReceiptIds, setSelectedReceiptIds] = useState(new Set());
  const [viewModal, setViewModal] = useState(null);
  const [fullscreenImage, setFullscreenImage] = useState(null);
  const [fsZoom, setFsZoom] = useState(false); // второй клик по фото в полноэкранном режиме — натуральный размер
  const [modalPageIdx, setModalPageIdx] = useState(0); // выбранная страница в галерее документа (модалка)
  // v56.6: ВСЕ листалки карточки синхронизированы — галерея страниц, текст документа и таблица
  // позиций показывают одну и ту же страницу (перелистнул в одном меню → перелистнулись остальные)
  const itemsPage = modalPageIdx + 1;
  const setItemsPage = (p) => setModalPageIdx(Math.max(0, p - 1));
  const [editMode, setEditMode] = useState(false);     // ручное редактирование полей в карточке
  const [editForm, setEditForm] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);

  // При открытии другого чека галерея начинается с первой страницы, режим редактирования сбрасывается
  useEffect(() => { setModalPageIdx(0); setEditMode(false); setPageTextLang('ru'); setAnnualFormView(false); setDocTextMode('both'); }, [viewModal?.id]);
  const [annualFormView, setAnnualFormView] = useState(false); // годовая отчётность: таблица | вид официальной формы (v32.2)
  const [pageTextLang, setPageTextLang] = useState('ru'); // текст страницы рядом с галереей: перевод | оригинал | обе
  const docTextPage = modalPageIdx;                      // v56.6: текст документа — та же страница, что в галерее
  const setDocTextPage = setModalPageIdx;
  const [docTextMode, setDocTextMode] = useState('both'); // both (построчно/колонки) | ru | orig
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
        body: JSON.stringify({ password, login: loginName.trim() }),
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
    const picked = Array.from(e.target.files).filter(f => f.type.startsWith('image/') || isPdfFile(f) || isWordFile(f));
    if (picked.length > 0) {
      pdfExpandedRef.current = picked.some(isPdfFile); // v32.4: PDF → JPEG → один документ
      pdfSourcesRef.current = picked.filter(isPdfFile); // v56: исходники для MarkItDown
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
    const picked = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/') || isPdfFile(f) || isWordFile(f));
    if (picked.length > 0) {
      pdfExpandedRef.current = picked.some(isPdfFile); // v32.4: PDF → JPEG → один документ
      pdfSourcesRef.current = picked.filter(isPdfFile); // v56: исходники для MarkItDown
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
  const recognizeDocumentPages = async (files, modelOverride = null, allowDuplicate = false) => {
    const effModel = modelOverride || selectedModel;
    setRecognizing(true);
    setLastSavedReceipt(null);
    try {
      const formData = new FormData();
      const prepared = [];
      for (const f of files) {
        let fileToUpload = f;
        if (!isPdfFile(f) && f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
          fileToUpload = await compressImageFile(f);
        }
        prepared.push(fileToUpload);
      }
      let textLayerOnly = false; // v57.1: весь текст — из текстового слоя PDF, OCR не вызывался
      // Локальный Mac OCR (v52): каждая страница → текст на этом Mac (127.0.0.1:8787), дальше сервер структурирует
      if (effModel === 'local-mac-ocr') {
        // Проверка, что бэкенд умеет принимать готовые тексты (v52+), иначе чек сохранится пустым
        try {
          const h = await fetch(`${API_URL}/api/health`).then(r => r.json());
          if (!h.build || h.build < 'v52') throw new Error('old');
        } catch (_) {
          throw new Error('Бэкенд householder-api устарел и не принимает локальный OCR. Запушьте новый index.js и сделайте redeploy (в /api/health должно быть build v52+).');
        }
        // v52.3: сначала проверяем, что сервер вообще отвечает — иначе падали бы на 1-й странице без диагностики
        const ocrTexts = [];
        // v57.1: ТЕКСТОВОЙ СЛОЙ PDF читаем в браузере (pdf.js) ДО распознавания и решаем маршрут:
        // есть текст → MarkItDown/текстовый конвейер (OCR не нужен); нет текста (скан) → Mac OCR.
        const pdfSrcsL = (pdfSourcesRef.current || []).filter(isPdfFile);
        const allFromPdfL = pdfSrcsL.length > 0 && prepared.length > 0 && prepared.every(f => /_p\d+\.jpg$/i.test(f.name || ''));
        const pdfTextMapL = new Map(); // baseName(lower) → {pages, hasText}
        for (const f of pdfSrcsL) {
          const ti = await getPdfPageTexts(f);
          pdfTextMapL.set((f.name || 'document').replace(/\.pdf$/i, '').toLowerCase(),
            { pages: ti.pages, hasText: ti.pages.length > 0 && ti.total >= 40 });
        }
        const textOfPage = (fname) => {
          const m = String(fname || '').match(/^(.+?)_p(\d+)\.jpg$/i);
          if (!m) return null;
          const ti = pdfTextMapL.get(m[1].toLowerCase());
          if (!ti || !ti.hasText) return null;
          const t = ti.pages[parseInt(m[2], 10) - 1];
          return t && t.trim().length >= 10 ? t : null;
        };
        const pageTextsL = prepared.map(f => textOfPage(f.name));
        const allTextLayerL = prepared.length > 0 && pageTextsL.every(Boolean);
        // Разделение ДО распознавания: несколько РАЗНЫХ документов (разные номера/даты/итоги)?
        const groupsL = allTextLayerL ? splitPagesClientText(pageTextsL) : null;
        const isMultiDocL = !!(groupsL && groupsL.length > 1);
        if (isMultiDocL) console.log(`v57.1: в PDF обнаружено ${groupsL.length} РАЗНЫХ документов — делим ДО распознавания`);
        let pdfMdOk = false;
        if (allFromPdfL && allTextLayerL && !isMultiDocL) {
          // ОДИН документ с текстовым слоем → MarkItDown на Mac (лучшее качество таблиц)
          const mdTexts = [];
          for (const f of pdfSrcsL) {
            let r = null;
            try {
              r = await fetch(`${macOcrBase()}/pdf-md?name=${encodeURIComponent(f.name || 'doc.pdf')}`, { method: 'POST', body: f });
            } catch (_) { r = null; }
            const j = r ? await r.json().catch(() => ({})) : {};
            if (!r || !r.ok || !j.text || j.text.trim().length < 40) break;
            mdTexts.push(j.text);
          }
          if (mdTexts.length && mdTexts.length === pdfSrcsL.length) {
            ocrTexts.push(...mdTexts);
            pdfMdOk = true;
            console.log('MarkItDown (Mac): текстовый слой PDF получен, OCR пропущен');
          }
        }
        if (!pdfMdOk && allTextLayerL) {
          // Текстовый слой у ВСЕХ страниц — OCR не нужен вовсе; мульти-документы делит бэкенд (v57)
          ocrTexts.push(...pageTextsL);
          textLayerOnly = true;
          console.log('v57.1: весь текст взят из текстового слоя PDF (OCR пропущен)');
        } else if (!pdfMdOk) {
          // v52.3: probe только когда реально нужен OCR (цифровые PDF обходятся без Mac-сервера)
          const macBase = macOcrBase();
          const probe = await testMacOcr(macBase);
          if (!probe.ok) {
            throw new Error(macOcrUrl
              ? `Mac OCR не отвечает (${macBase}): ${probe.detail}.\nПроверьте, что на Mac запущены И mac-ocr-server.py, И cloudflared-туннель, и что URL в ⚙ — из текущего окна туннеля (при перезапуске cloudflared адрес меняется!).`
              : `Mac OCR не отвечает (${macBase}): ${probe.detail}.\nЗапустите python3 mac-ocr-server.py. Если сервер запущен, а ошибка остаётся — браузер блокирует http://127.0.0.1 с https-страницы: поднимите туннель «cloudflared tunnel --url http://127.0.0.1:8787» и задайте его URL через ⚙.`);
          }
          for (let i = 0; i < prepared.length; i++) {
          // Смешанная пачка: страницы с текстовым слоем — из pdf.js, сканы — через Mac OCR
          if (pageTextsL[i]) { ocrTexts.push(pageTextsL[i]); continue; }
          setProgressStage('upload');
          setUploadProgress(Math.round(((i + 1) / prepared.length) * 30));
          let r;
          try {
            r = await fetch(`${macOcrBase()}/ocr?name=${encodeURIComponent(files[i].name || `page${i + 1}.jpg`)}`, { method: 'POST', body: prepared[i] });
          } catch (err) {
            throw new Error(`Mac OCR: обрыв на странице ${i + 1}/${prepared.length} (${(err && err.message) || 'сеть'}). Проверьте, что туннель и mac-ocr-server.py ещё запущены; адрес туннеля в ⚙ должен быть из текущего окна cloudflared.`);
          }
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error('Mac OCR: ' + (j.error || `HTTP ${r.status}`));
          ocrTexts.push(j.text || '');
          }
        }
        if (ocrTexts.some(t => !t || t.trim().length < 10)) {
          throw new Error('Mac OCR вернул пустой/короткий текст по странице — проверьте фото (резкость, поворот) или выберите другую модель.');
        }
        formData.append('ocr_texts', JSON.stringify(ocrTexts));
      }
      // v53.2: для Mac OCR страницы на бэкенде нужны только для хранения/показа (текст уже есть) —
      // жмём их сильнее, иначе upload 5+ тяжёлых страниц может встать на медленной сети
      const pagesToUpload = effModel === 'local-mac-ocr'
        ? await Promise.all(prepared.map(f => (isPdfFile(f) ? f : compressImageFile(f, 1600, 2400, 0.72, true).catch(() => f))))
        : prepared;
      for (const f of pagesToUpload) formData.append('pages', f);
      // v56/v57.1: вся пачка — из PDF. Текстовый слой проверяем в браузере (pdf.js) ДО распознавания:
      // у ВСЕХ PDF есть текст → исходники на MarkItDown + постраничные тексты (бэкенд делит разные
      // документы ДО распознавания); хотя бы один скан без текста → обычный vision-конвейер
      const pdfSrcsUp = (pdfSourcesRef.current || []).filter(isPdfFile);
      const allFromPdfUp = pdfSrcsUp.length > 0 && pagesToUpload.length > 0 && pagesToUpload.every(f => /_p\d+\.jpg$/i.test(f.name || ''));
      if (effModel !== 'local-mac-ocr' && allFromPdfUp) {
        const pageTextsUp = [];
        let allDigitalUp = true;
        for (const f of pdfSrcsUp) {
          const ti = await getPdfPageTexts(f);
          if (ti.pages.length && ti.total >= 40) pageTextsUp.push(...ti.pages);
          else { allDigitalUp = false; break; }
        }
        if (allDigitalUp && pageTextsUp.length === pagesToUpload.length) {
          for (const f of pdfSrcsUp) formData.append('pages', f);
          formData.append('pdf_source_names', JSON.stringify(pdfSrcsUp.map(f => f.name || 'document.pdf')));
          formData.append('pdf_page_texts', JSON.stringify(pageTextsUp)); // v57.1: деление ДО распознавания
          console.log('v57.1: у всех PDF есть текстовый слой → MarkItDown; постраничные тексты приложены для разделения');
        } else {
          console.log('v57.1: есть PDF без текстового слоя (скан) → обычный vision-конвейер');
        }
      }
      if (allowDuplicate) formData.append('allow_duplicate', '1');
      formData.append('model', textLayerOnly ? 'pdf-text-layer' : effModel);
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
      // v57: в пачке оказалось НЕСКОЛЬКО разных документов (банковские выписки и т.п.) —
      // бэкенд сохранил каждый отдельной карточкой (проверка по № документа/дате/итогу страницы)
      if (receiptData && receiptData.multiple && Array.isArray(receiptData.results) && receiptData.results.length) {
        const docsR = receiptData.results;
        docsR.forEach(d => { if (d.image_url) d.image_url = fixImageUrl(d.image_url); });
        setLastSavedReceipt(docsR[docsR.length - 1]);
        setTimeout(() => alert(`В файле обнаружено РАЗНЫХ документов: ${docsR.length}.\nКаждый сохранён ОТДЕЛЬНОЙ карточкой (перепроверка по номеру документа, дате и итогу страницы).`), 350);
      } else {
        if (receiptData.image_url) receiptData.image_url = fixImageUrl(receiptData.image_url);
        setLastSavedReceipt(receiptData);
      }
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
  // Локальное распознавание = Mac OCR (v53.1, Apple Vision на этом Mac, mac-ocr-server :8787).
  // Unlimited-OCR (llama-server :8080/8081) убран — вместо него везде Mac OCR.
  const recognizeViaMacOcr = () => {
    if (!selectedFiles.length || recognizing) return;
    // Word/текст не нуждается в OCR — текст извлекается на бэкенде, идём обычным путём
    if (selectedFiles.some(isWordFile)) {
      alert('📝 Файл Word/текста не требует OCR — распознавание выполнится из текста файла на сервере (обычная кнопка «Распознать»).');
      return recognizeAndSave();
    }
    setSelectedModel('local-mac-ocr');
    return recognizeDocumentPages(selectedFiles, 'local-mac-ocr');
  };

  const recognizeAndSave = async (fileArg, allowDuplicate = false) => {
    // v54.4: Mac OCR — ВСЕГДА через постраничный конвейер (upload-document-pages + ocr_texts):
    // upload-receipt не знает модель local-mac-ocr и молча уходит в дешёвую резервную цепочку.
    // Режим «по страницам» (separate) обрабатывает recognizeFilesSequentially ниже (там mac-ветка).
    if (selectedModel === 'local-mac-ocr' && !(fileArg instanceof File) && multiPageMode !== 'separate') {
      const files = selectedFiles.length ? selectedFiles : [selectedFiles[currentFileIndex]].filter(Boolean);
      if (files.length) return recognizeDocumentPages(files, 'local-mac-ocr', allowDuplicate);
    }
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
      // v32.4 (лучший результат по тестам): PDF → JPEG-страницы → распознаём как ОДИН документ,
      // минуя smart-классификацию (явный режим «по страницам» по-прежнему уважаем)
      if (pdfExpandedRef.current) {
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
      if (!isWordFile(file) && file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        console.log(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB), compressing...`);
        fileToUpload = await compressImageFile(file);
      }
      const formData = new FormData();
      formData.append('image', fileToUpload);
      if (allowDuplicate) formData.append('allow_duplicate', '1');
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

  // Боковая навигация «год/месяц» (v39): подсветка группы, видимой при прокрутке списка чеков
  const [activeRailGk, setActiveRailGk] = useState(null);
  useEffect(() => {
    if (activeTab !== 'list') return undefined;
    const onScroll = () => {
      const headers = document.querySelectorAll('[id^="rg-"]');
      let cur = null;
      headers.forEach(h => { if (h.getBoundingClientRect().top <= 130) cur = h.id.slice(3); });
      setActiveRailGk(prev => (prev === cur ? prev : cur));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [activeTab, currentPage, itemsPerPage]);

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
    folderStartRef.current = Date.now();
    setRecognizing(true);
    const results = [];
    // v54.4: пакетный Mac OCR — проверяем, что бэкенд принимает готовые тексты (v52+)
    if (selectedModel === 'local-mac-ocr') {
      try {
        const h = await fetch(`${API_URL}/api/health`).then(r => r.json());
        if (!h.build || h.build < 'v52') throw new Error('old');
      } catch (_) {
        alert('Бэкенд householder-api устарел и не принимает локальный OCR. Запушьте новый index.js и сделайте redeploy (в /api/health должно быть build v52+).');
        setRecognizing(false);
        setFolderProgress(prev => ({ ...prev, active: false }));
        return results;
      }
    }
    for (let i = 0; i < allFiles.length; i++) {
      const file = allFiles[i];
      setFolderProgress(prev => ({ ...prev, current: i + 1, currentFile: file.name, fileRatio: 0, retryNote: '' }));
      let lastErr = null;
      let done = false;
      // До 2 попыток на файл: разовые 502 Bad Gateway (прокси Railway) / обрывы сети самозалечиваются повтором
      for (let attempt = 1; attempt <= 2 && !done; attempt++) {
        try {
          // v54.4: Mac OCR в пакетном режиме — раньше файлы уходили на /api/upload-receipt
          // с неизвестной бэкенду моделью и молча падали в дешёвую резервную цепочку (потеря качества!)
          if (selectedModel === 'local-mac-ocr') {
            let r;
            try {
              r = await fetch(`${macOcrBase()}/ocr?name=${encodeURIComponent(file.name || 'page.jpg')}`, { method: 'POST', body: file });
            } catch (err) {
              throw new Error(`Mac OCR недоступен (${(err && err.message) || 'сеть'}) — проверьте mac-ocr-server и туннель (⚙)`);
            }
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error('Mac OCR: ' + (j.error || `HTTP ${r.status}`));
            if (!j.text || j.text.trim().length < 10) throw new Error('Mac OCR вернул пустой/короткий текст — проверьте фото (резкость, поворот)');
            const fd = new FormData();
            // на бэкенд — сжатая копия (там нужна только для хранения/показа), OCR уже сделан по оригиналу
            const up = isPdfFile(file) ? file : await compressImageFile(file, 1600, 2400, 0.72, true).catch(() => file);
            fd.append('pages', up);
            fd.append('ocr_texts', JSON.stringify([j.text]));
            fd.append('model', 'local-mac-ocr');
            fd.append('currency', currency);
            fd.append('docType', docType);
            fd.append('subtype', subtype);
            fd.append('payment_status', paymentStatus);
            fd.append('object', object);
            fd.append('token', token);
            const res = await uploadWithProgress(`${API_URL}/api/upload-document-pages?token=${token}`, fd, (ratio) => {
              setFolderProgress(prev => ({ ...prev, fileRatio: ratio * 0.5 }));
            });
            const text = res.text;
            let data;
            try { data = JSON.parse(text); } catch { throw new Error(`Сервер вернул ${res.status}: ${text.slice(0, 200)}`); }
            if (!res.ok || (!data.success && !data.id && !data.jobId)) throw new Error(data.error || `Ошибка сервера: ${res.status}`);
            const rd = data.jobId ? await pollDocJob(data.jobId) : (data.data || data);
            if (rd && rd.multiple && Array.isArray(rd.results) && rd.results.length) {
              // v57: внутри файла — несколько разных документов, каждый сохранён отдельно
              rd.results.forEach(d => {
                if (d.image_url) d.image_url = fixImageUrl(d.image_url);
                results.push({ file: file.name, status: 'success', receipt: d });
              });
            } else {
              if (rd.image_url) rd.image_url = fixImageUrl(rd.image_url);
              results.push({ file: file.name, status: 'success', receipt: rd });
            }
            setFolderProgress(prev => ({ ...prev, success: prev.success + 1, fileRatio: 1 }));
            done = true;
            continue;
          }
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
    pdfSourcesRef.current = picked.filter(isPdfFile); // v56: исходники для MarkItDown
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

  // v68.3: «Загрузить» — сначала всплывающее подтверждение, действие сразу НЕ выполняется
  const EXPORT_MODE_LABELS = { all: 'Все (Excel + Фото + Текст)', excel: 'Только Excel', photos: 'Только фото', text: 'Только текст' };
  const handleExport = () => {
    if (selectedReceiptIds.size === 0) return alert('Выберите чеки');
    setConfirmDlg({
      title: '⬇ Загрузка файлов',
      text: `Загрузить выбранные чеки: ${selectedReceiptIds.size} шт?\nРежим: ${EXPORT_MODE_LABELS[exportMode] || exportMode}\n\nВо время загрузки появится окно со статистикой и кнопкой «Остановить».`,
      yesLabel: 'Начать загрузку',
      onYes: () => doExport()
    });
  };
  const doExport = async () => {
    const selected = receipts.filter(r => selectedReceiptIds.has(r.id));
    // v68.2: окно прогресса с кнопкой «Остановить»
    exportStopRef.current = false;
    setExportProgress({ done: 0, total: selected.length, files: 0 });
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
    let doneCount = 0;
    for (const receipt of selected) {
      if (exportStopRef.current) break; // ⏹ нажали «Остановить»
      doneCount++;
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
      setExportProgress({ done: doneCount, total: selected.length, files: savedCount });
    }
    const stopped = exportStopRef.current;
    setExportProgress(null);
    if (stopped) {
      alert(`⏹ Загрузка остановлена.\nОбработано чеков: ${doneCount} из ${selected.length} · файлов сохранено: ${savedCount}`);
    } else if (useFolder) {
      alert(`✅ Экспорт завершён! Сохранено файлов/папок: ${savedCount}`);
    } else {
      alert('✅ Скачивание завершено!');
    }
  };

  // v69.7: «Загрузить ZIP» — подтверждение, затем сборка одного архива (папка на каждый чек)
  // v72: скачать полный бэкап проекта (admin): все таблицы + манифест файлов, ZIP
  const downloadBackup = async () => {
    setBackupBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/backup.zip?token=${token}`);
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
      const blob = await r.blob();
      downloadBlob(blob, `householder-backup-${new Date().toISOString().slice(0, 10)}.zip`);
    } catch (e) { alert('Бэкап не удался: ' + e.message); }
    finally { setBackupBusy(false); }
  };

  // v73: восстановление из бэкапа — читаем tables/*.json из ZIP, показываем сводку, шлём на сервер
  const handleRestoreFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const JSZip = await loadJSZip();
      const zip = await JSZip.loadAsync(file);
      const tables = {};
      const stats = [];
      for (const pth of Object.keys(zip.files)) {
        const m = pth.match(/^tables\/([a-z_]+)\.json$/);
        if (!m) continue;
        const rows = JSON.parse(await zip.files[pth].async('string'));
        if (Array.isArray(rows)) { tables[m[1]] = rows; stats.push(`${m[1]}: ${rows.length} строк`); }
      }
      if (!Object.keys(tables).length) return alert('В архиве нет tables/*.json — это не файл бэкапа проекта.');
      setConfirmDlg({
        title: '♻ Восстановление из бэкапа',
        text: `Восстановить данные из файла «${file.name}»?\n\n${stats.join('\n')}\n\nСуществующие записи будут ОБНОВЛЕНЫ, недостающие — добавлены.\nЗаписи, которых нет в бэкапе, НЕ удаляются.`,
        yesLabel: 'Восстановить',
        onYes: () => doRestore(tables)
      });
    } catch (err) { alert('Не удалось прочитать архив: ' + err.message); }
  };
  const doRestore = async (tables) => {
    setRestoreBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/restore?token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tables })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      const lines = Object.entries(j.report || {}).map(([k, v]) => `${k}: ${v}`);
      alert('♻ Восстановление завершено:\n\n' + lines.join('\n') + '\n\nСтраница будет обновлена.');
      window.location.reload();
    } catch (err) { alert('Восстановление не удалось: ' + err.message); }
    finally { setRestoreBusy(false); }
  };

  // v71: публичная ссылка на файлы выбранных чеков (принцип Dropbox)
  const handleShareReceipts = () => {
    if (selectedReceiptIds.size === 0) return alert('Выберите чеки');
    const selected = receipts.filter(r => selectedReceiptIds.has(r.id));
    const items = [];
    for (const r of selected) {
      const u = r.photo_url || r.image_url;
      if (!u) continue;
      const safeName = (r.store_name || 'receipt').replace(/[^a-zA-Z0-9Ѐ-ӿ]/g, '_').substring(0, 40);
      const ext = (u.split('.').pop().split('?')[0]) || 'jpg';
      items.push({ url: fixImageUrl(u), name: `${safeName}_${String(r.id).slice(-4)}.${ext}`, kind: 'photo' });
    }
    if (!items.length) return alert('У выбранных чеков нет файлов для ссылки');
    setShareDlg({ title: `Чеки · ${items.length} файл(ов)`, days: 30, items, busy: false, url: '', err: '' });
  };

  const handleExportZip = () => {
    if (selectedReceiptIds.size === 0) return alert('Выберите чеки');
    setConfirmDlg({
      title: '🗜 ZIP-архив',
      text: `Собрать выбранные чеки в ОДИН ZIP-файл?\nЧеков: ${selectedReceiptIds.size}\nРежим: ${EXPORT_MODE_LABELS[exportMode] || exportMode}\n\nВнутри архива — отдельная папка на каждый чек.`,
      yesLabel: 'Создать ZIP',
      onYes: () => doExportZip()
    });
  };
  const doExportZip = async () => {
    const selected = receipts.filter(r => selectedReceiptIds.has(r.id));
    exportStopRef.current = false;
    setExportProgress({ done: 0, total: selected.length, files: 0 });
    try {
      const JSZip = await loadJSZip();
      const zip = new JSZip();
      const formats = exportMode === 'all' ? ['excel', 'text', 'photo'] : [exportMode];
      const usedNames = new Set();
      let savedCount = 0;
      let doneCount = 0;
      for (const receipt of selected) {
        if (exportStopRef.current) break; // ⏹ «Остановить»
        doneCount++;
        const safeName = (receipt.store_name || 'receipt')
          .replace(/[^a-zA-Z0-9\u0400-\u04FF]/g, '_')
          .substring(0, 40);
        let folderName = `${safeName}_${String(receipt.id).slice(-4)}`;
        let dup = 2;
        while (usedNames.has(folderName)) { folderName = `${safeName}_${String(receipt.id).slice(-4)}_${dup}`; dup++; }
        usedNames.add(folderName);
        const dir = zip.folder(folderName);
        if (formats.includes('excel')) {
          try { dir.file('receipt.csv', generateReceiptCSV(receipt)); savedCount++; } catch (e) { console.error('ZIP csv:', e); }
        }
        if (formats.includes('text')) {
          const text = receipt.raw_text || receipt.recognized_text || '';
          if (text) { try { dir.file('recognized_text.txt', text); savedCount++; } catch (e) { console.error('ZIP text:', e); } }
        }
        if (formats.includes('photo')) {
          const u = receipt.photo_url || receipt.image_url;
          if (u) {
            try {
              const res = await fetch(fixImageUrl(u));
              const blob = await res.blob();
              const ext = (u.split('.').pop().split('?')[0]) || 'jpg';
              dir.file(`receipt.${ext}`, blob);
              savedCount++;
            } catch (e) { console.error('ZIP photo:', e); }
          }
        }
        setExportProgress({ done: doneCount, total: selected.length, files: savedCount });
      }
      if (exportStopRef.current) {
        setExportProgress(null);
        alert(`⏹ Сборка ZIP остановлена.\nОбработано чеков: ${doneCount} из ${selected.length} — архив НЕ создан.`);
        return;
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `checks_${stamp}_${selected.length}шт.zip`);
      setExportProgress(null);
      alert(`✅ ZIP-архив готов!\nЧеков: ${doneCount} · файлов внутри: ${savedCount}`);
    } catch (e) {
      setExportProgress(null);
      alert('Не удалось собрать ZIP: ' + e.message);
    }
  };

  // v68.3: «Удалить» — сначала всплывающее подтверждение (окно с выбором), действие сразу НЕ выполняется
  const bulkDelete = () => {
    // v68.1: защита оригиналов — если в выборке есть копии группы, её оригинал из удаления исключается
    const sel = new Set(selectedReceiptIds);
    let keptOriginals = 0;
    dupGroups.forEach(g => {
      const orig = g[0];
      const anyCopySelected = g.slice(1).some(r => sel.has(r.id));
      if (anyCopySelected && sel.has(orig.id)) { sel.delete(orig.id); keptOriginals++; }
    });
    if (!sel.size) { alert('Удалять нечего: оригиналы сохранены.'); return; }
    setConfirmDlg({
      title: '🗑 Удаление чеков',
      text: `Удалить ${sel.size} чеков? Действие необратимое.` + (keptOriginals ? `\n\n🛡 Оригиналы (${keptOriginals}) будут сохранены — удаляются только копии.` : ''),
      yesLabel: `Удалить ${sel.size}`,
      danger: true,
      onYes: () => doBulkDelete(sel)
    });
  };
  const doBulkDelete = async (sel) => {
    try {
      const res = await fetch(`${API_URL}/api/bulk-delete?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(sel) })
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

  // v67.9.4: удалить ручной платёж (выписка — главный документ, ручных строк быть не должно)
  const deleteManualMvt = async (m) => {
    if (!window.confirm(`Удалить ручной платёж «${m.counterparty || m.concept || ''}» ${formatAmount(Math.abs(Number(m.amount) || 0), 'EUR')} от ${m.operation_date ? formatDate(m.operation_date) : '—'}?\nФактура останется, привязка будет снята. Строки банковской выписки это не затрагивает.`)) return;
    try {
      let res = await fetch(`${API_URL}/api/bank-movements/manual/${m.id}?token=${token}`, { method: 'DELETE' });
      if (res.status === 404 || res.status === 405) {
        // v68.0.1: старый API без DELETE — удаляем через unlink (сервер v67.9.5+ удаляет ручные строки целиком)
        res = await fetch(`${API_URL}/api/unlink-bank-movement?token=${token}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ movement_id: m.id })
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const mvts = await loadBankMovements();
      await loadReceipts();
      // Проверяем факт удаления — если строка на месте, сервер старый (нужен redeploy householder-api)
      if (mvts && mvts.some(x => String(x.id) === String(m.id))) {
        alert('⚠ Строка НЕ удалена на сервере. Переложите householder-api (redeploy до v67.9.5+) и повторите.');
      }
    } catch (e) { alert('Не удалось удалить ручной платёж: ' + e.message); }
  };

  // v67.9: переход во вкладку «Налоги» к конкретной строке платежа (подсветка + прокрутка)
  const gotoTaxesMovement = (mvId, opDate) => {
    if (!mvId) return;
    if (opDate && /^\d{4}-\d{2}-\d{2}/.test(opDate)) {
      const y = opDate.slice(0, 4);
      const q = Math.floor((parseInt(opDate.slice(5, 7), 10) - 1) / 3) + 1;
      setTaxQFrom(`${y}-${q}T`); setTaxQTo(`${y}-${q}T`);
    }
    setQBankChip(null); setQCpSearch(''); setQSelFilter('all');
    setHlMvtId(String(mvId));
    setActiveTab('taxes');
    setTimeout(() => {
      const el = document.getElementById(`mvt-row-${mvId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 700);
    setTimeout(() => setHlMvtId(null), 8000);
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
  const loadBankMovements = useCallback(async () => {
    setBankLoading(true);
    try {
      // v67.3: таймаут 20с — раньше при зависшем запросе спиннер «Загрузка движений…» крутился бесконечно
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(`${API_URL}/api/bank-movements?token=${token}`, { signal: controller.signal });
      clearTimeout(timeout);
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setBankMovements(data.movements || []); return data.movements || []; }
      else console.error('bank-movements:', data.error);
      return null;
    } catch (e) { console.error(e); return null; }
    finally { setBankLoading(false); }
  }, [token]);

  // v67.9 fix: движения банка грузим сразу при входе — метка «привязан к банку» есть на карточках чеков
  useEffect(() => {
    if (user && token) loadBankMovements();
  }, [user, token, loadBankMovements]);

  // Плановые платежи (v41): ручные записи календаря обязательных платежей
  const loadPlannedPayments = async () => {
    try {
      const res = await fetch(`${API_URL}/api/planned-payments?token=${token}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setPlannedPayments(data.items || []);
      else console.error('planned-payments:', data.error);
    } catch (e) { console.error(e); }
  };
  // Загрузка файла фактуры для планового платежа (v46)
  const uploadPlannedFile = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(`${API_URL}/api/planned-payments/upload?token=${token}`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPlannedForm(f => ({ ...f, fileUrl: data.url, fileName: data.name || file.name }));
    } catch (e) { alert('Фактура не загрузилась: ' + e.message); }
  };
  const savePlannedPayment = async () => {
    if (!plannedForm.title.trim()) { alert('Введите название платежа'); return; }
    setPlannedSaving(true);
    try {
      const cp = plannedForm.counterparty.trim();
      const title = plannedForm.object ? `${plannedForm.object} — ${cp || plannedForm.title.trim()}` : plannedForm.title.trim();
      const res = await fetch(`${API_URL}/api/planned-payments?token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          category: plannedForm.category,
          amount: plannedForm.amount !== '' ? Number(plannedForm.amount) : null,
          day_of_month: parseInt(plannedForm.day, 10) || 1,
          freq_months: parseInt(plannedForm.freq, 10) || 1,
          counterparty: cp,
          object_name: plannedForm.object || null,
          file_url: plannedForm.fileUrl || null,
          file_name: plannedForm.fileName || null,
          start_date: (() => { const nd = new Date(); return `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-01`; })()
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPlannedPayments(prev => [...prev, data.item].sort((a, b) => (a.dayOfMonth || 1) - (b.dayOfMonth || 1)));
      setPlannedModal(false);
      setPlannedForm({ title: '', amount: '', day: '1', category: 'utilities', freq: '1', object: '', counterparty: '', fileUrl: '', fileName: '' });
    } catch (e) { alert('Не сохранилось: ' + e.message); }
    finally { setPlannedSaving(false); }
  };
  // Активна/неактивна (v49): неактивный платёж остаётся в списке, но не идёт в календарь/таймлайн
  const togglePlannedPayment = async (g) => {
    try {
      const res = await fetch(`${API_URL}/api/planned-payments/${g.id}/toggle?token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !g.active })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPlannedPayments(prev => prev.map(x => String(x.id) === String(g.id) ? data.item : x));
    } catch (e) { alert('Не переключилось: ' + e.message); }
  };
  const removePlannedPayment = async (id) => {
    if (!window.confirm('Удалить этот плановый платёж?')) return;
    try {
      const res = await fetch(`${API_URL}/api/planned-payments/${id}?token=${token}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `HTTP ${res.status}`); }
      setPlannedPayments(prev => prev.filter(p => String(p.id) !== String(id)));
    } catch (e) { alert('Не удалилось: ' + e.message); }
  };
  // Сброс выбора (v44.1): удалить из календаря все плановые платежи этого контрагента
  const resetCalendarChoice = async (m) => {
    setCalPicker(null);
    const norm = (v) => String(v || '').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim().slice(0, 40);
    const key = norm(m.counterparty) || norm(m.concept);
    const doomed = plannedPayments.filter(pp => norm(pp.counterparty) && norm(pp.counterparty) === key);
    if (!doomed.length) { alert('Этот платёж не добавлен в календарь'); return; }
    if (!window.confirm(`Убрать из календаря: ${doomed.map(pp => pp.title).join(', ')}?`)) return;
    for (const pp of doomed) {
      try {
        await fetch(`${API_URL}/api/planned-payments/${pp.id}?token=${token}`, { method: 'DELETE' });
        setPlannedPayments(prev => prev.filter(x => String(x.id) !== String(pp.id)));
      } catch (e) { console.error(e); }
    }
  };
  // Привязка платежа из строки выписки к календарю (v44): имя + частота (1/2/6/12 мес)
  const assignToCalendar = async (m, name, freqMonths) => {
    setCalPicker(null);
    try {
      const res = await fetch(`${API_URL}/api/planned-payments?token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${name} — ${m.counterparty || m.concept || 'платёж'}`,
          category: 'other',
          amount: Math.abs(Number(m.amount) || 0),
          day_of_month: m.operation_date ? +m.operation_date.slice(8, 10) : 1,
          freq_months: freqMonths,
          counterparty: m.counterparty || m.concept || '',
          object_name: name,
          start_date: m.operation_date || null
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.item && data.item.freqMonths == null) {
        let buildInfo = '';
        try {
          const h = await fetch(`${API_URL}/api/health`).then(r => r.json());
          buildInfo = h.build ? `Сервер: ${h.build}` : 'Сервер: СТАРАЯ версия (без метки сборки) — новый index.js не задеплоен!';
        } catch (_) { buildInfo = 'Не удалось проверить версию сервера'; }
        alert('⚠️ Сервер не сохранил частоту — платёж станет ежемесячным.\n\n' + buildInfo + '\n\nЧто сделать:\n1) Закоммитьте и запушьте новый index.js в git-репозиторий householder-api (Railway «Redeploy» пересобирает СТАРЫЙ коммит — без push кода ничего не изменится);\n2) Выполните supabase-migration-v27-planned-freq.sql в SQL Editor проекта householder;\n3) Redeploy householder-api.');
      }
      setPlannedPayments(prev => [...prev, data.item]);
    } catch (e) { alert('Не сохранилось в календарь: ' + e.message); }
  };

  // v60: Импорт выписок банка (.xlsx Ruralvía) — можно СРАЗУ НЕСКОЛЬКО файлов.
  // Каждая выписка сравнивается с базой и с остальными файлами пачки: дубликаты пропускаются,
  // отчёт по каждому файлу (новые/дубли/автопривязка) показывается панелью под кнопками.
  const [bankImportReport, setBankImportReport] = useState(null); // {totals, files:[…]}
  const handleStatementSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setLoading(true);
    setBankImportReport(null);
    try {
      const formData = new FormData();
      files.forEach(f => formData.append('statements', f));
      const res = await fetch(`${API_URL}/api/import-bank-statements?token=${token}`, { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // fallback: старый сервер без multi-endpoint — грузим по одному через старый маршрут
        if (res.status === 404 && files.length) {
          const results = [];
          for (const f of files) {
            try {
              const fd1 = new FormData();
              fd1.append('statement', f);
              const r1 = await fetch(`${API_URL}/api/import-bank-statement?token=${token}`, { method: 'POST', body: fd1 });
              const d1 = await r1.json().catch(() => ({}));
              if (!r1.ok) throw new Error(d1.error || `HTTP ${r1.status}`);
              results.push({ name: f.name, ...d1 });
            } catch (e1) { results.push({ name: f.name, error: e1.message }); }
          }
          const ok = results.filter(r => !r.error);
          setBankImportReport({
            totals: { files: ok.length, imported: ok.reduce((a, r) => a + (r.imported || 0), 0), skipped: ok.reduce((a, r) => a + (r.skipped || 0), 0), autoMatched: ok.reduce((a, r) => a + (r.autoMatched || 0), 0) },
            files: results
          });
        } else throw new Error(data.error || `HTTP ${res.status}`);
      } else {
        setBankImportReport({ totals: data.totals, files: data.files || [] });
      }
      loadReceipts(); // статусы оплаты привязанных фактур изменились на «Оплачено»
      loadBankMovements();
    } catch (err) {
      alert('Ошибка импорта выписки: ' + err.message);
    } finally { setLoading(false); }
  };

  // v60.1: клик по контрагенту в строке → фильтр выписки (чип «Контрагент» + поисковая строка)
  const applyBankCpFilter = (cp) => {
    const v = String(cp || '').trim();
    if (!v) return;
    setBankCpFilter([v]);
    setBankSearch(v);
    setBankDateFrom(''); setBankDateTo('');
    setBankListCollapsed(false);
    setActiveTab('analysis');
  };
  const [qCpSearch, setQCpSearch] = useState(''); // v60.1: фильтр по контрагенту в блоке «Платежи из банка» (Налоги)
  const [hlMvtId, setHlMvtId] = useState(null); // v67.8: подсветка строки платежа после перехода из карточки фактуры
  // v63: слоты запоминания выбранных платежей (1..5) — сохранить выбор / вывести сохранённый (localStorage)
  const [pmSelected, setPmSelected] = useState({}); // id → true (текущий выбор галками в строках)
  const [pmSlots, setPmSlots] = useState(() => { try { return JSON.parse(localStorage.getItem('bankPaySlots') || '{}'); } catch { return {}; } });
  const [pmSlotView, setPmSlotView] = useState(null); // номер активного слота (1..5) или null
  const [pmSlotArmRaw, setPmSlotArmRaw] = useState(() => { const v = parseInt(localStorage.getItem('bankPaySlotArm') || ''); return v >= 1 && v <= 5 ? v : null; }); // v65.1: активный вариант ЗАПОМИНАЕТСЯ — автодобавление работает всегда
  const pmSlotArm = pmSlotArmRaw;
  const setPmSlotArm = (n) => { setPmSlotArmRaw(n); try { if (n) localStorage.setItem('bankPaySlotArm', String(n)); else localStorage.removeItem('bankPaySlotArm'); } catch { /* noop */ } };
  // v64.1: фильтры по каждому столбцу (дата / контрагент=qCpSearch / сумма от-до)
  const [qDateFilter, setQDateFilter] = useState('');
  const [qAmtMin, setQAmtMin] = useState('');
  const [qAmtMax, setQAmtMax] = useState('');
  const [qCpSortAsc, setQCpSortAsc] = useState(true); // v64.3: А→Я (true) / Я→А (false)
  const [qSelFilter, setQSelFilter] = useState('all'); // v65: фильтр по галке выбора: all | sel | unsel
  const [qBankChip, setQBankChip] = useState(null); // v67.4: фильтр по плашкам статистики: null | linked | nolink | unpaid
  const pmSlotHas = (n, id) => (pmSlots[String(n)] || []).includes(String(id));
  const pmSlotToggle = (n, id, on) => savePmSlots(prev => {
    const cur = new Set(prev[String(n)] || []);
    if (on) cur.add(String(id)); else cur.delete(String(id));
    return { ...prev, [String(n)]: [...cur] };
  });
  const savePmSlots = (updater) => setPmSlots(prev => { const nx = typeof updater === 'function' ? updater(prev) : updater; try { localStorage.setItem('bankPaySlots', JSON.stringify(nx)); } catch { /* noop */ } return nx; });

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
      const mvts = await loadBankMovements();
      await loadReceipts();
      if (data.deleted) alert('✍ Ручной платёж удалён полностью (его не было в банковской выписке). Фактура осталась в списке чеков.');
      else if (mvts && mvts.some(x => String(x.id) === String(movementId) && (x.prefix === 'manual' || x.account_name === 'Ручное добавление'))) {
        alert('⚠ Ручная строка осталась на сервере — переложите householder-api (redeploy до v67.9.5+), тогда отвязка будет удалять её целиком.');
      }
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
      // v67.3: сначала перезагружаем данные, потом alert (Safari блокирует JS на alert — выглядело как «зависло»)
      const mvts = await loadBankMovements();
      await loadReceipts();
      alert(`🔁 Автопривязка выполнена\n\n✅ Новых совпадений: ${data.autoMatched}\n⚪ Осталось без пары: ${data.unmatchedPayments}` + (mvts === null ? '\n\n⚠ Движения не перезагрузились (таймаут/сервер) — нажмите «🔄 Обновить»' : ''));
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

  // v60.2: массово отметить/снять «есть фактура» для списка платежей (одним запросом)
  const bulkInvoiceFlag = async (list, nv) => {
    const ids = list.filter(m => !!m.has_invoice !== nv).map(m => m.id);
    if (!ids.length) return;
    if (!window.confirm(nv ? `Отметить «есть фактура» у ${ids.length} платежей?` : `Снять галку «есть фактура» у ${ids.length} платежей?`)) return;
    setBankMovements(prev => prev.map(x => ids.includes(x.id) ? { ...x, has_invoice: nv } : x));
    const rollback = () => setBankMovements(prev => prev.map(x => ids.includes(x.id) ? { ...x, has_invoice: !nv } : x));
    try {
      const res = await fetch(`${API_URL}/api/bank-movement-invoice-flag?token=${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ movement_ids: ids, has_invoice: nv })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // v60.3: старый сервер без bulk — шлём по одному платежу (старый формат movement_id)
        if (res.status === 400 || res.status === 404 || res.status === 500) {
          let failed = 0;
          for (const id of ids) {
            try {
              const r1 = await fetch(`${API_URL}/api/bank-movement-invoice-flag?token=${token}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ movement_id: id, has_invoice: nv })
              });
              if (!r1.ok) failed++;
            } catch (e1) { failed++; }
          }
          if (failed) { rollback(); throw new Error(`не сохранилось ${failed} из ${ids.length} — обновите householder-api (redeploy)`); }
          return;
        }
        throw new Error(data.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      rollback();
      alert('Массовая отметка не сохранилась: ' + err.message);
    }
  };

  // v62.1: ОБЯЗАТЕЛЬНЫЕ платежи = подтверждённые расходы БЕЗ фактуры (прямой вычет из прибыли):
  // налоги (AEAT/ATC/Hacienda: IGIC 420, IRPF 111/115, IS 200/202…), Tesorería/Seguridad Social,
  // cuota de autónomos, mutua, зарплаты (nómina/salario). Такие платежи НЕ требуют галки «есть фактура».
  const AUTO_DEDUCT_RE = /seg\s*gr?al|seguridad\s+social|tgss|tesorer[ií]a|tes\.?\s*gral|agencia\s+tributaria|a\.?e\.?a\.?t|hacienda|tributos?|a\.?t\.?c\b|impuesto|modelo\s*\d|igic|irpf|\bis\b.*sociedad|aut[óo]nomo|mutua|n[óo]mina|salario|sueldo|payroll|cotizaci/i;
  const autoDeductOf = (m) => AUTO_DEDUCT_RE.test(String(m.counterparty || '') + ' ' + String(m.concept || ''));
  const isConfirmedExpense = (m) => !!(m.has_invoice || m.matched_receipt_id) || autoDeductOf(m);
  // v67: схожесть названий контрагент/магазин (доля общих слов) — для рекомендаций привязки
  const nameTokens = (t) => String(t || '').toLowerCase().replace(/[^a-zа-яё0-9\s]/gi, ' ').split(/\s+/).filter(w => w.length >= 3);
  const nameSim = (a, b) => {
    const ta = new Set(nameTokens(a)), tb = new Set(nameTokens(b));
    if (!ta.size || !tb.size) return 0;
    let inter = 0; ta.forEach(w => { if (tb.has(w)) inter++; });
    return inter / Math.max(ta.size, tb.size);
  };

  // v67.1: модалка привязки платежа к фактуре — ОБЩАЯ для вкладок «Анализ» и «Налоги»
  // v67.2: ленивый рендер через функцию — иначе const-IIFE выполнялся до объявления formatAmount/formatDate (TDZ -> белый экран)
  const renderLinkPicker = () => {
    if (!linkPicker) return null;
    return (() => {
                  const mvAmt = Math.abs(Number(linkPicker.amount) || 0);
                  const lq = linkSearch.trim().toLowerCase();
                  const mvName = `${linkPicker.counterparty || ''} ${linkPicker.concept || ''}`;
                  // v67: скоринг кандидатов — по НАЗВАНИЮ и по СУММЕ (сумма может не совпадать: показываем Δ)
                  const scored = receipts
                    .filter(r => !lq || [r.store_name, r.store_name_ru, r.provider, r.invoice_number, r.contract_number, r.total_amount]
                      .some(v => String(v == null ? '' : v).toLowerCase().includes(lq)))
                    .map(r => {
                      const rAmt = Math.abs(Number(r.total_amount) || 0);
                      const diff = Math.abs(rAmt - mvAmt);
                      const exact = diff < 0.01;
                      const sim = Math.max(nameSim(mvName, r.store_name), nameSim(mvName, r.store_name_ru), nameSim(mvName, r.provider));
                      const score = (exact ? 100 : 0) + Math.round(sim * 100) + (diff <= Math.max(1, mvAmt * 0.02) ? 40 : diff <= Math.max(5, mvAmt * 0.1) ? 20 : 0) - (r.payment_status === 'paid' ? 15 : 0);
                      return { r, exact, sim, diff, score };
                    })
                    .sort((a, b) => b.score - a.score);
                  const recommended = scored.filter(c => c.exact || c.sim >= 0.34 || c.score >= 60).slice(0, 5);
                  const recIds = new Set(recommended.map(c => c.r.id));
                  const candidates = scored.filter(c => !recIds.has(c.r.id)).slice(0, 50);
                  // Привязка с несовпадающей суммой — с пометкой: оставить или отвязать
                  const linkWithCheck = async (receipt, exact, diff) => {
                    if (!exact) {
                      const ok = window.confirm(`⚠ Сумма НЕ совпадает:\nплатёж ${formatAmount(mvAmt, 'EUR')} ≠ фактура ${formatAmount(receipt.total_amount, receipt.currency || 'EUR')}\nразница Δ ${formatAmount(diff, 'EUR')}\n\nПривязать с пометкой о разнице? (OK — оставить привязку, Отмена — не привязывать)`);
                      if (!ok) return;
                    }
                    await linkMovement(linkPicker.id, receipt.id);
                  };
                  const rowOf = ({ r, exact, sim, diff }) => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 8, marginBottom: 4, background: exact ? '#e4f7e9' : '#fafafa', border: exact ? '1px solid #27ae60' : '1px solid #eee' }}>
                      <span style={{ flex: '1 1 auto', minWidth: 0, overflowWrap: 'break-word', fontSize: 14 }}>
                        <b>{r.store_name || r.store_name_ru || 'Без названия'}</b>
                        {exact && <span style={{ marginLeft: 6, fontSize: 11, color: '#27ae60', fontWeight: 700 }}>сумма совпадает</span>}
                        {!exact && <span style={{ marginLeft: 6, fontSize: 11, color: '#e67e22', fontWeight: 700 }}>Δ {formatAmount(diff, 'EUR')}</span>}
                        {sim >= 0.34 && <span style={{ marginLeft: 6, fontSize: 11, color: '#2471a3', fontWeight: 700 }}>похоже по названию</span>}
                        <span style={{ marginLeft: 8, fontSize: 12, color: '#7f8c8d' }}>{formatDate(r.receipt_date)}</span>
                        {r.payment_status && PAYMENT_STATUS_META[r.payment_status] && (
                          <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: PAYMENT_STATUS_META[r.payment_status].color }}>{PAYMENT_STATUS_META[r.payment_status].short} {PAYMENT_STATUS_META[r.payment_status].label}</span>
                        )}
                      </span>
                      <span style={{ flex: '0 0 auto', fontWeight: 700, fontSize: 13 }}>{formatAmount(r.total_amount, r.currency || 'EUR')}</span>
                      <button disabled={linkSaving} onClick={() => linkWithCheck(r, exact, diff)} style={{ flex: '0 0 auto', border: 'none', background: exact ? '#27ae60' : '#e67e22', color: '#fff', borderRadius: 8, padding: '5px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                        {linkSaving ? '…' : exact ? 'Привязать' : 'Привязать с Δ'}
                      </button>
                    </div>
                  );
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
                        {recommended.length > 0 && (
                          <div style={{ border: '1px solid #f0c36d', background: '#fffaf0', borderRadius: 10, padding: '8px 8px 2px', marginBottom: 10 }}>
                            <div style={{ fontSize: 12, fontWeight: 800, color: '#b9770e', marginBottom: 6 }}>⭐ Рекомендации — по названию и по сумме:</div>
                            {recommended.map(rowOf)}
                          </div>
                        )}
                        {candidates.length === 0 && recommended.length === 0 && <p style={{ color: '#95a5a6' }}>Фактуры не найдены.</p>}
                        {candidates.length > 0 && <div style={{ fontSize: 12, color: '#8e8e93', margin: '4px 0 6px' }}>Все фактуры:</div>}
                        {candidates.map(rowOf)}
                        <button onClick={() => setLinkPicker(null)} disabled={linkSaving} style={{ marginTop: 10, width: '100%', padding: '8px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}>Отмена</button>
                      </div>
                    </div>
                  );
    })();
  };

  // v68: привязка ИЗ КАРТОЧКИ фактуры к СУЩЕСТВУЮЩЕМУ платежу выписки (строки в выписке НЕ создаются!)
  // Логика зеркальна привязке из выписки: те же скоринги (сумма, название, дата) и Δ-подтверждение.
  const renderRcLinkPicker = () => {
    if (!rcLinkPicker) return null;
    const rAmt = Math.abs(Number(rcLinkPicker.total_amount) || 0);
    const lq = rcLinkSearch.trim().toLowerCase();
    const rName = `${rcLinkPicker.store_name || ''} ${rcLinkPicker.store_name_ru || ''} ${rcLinkPicker.provider || ''}`;
    const scored = bankMovements
      .filter(m => Number(m.amount) < 0 && !m.matched_receipt_id && m.prefix !== 'manual' && m.account_name !== 'Ручное добавление')
      .filter(m => !lq || [m.counterparty, m.concept, m.operation_date, String(Math.abs(Number(m.amount) || 0))]
        .some(v => String(v == null ? '' : v).toLowerCase().includes(lq)))
      .map(m => {
        const mvAmt = Math.abs(Number(m.amount) || 0);
        const diff = Math.abs(mvAmt - rAmt);
        const exact = diff < 0.01;
        const sim = nameSim(`${m.counterparty || ''} ${m.concept || ''}`, rName);
        let dateBonus = 0;
        if (m.operation_date && rcLinkPicker.receipt_date) {
          const days = Math.round((new Date(m.operation_date) - new Date(rcLinkPicker.receipt_date)) / 86400000);
          if (days >= -2 && days <= 45) dateBonus = 15; else if (days >= -7 && days <= 75) dateBonus = 8;
        }
        const score = (exact ? 100 : 0) + Math.round(sim * 100) + (diff <= Math.max(1, rAmt * 0.02) ? 40 : diff <= Math.max(5, rAmt * 0.1) ? 20 : 0) + dateBonus;
        return { m, exact, sim, diff, score };
      })
      .sort((a, b) => b.score - a.score);
    const recommended = scored.filter(c => c.exact || c.sim >= 0.34 || c.score >= 60).slice(0, 5);
    const recIds = new Set(recommended.map(c => c.m.id));
    const candidates = scored.filter(c => !recIds.has(c.m.id)).slice(0, 50);
    const linkWithCheck = async (mv, exact, diff) => {
      if (!exact) {
        const ok = window.confirm(`⚠ Сумма НЕ совпадает:\nплатёж ${formatAmount(Math.abs(Number(mv.amount) || 0), 'EUR')} ≠ фактура ${formatAmount(rcLinkPicker.total_amount, rcLinkPicker.currency || 'EUR')}\nразница Δ ${formatAmount(diff, 'EUR')}\n\nПривязать с пометкой о разнице? (OK — оставить привязку, Отмена — не привязывать)`);
        if (!ok) return;
      }
      await linkMovement(mv.id, rcLinkPicker.id);
      setRcLinkPicker(null);
    };
    const rowOf = ({ m, exact, sim, diff }) => (
      <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 8, marginBottom: 4, background: exact ? '#e4f7e9' : '#fafafa', border: exact ? '1px solid #27ae60' : '1px solid #eee' }}>
        <span style={{ flex: '1 1 auto', minWidth: 0, overflowWrap: 'break-word', fontSize: 14 }}>
          <b>{m.counterparty || m.concept || '—'}</b>
          {exact && <span style={{ marginLeft: 6, fontSize: 11, color: '#27ae60', fontWeight: 700 }}>сумма совпадает</span>}
          {!exact && <span style={{ marginLeft: 6, fontSize: 11, color: '#e67e22', fontWeight: 700 }}>Δ {formatAmount(diff, 'EUR')}</span>}
          {sim >= 0.34 && <span style={{ marginLeft: 6, fontSize: 11, color: '#2471a3', fontWeight: 700 }}>похоже по названию</span>}
          <span style={{ marginLeft: 8, fontSize: 12, color: '#7f8c8d' }}>{formatDate(m.operation_date)}</span>
        </span>
        <span style={{ flex: '0 0 auto', fontWeight: 700, fontSize: 13 }}>{formatAmount(Math.abs(Number(m.amount) || 0), 'EUR')}</span>
        <button disabled={linkSaving} onClick={() => linkWithCheck(m, exact, diff)} style={{ flex: '0 0 auto', border: 'none', background: exact ? '#27ae60' : '#e67e22', color: '#fff', borderRadius: 8, padding: '5px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
          {linkSaving ? '…' : exact ? 'Привязать' : 'Привязать с Δ'}
        </button>
      </div>
    );
    return (
      <div className="modal-overlay" onClick={() => !linkSaving && setRcLinkPicker(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 18, width: '100%', maxWidth: 560, maxHeight: '80vh', overflowY: 'auto' }}>
          <h3 style={{ marginTop: 0 }}>🔗 Привязать фактуру к платежу из выписки</h3>
          <div style={{ background: '#f4f6f7', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 13 }}>
            <b>{rcLinkPicker.store_name || rcLinkPicker.store_name_ru || 'Без названия'}</b><br />
            {formatDate(rcLinkPicker.receipt_date)} · <b>{formatAmount(rcLinkPicker.total_amount, rcLinkPicker.currency || 'EUR')}</b>
            <div style={{ fontSize: 12, color: '#7f8c8d', marginTop: 4 }}>
              Выбирается ТОЛЬКО существующий платёж банковской выписки — новые строки в выписке не создаются. Если платежа в банке нет — фактура остаётся «счёт без платежа».
            </div>
          </div>
          <input autoFocus value={rcLinkSearch} onChange={e => setRcLinkSearch(e.target.value)} placeholder="Поиск платежа: контрагент, концепт, дата, сумма…" style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 6, border: '1px solid #ddd', marginBottom: 10 }} />
          {recommended.length > 0 && (
            <div style={{ border: '1px solid #f0c36d', background: '#fffaf0', borderRadius: 10, padding: '8px 8px 2px', marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#b9770e', marginBottom: 6 }}>⭐ Рекомендации — по названию и по сумме:</div>
              {recommended.map(rowOf)}
            </div>
          )}
          {candidates.length === 0 && recommended.length === 0 && <p style={{ color: '#95a5a6' }}>Свободных платежей не найдено.</p>}
          {candidates.length > 0 && <div style={{ fontSize: 12, color: '#8e8e93', margin: '4px 0 6px' }}>Все свободные платежи выписки:</div>}
          {candidates.map(rowOf)}
          <button onClick={() => setRcLinkPicker(null)} disabled={linkSaving} style={{ marginTop: 10, width: '100%', padding: '8px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}>Отмена</button>
        </div>
      </div>
    );
  };

  // Вид авто-вычета для бейджа в строке платежа (v62.1)
  const autoDeductKind = (m) => {
    const t = (String(m.counterparty || '') + ' ' + String(m.concept || '')).toLowerCase();
    if (!autoDeductOf(m)) return null;
    if (/seg\s*gr?al|seguridad\s+social|tgss|tesorer|tes\.?\s*gral/.test(t)) return { icon: '🛡', label: 'Seguridad Social', color: '#1e8449' };
    if (/n[óo]mina|salario|sueldo|payroll/.test(t)) return { icon: '💼', label: 'зарплата', color: '#2471a3' };
    if (/mutua|aut[óo]nomo/.test(t)) return { icon: '👤', label: 'autónomo/mutua', color: '#7d3c98' };
    return { icon: '🏛', label: 'налог', color: '#b03a2e' };
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
      const outInv = outAll.filter(isConfirmedExpense); // v62.1: включая авто-вычеты (налоги/соцстрах/зарплаты)
      const sum = (arr) => arr.reduce((s, m) => s + Math.abs(Number(m.amount) || 0), 0);
      const linked = outInv.map(m => receipts.find(r => String(r.id) === String(m.matched_receipt_id))).filter(Boolean);
      // v61.2: cuota/base deducible — по КАЖДОЙ привязанной фактуре: её tax_amount, а если не распознан —
      // IGIC выделяем из суммы фактуры (×7/107). Раньше фактуры без tax_amount в вычет НЕ попадали вообще.
      let igicFromR = 0, baseDedNet = 0;
      linked.forEach(r => {
        const tot = Math.abs(parseFloat(r.total_amount) || 0);
        let tax = Math.abs(parseFloat(r.tax_amount) || 0);
        if (!(tax > 0) && tot > 0) tax = tot * 7 / 107;
        igicFromR += tax;
        baseDedNet += Math.max(0, tot - tax);
      });
      // v63.2 FIX: подтверждённые платежи БЕЗ привязанной фактуры (галка «есть фактура» или авто-вычет)
      // тоже идут в вычет ПО КАЖДОМУ платежу (IGIC 7/107, база /1.07) — раньше учитывались только когда
      // привязанных фактур не было вообще, поэтому налоги НЕ пересчитывались при смене галок.
      outInv.forEach(m => {
        if (m.matched_receipt_id) return; // уже учтён через фактуру выше
        const amt = Math.abs(Number(m.amount) || 0);
        igicFromR += amt * 7 / 107;
        baseDedNet += amt / 1.07;
      });
      const outInvSum = sum(outInv);
      return { ingresos: sum(inc), gastos: outInvSum, igicSop: igicFromR, baseDedNet, incCount: inc.length, outCount: outAll.length, outInvCount: outInv.length };
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
    // v62: Impuesto de Sociedades (налог на прибыль SL). Ставка: 25% общая; PYME (оборот < 10 млн) — 24% с 2025, микро (< 1 млн) — 21/22%.
    // Авансы — modelo 202 (20 апр/окт/дек), годовой расчёт — modelo 200 (до 25 июля след. года). Переопределяется полем isRate.
    const isRate = overrides.isRate != null ? overrides.isRate : 25;
    const r2 = n => Math.round(n * 100) / 100;
    const today0 = new Date().setHours(0, 0, 0, 0);
    // v61: пересчёт строго по ОФИЦИАЛЬНЫМ формам из поданных деклараций ISERA 2020, SL:
    //   Modelo 420 (ATC):  01 base devengada · 02 tipo · 03 cuota devengada · 25 total devengado
    //                      26 base deducible · 27 cuota deducible · 40 total deducible
    //                      41 diferencia (25−40) · 43 cuotas a compensar de períodos anteriores · 45 resultado (41+42−43−44)
    //   Modelo 111 (AEAT): 02 percepciones trabajo · 03 retenciones trabajo · 08 percepciones act. econ. · 09 retenciones act.
    //                      28 suma retenciones · 30 resultado a ingresar (= 28). ISERA — SL: modelo 130 НЕ подаётся.
    // Выписка банка — суммы БРУТТО (с IGIC), базы в форме — НЕТТО: base = bruto / (1 + tipo).
    let igicCompCarry = 0; // «a compensar» из прошлых кварталов → casilla 43 следующего
    const quarters = list.map(({ y, q }) => {
      const { from, to, quarter, cum } = taxQuarterSums(y, q, src);
      // ── MODELO 420 ──
      const ingresosBrutos = r2(quarter.ingresos);
      const baseDev = overrides[`ingresos_${y}_${q}`] != null ? overrides[`ingresos_${y}_${q}`] : r2(ingresosBrutos / (1 + rate / 100)); // casilla 01 (нетто)
      const cuotaDev = r2(baseDev * rate / 100);                                  // casilla 03 = casilla 25
      const gastosBrutos = r2(quarter.gastos);
      const baseDed = overrides[`gastos_${y}_${q}`] != null ? overrides[`gastos_${y}_${q}`] : r2(quarter.baseDedNet != null ? quarter.baseDedNet : gastosBrutos / (1 + rate / 100)); // casilla 26 (нетто, по фактурам — v61.2)
      const cuotaDed = overrides[`igicSop_${y}_${q}`] != null ? overrides[`igicSop_${y}_${q}`] : r2(quarter.igicSop); // casilla 27 = casilla 40 (из tax_amount фактур)
      const dif41 = r2(cuotaDev - cuotaDed);                                      // casilla 41
      const comp43 = r2(igicCompCarry);                                           // casilla 43
      const result420 = r2(dif41 - comp43);                                       // casilla 45
      igicCompCarry = result420 < 0 ? Math.abs(result420) : 0;                    // отрицательный итог → a compensar дальше
      // Совместимость полей (UI/текст):
      const ingresos = baseDev, gastos = baseDed, igicSoportado = cuotaDed, igicRepercutido = cuotaDev;
      // ── MODELO 111 (retenciones IRPF; из выписки не выводится — вручную по платёжным ведомостям) ──
      const numTrab = overrides[`numTrab_${y}_${q}`] != null ? overrides[`numTrab_${y}_${q}`] : 0;     // casilla 01 (v61.1)
      const percTrab = overrides[`percTrab_${y}_${q}`] != null ? overrides[`percTrab_${y}_${q}`] : 0;  // casilla 02
      const retTrab = overrides[`retTrab_${y}_${q}`] != null ? overrides[`retTrab_${y}_${q}`] : 0;     // casilla 03
      const numAct = overrides[`numAct_${y}_${q}`] != null ? overrides[`numAct_${y}_${q}`] : 0;        // casilla 07 (v61.1)
      const percAct = overrides[`percAct_${y}_${q}`] != null ? overrides[`percAct_${y}_${q}`] : 0;     // casilla 08
      const retAct = overrides[`retAct_${y}_${q}`] != null ? overrides[`retAct_${y}_${q}`] : 0;        // casilla 09
      const sum28 = r2(retTrab + retAct);                                                           // casilla 28
      const result111 = r2(sum28);                                                                  // casilla 30
      // v62 — IMPUESTO DE SOCIEDADES: прибыль квартала = доходы НЕТТО − расходы НЕТТО (по фактурам);
      // аванс modelo 202 = isRate% от ПОЛОЖИТЕЛЬНОЙ прибыли квартала (убыток → 0, перенос учитывается в годовом modelo 200).
      const benefNetoQ = r2(r2(quarter.ingresos / (1 + rate / 100)) - baseDed);
      const isPago202 = r2(Math.max(0, benefNetoQ) * isRate / 100);
      const rendCum = r2(cum.ingresos - cum.gastos); // справочно (прибыль нарастающим — для modelo 200/IS)
      const cumIngresos = r2(cum.ingresos), cumGastos = r2(cum.gastos);
      // Просрочка: дедлайн прошёл, а платить нужно → надбавка + пени (добровольная подача)
      const dl = taxQuarterDeadline(y, q);
      const isLate = dl.getTime() < today0;
      const monthsLate = isLate ? Math.max(0, Math.floor((today0 - dl.getTime()) / (30.44 * 86400000))) : 0;
      // art. 27 LGT: 1% + 1% за каждый полный месяц просрочки (макс 12%), после 12 мес. — 15% + пени
      const recargoRate = !isLate ? 0 : monthsLate > 12 ? 0.15 : Math.min(12, monthsLate + 1) * 0.01;
      const interestFrom = new Date(dl.getTime()); interestFrom.setMonth(interestFrom.getMonth() + 12);
      const interestDays = monthsLate > 12 ? Math.floor((today0 - interestFrom.getTime()) / 86400000) : 0;
      const base420 = Math.max(0, result420), base111 = result111, baseIS = isPago202;
      const recargo = r2((base420 + base111 + baseIS) * recargoRate);
      const intereses = interestDays > 0 ? r2((base420 + base111 + baseIS) * 0.040625 * interestDays / 365) : 0;
      return { y, q, key: `${y}-${q}T`, from, to, ingresos, gastos, igicSoportado, igicRepercutido, baseDev, cuotaDev, baseDed, cuotaDed, dif41, comp43, result420, numTrab, percTrab, retTrab, numAct, percAct, retAct, sum28, result111, benefNetoQ, isPago202, ingresosBrutos, gastosBrutos, cumIngresos, cumGastos, rendCum, dl, isLate, monthsLate, recargoRate, recargo, intereses, counts: quarter };
    });
    const tot = (f) => r2(quarters.reduce((s, x) => s + (x[f] || 0), 0));
    const total420 = tot('result420'), total111 = tot('result111'), totalIS = tot('isPago202');
    const totalRecargo = tot('recargo'), totalIntereses = tot('intereses');
    return {
      fromKey, toKey, igicRate: rate, isRate, quarters,
      total420, total111, totalIS, totalRecargo, totalIntereses,
      // Отрицательный результат 420 — это «к компенсации», а не к оплате: в итог к оплате идут только положительные суммы
      grandTotal: r2(Math.max(0, total420) + total111 + totalIS + totalRecargo + totalIntereses),
      lateCount: quarters.filter(x => x.isLate && (x.result420 > 0 || x.result111 > 0 || x.isPago202 > 0)).length
    };
  };

  // Строки заполненной модели: испанское название casilla КАК В ОФИЦИАЛЬНОЙ ФОРМЕ + рядом перевод на русский (v30.3)
  const taxFormRows = (form, x, d) => {
    const f = n => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const row = (label, val) => `  ${label}:`.padEnd(76, ' ') + f(val);
    const rows = [];
    if (form === '420') {
      // v61: casillas ТОЧНО как в официальной Modelo 420 ATC (образец: поданная 1T-2025, justificante 4205586417155)
      rows.push(`  — IGIC DEVENGADO (начислен с продаж) —`);
      rows.push(row(`Casilla 01 — Base imponible (нетто, bruto/${(1 + d.igicRate / 100).toFixed(2)}) — База`, x.baseDev != null ? x.baseDev : x.ingresos));
      rows.push(`  Casilla 02 — Tipo de gravamen — Ставка:`.padEnd(76, ' ') + `${f(d.igicRate)} %`);
      rows.push(row('Casilla 03 — Cuota devengada (01 × 02) — Начисленный IGIC', x.cuotaDev != null ? x.cuotaDev : x.igicRepercutido));
      rows.push(row('Casilla 25 — Total cuotas devengadas — Всего начислено', x.cuotaDev != null ? x.cuotaDev : x.igicRepercutido));
      rows.push(`  — IGIC DEDUCIBLE (к вычету, по фактурам) —`);
      rows.push(row('Casilla 26 — Base deducible (bienes y servicios corrientes) — База вычета', x.baseDed != null ? x.baseDed : x.gastos));
      rows.push(row('Casilla 27 — Cuota deducible — IGIC к вычету (tax_amount фактур)', x.cuotaDed != null ? x.cuotaDed : x.igicSoportado));
      rows.push(row('Casilla 40 — Total cuotas deducibles — Всего к вычету', x.cuotaDed != null ? x.cuotaDed : x.igicSoportado));
      rows.push(row('Casilla 41 — Diferencia (25 − 40) — Разница', x.dif41 != null ? x.dif41 : x.result420));
      if (x.comp43) rows.push(row('Casilla 43 — Cuotas a compensar de períodos anteriores — Зачёт прошлых', x.comp43));
      rows.push(row('Casilla 45 — RESULTADO DE LA AUTOLIQUIDACIÓN (41 − 43) — ИТОГ', x.result420));
      rows.push(x.result420 >= 0
        ? `  → A INGRESAR — К УПЛАТЕ: ${f(x.result420)} €`
        : `  → A COMPENSAR — К КОМПЕНСАЦИИ в следующих кварталах: ${f(Math.abs(x.result420))} €`);
    } else {
      // v61: Modelo 111 — retenciones IRPF (образец: поданная 1T-2024, justificante 1115816680711). ISERA 2020, SL — modelo 130 НЕ подаёт.
      rows.push(`  I. Rendimientos del trabajo — Удержания с зарплат:`);
      rows.push(`  Casilla 01 — Nº de perceptores — Число получателей:`.padEnd(76, ' ') + `${x.numTrab || 0}`);
      rows.push(row('Casilla 02 — Importe de las percepciones — Начислено работникам', x.percTrab || 0));
      rows.push(row('Casilla 03 — Importe de las retenciones — Удержано IRPF', x.retTrab || 0));
      rows.push(`  II. Rendimientos de actividades económicas — Удержания профессионалам:`);
      rows.push(`  Casilla 07 — Nº de perceptores — Число получателей:`.padEnd(76, ' ') + `${x.numAct || 0}`);
      rows.push(row('Casilla 08 — Importe de las percepciones — Начислено', x.percAct || 0));
      rows.push(row('Casilla 09 — Importe de las retenciones — Удержано', x.retAct || 0));
      rows.push(row('Casilla 28 — Suma de retenciones (03 + 09) — Всего удержано', x.sum28 != null ? x.sum28 : x.result111));
      rows.push(row('Casilla 30 — RESULTADO A INGRESAR — К УПЛАТЕ', x.result111));
      rows.push(`  → A INGRESAR — К УПЛАТЕ: ${f(x.result111)} €`);
      rows.push(`  (Справочно, прибыль нарастающим с 01.01.${x.y}: ${f(x.rendCum)} € — для Modelo 200/IS, не для 111)`);
    }
    return rows;
  };

  // Выгрузка распознанной отчётности в Excel (CSV с BOM, разделитель «;») — v32.1
  const downloadAnnualCSV = (r) => {
    const items = Array.isArray(r.items) ? r.items : [];
    const rows = items.filter(it => it && it.section !== 'ΣBANK');
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const num = v => (v == null || v === '') ? '' : String(Number(v)).replace('.', ',');
    const lines = [['Sección', 'Casilla', 'Partida (ES)', 'Перевод (RU)', 'Ejercicio', 'Ejercicio anterior'].map(esc).join(';')];
    rows.forEach(it => lines.push([
      it.section || '', it.casilla || '', it.name || '', it.name_ru || '',
      it.text_value != null && it.text_value !== '' ? it.text_value : num(it.total), num(it.prev_total)
    ].map(esc).join(';')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const year = (r.valid_to || r.receipt_date || '').slice(0, 4) || 'ejercicio';
    const prefix = r.document_type === 'tax_form' ? 'formulario' : 'cuentas_anuales';
    a.download = `${prefix}_${year}_${r.id || 'export'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  // ========== ГОДОВАЯ ОТЧЁТНОСТЬ (Cuentas Anuales) — v32 ==========
  // Строки отчётности лежат в items: {section, casilla, name, name_ru, total, prev_total, text_value};
  // служебные строки section="ΣBANK" — ключевые итоги для сравнения с банковскими движениями.

  // Текст страницы (с Markdown-таблицами v32.1) → HTML для Word (v32.3)
  const mdPageToWordHtml = (text) => {
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let html = '';
    let inTable = false;
    let headerDone = false;
    const closeTable = () => { if (inTable) { html += '</table>'; inTable = false; headerDone = false; } };
    for (const line of String(text || '').split('\n')) {
      const l = line.trim();
      if (/^\|[\s\-:|]+\|$/.test(l)) continue; // разделитель Markdown-таблицы
      if (l.startsWith('|') && l.endsWith('|') && l.length > 2) {
        const cells = l.slice(1, -1).split('|').map(c => c.trim());
        if (!inTable) { html += '<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:11pt;width:100%">'; inTable = true; }
        const tag = headerDone ? 'td' : 'th';
        html += '<tr>' + cells.map(c => `<${tag} style="border:1px solid #000;padding:3px 6px">${esc(c)}</${tag}>`).join('') + '</tr>';
        headerDone = true;
      } else {
        closeTable();
        if (l) html += `<p style="margin:2px 0">${esc(l)}</p>`;
      }
    }
    closeTable();
    return html;
  };

  // Экспорт документа в Word (.doc): PDF → Word (правка) → повторная загрузка → распознавание из текста.
  // Маркеры «══════ СТРАНИЦА N из M ══════» сохраняем — по ним бэкенд делит файл на страницы
  const downloadAnnualWord = (r) => {
    const { yearCur } = computeAnnualBankCmp(r);
    const items = Array.isArray(r.items) ? r.items : [];
    const denomItem = items.find(it => it && ['IDA', 'DATOS'].includes(it.section) && /denominaci[oó]n|apellidos\s+y\s+nombre|raz[oó]n\s+social/i.test(String(it.name || '')) && it.text_value);
    const denom = denomItem ? String(denomItem.text_value) : (r.store_name || 'documento');
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const rawText = String(r.raw_text || '');
    const chunks = rawText.split(/(?=^══════ СТРАНИЦА )/m).filter(c => c.trim());
    const bodyHtml = chunks.map(chunk => {
      const m = chunk.match(/^══════ (СТРАНИЦА \d+ из \d+) ══════\n?/);
      if (m) return `<h3 style="page-break-before:always">══════ ${m[1]} ══════</h3>` + mdPageToWordHtml(chunk.slice(m[0].length));
      return mdPageToWordHtml(chunk);
    }).join('\n');
    const docTitleRaw = r.document_type === 'tax_form'
      ? (r.store_name || `Formulario fiscal ${yearCur || ''}`)
      : `CUENTAS ANUALES ${yearCur || ''} — ${denom} — REGISTRO MERCANTIL`;
    const word = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(docTitleRaw)}</title></head>
<body style="font-family:'Times New Roman',serif">
<h2>${esc(docTitleRaw)}</h2>
<p style="color:#666;font-size:10pt">Текст, восстановленный распознаванием. Исправьте ошибки и загрузите файл обратно — распознавание выполнится из текста Word, без OCR. Заголовки «══════ СТРАНИЦА N из M ══════» НЕ удаляйте — по ним файл делится на страницы.</p>
${bodyHtml}
</body></html>`;
    const blob = new Blob(['﻿' + word], { type: 'application/msword;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${r.document_type === 'tax_form' ? 'formulario' : 'cuentas_anuales'}_${yearCur || 'ejercicio'}_${r.id || 'export'}.doc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };


  // Сверка итогов отчётности с банковскими движениями за отчётный год (общая для карточки и HTML, v32.2)
  const computeAnnualBankCmp = (r) => {
    const items = Array.isArray(r.items) ? r.items : [];
    const totals = {};
    items.filter(it => it && it.section === 'ΣBANK').forEach(it => {
      totals[it.name] = {
        cur: it.total != null ? Number(it.total) : null,
        prev: it.prev_total != null ? Number(it.prev_total) : null,
        ru: it.name_ru || it.name
      };
    });
    const yearCur = totals.ejercicio?.cur
      || (r.valid_to ? +String(r.valid_to).slice(0, 4) : null)
      || (r.receipt_date ? +String(r.receipt_date).slice(0, 4) : null);
    const yearPrev = totals.ejercicio?.prev || (yearCur ? yearCur - 1 : null);
    const mvts = Array.isArray(bankMovements) ? bankMovements : [];
    let cmp = null;
    if (yearCur) {
      const inYear = mvts.filter(m => m.operation_date && String(m.operation_date).startsWith(String(yearCur)));
      const bankIn = inYear.filter(m => Number(m.amount) > 0).reduce((s, m) => s + Number(m.amount), 0);
      const bankOut = inYear.filter(m => Number(m.amount) < 0).reduce((s, m) => s + Math.abs(Number(m.amount)), 0);
      // Остаток на 31.12: берём balance последнего движения года, иначе накопленная сумма
      const upto = mvts.filter(m => m.operation_date && String(m.operation_date) <= `${yearCur}-12-31`);
      const withBal = upto.filter(m => m.balance != null).sort((a, b) => (a.operation_date < b.operation_date ? 1 : -1));
      const bankBal = withBal.length ? Number(withBal[0].balance)
        : (upto.length ? upto.reduce((s, m) => s + (Number(m.amount) || 0), 0) : null);
      const mkRow = (key, labelEs, labelRu, bankVal, bankLabel) => {
        const rep = totals[key]?.cur;
        const diff = (rep != null && bankVal != null) ? bankVal - rep : null;
        const tol = Math.max(100, Math.abs(rep || 0) * 0.05);
        const status = diff == null ? '—' : (Math.abs(diff) <= tol ? '✅' : '⚠️');
        return { key, labelEs, labelRu, rep, bankVal, bankLabel, diff, status };
      };
      cmp = r.document_type === 'tax_form' ? [
        // Налоговая форма (v34): resultado сверяем со списаниями (уплата налога), база/cuota — справочно
        mkRow('resultado', 'Resultado (a ingresar + / a devolver −)', 'Результат декларации', (totals.resultado?.cur != null && totals.resultado.cur > 0) ? bankOut : null, `списания со счёта за ${yearCur}`),
        mkRow('base_imponible', 'Base imponible', 'Налоговая база', null, ''),
        mkRow('cuota', 'Cuota', 'Сумма налога по расчёту', null, '')
      ] : [
        mkRow('ingresos', 'Ingresos (casilla 40100)', 'Доходы по отчёту', bankIn, `поступления на счёт за ${yearCur}`),
        mkRow('gastos_explotacion', 'Gastos de explotación', 'Расходы по отчёту (по модулю)', bankOut, `списания со счёта за ${yearCur}`),
        mkRow('efectivo', 'Efectivo (casilla 12700)', 'Денежные средства на 31.12', bankBal, `остаток по выписке на 31.12.${yearCur}`)
      ];
    }
    return { totals, yearCur, yearPrev, cmp, mvtsCount: mvts.length };
  };

  // HTML документа в виде официальной формы Registro Mercantil (v32.2):
  // детерминированное восстановление вида из распознанных касилий — оригинал (ES) + перевод (RU).
  // standalone=true → полная страница (для отдельной вкладки/печати); false → фрагмент для модалки
  const buildAnnualHTML = (r, standalone = true) => {
    const items = (Array.isArray(r.items) ? r.items : []).filter(it => it && it.section);
    const rows = items.filter(it => it.section !== 'ΣBANK');
    const { totals, yearCur, yearPrev, cmp } = computeAnnualBankCmp(r);
    const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fmtN = n => (n == null || isNaN(n)) ? '' : Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // Иерархия строки формы по префиксу названия: A) → раздел; I. → группа; 1. → подгруппа; a) → пункт
    const levelOf = name => {
      const s = String(name || '').trim();
      if (/^[A-Z]\)\s/.test(s) || /^TOTAL\b/i.test(s) || /^RESULTADO\b/i.test(s)) return 0;
      if (/^[IVX]{1,4}\.\s/.test(s)) return 1;
      if (/^\d{1,2}\.\s/.test(s)) return 2;
      if (/^[a-z]\)\s/.test(s)) return 3;
      return 2;
    };
    const nif = r.invoice_number || '';
    const denomItem = rows.find(it => ['IDA', 'DATOS'].includes(it.section) && /denominaci[oó]n|apellidos\s+y\s+nombre|raz[oó]n\s+social/i.test(String(it.name || '')) && it.text_value);
    const denom = denomItem ? String(denomItem.text_value) : (r.store_name || '');
    const SECTION_META = {
      IDA: ['DATOS GENERALES DE IDENTIFICACIÓN', 'Идентификационные данные', 'IDA1'],
      BA: ['BALANCE DE SITUACIÓN ABREVIADO', 'Баланс (сокращённый)', 'BA'],
      PA: ['CUENTA DE PÉRDIDAS Y GANANCIAS ABREVIADA', 'Отчёт о прибылях и убытках (сокращённый)', 'PA'],
      LIQ: ['LIQUIDACIÓN — CÁLCULO DEL IMPUESTO', 'Расчёт налога', 'LIQ'],
      DATOS: ['DATOS DEL DECLARANTE', 'Данные декларанта', 'DATOS'],
      RES: ['RESULTADO DE LA DECLARACIÓN', 'Результат декларации', 'RES'],
      OTROS: ['OTROS DATOS', 'Прочее', '']
    };
    const secOrder = [...new Set(rows.map(it => it.section))].sort((a, b) => ['IDA', 'DATOS', 'BA', 'PA', 'LIQ', 'RES'].indexOf(a) - ['IDA', 'DATOS', 'BA', 'PA', 'LIQ', 'RES'].indexOf(b));
    const formHeader = code => `
      <table class="aaf-fh"><tr>
        <td style="width:22%"><span class="aaf-lbl">NIF:</span> <b>${esc(nif)}</b></td>
        <td><span class="aaf-lbl">DENOMINACIÓN SOCIAL:</span><br><b>${esc(denom)}</b></td>
        <td style="width:20%"><span class="aaf-lbl">UNIDAD:</span><br>Euros: <b>09001</b> ☒ &nbsp;Miles: 09002 ☐</td>
        <td class="aaf-code">${esc(code)}</td>
      </tr></table>`;
    const secHtml = secOrder.map(sec => {
      const meta = SECTION_META[sec] || [sec, sec, ''];
      const secRows = rows.filter(it => it.section === sec);
      const isIDA = sec === 'IDA';
      const body = secRows.map(it => {
        const hasText = it.text_value != null && it.text_value !== '';
        const valCell = hasText
          ? `<td class="aaf-val" colspan="2">${esc(it.text_value)}</td>`
          : `<td class="aaf-num">${fmtN(it.total != null ? Number(it.total) : null)}</td><td class="aaf-num">${fmtN(it.prev_total != null ? Number(it.prev_total) : null)}</td>`;
        const lv = isIDA ? 0 : levelOf(it.name);
        return `<tr class="aaf-lv${lv}">
          <td class="aaf-cas">${esc(it.casilla || '')}</td>
          <td class="aaf-lblcell" style="padding-left:${6 + lv * 18}px"><span class="aaf-es">${esc(it.name || '')}</span>${it.name_ru && it.name_ru !== it.name ? `<br><span class="aaf-ru">${esc(it.name_ru)}</span>` : ''}</td>
          ${valCell}
        </tr>`;
      }).join('');
      const headThird = isIDA ? `<th colspan="2">VALOR — ЗНАЧЕНИЕ</th>` : `<th class="aaf-num">EJERCICIO ${yearCur || ''} — ${yearCur || ''} год</th><th class="aaf-num">EJERCICIO ${yearPrev || ''} — ${yearPrev || ''} год</th>`;
      return `<div class="aaf-sheet">
        <div class="aaf-title">${esc(meta[0])}<span class="aaf-sheetcode">${esc(meta[2])}</span></div>
        <div class="aaf-titleru">${esc(meta[1])}</div>
        ${formHeader(meta[2])}
        <table class="aaf-grid"><thead><tr><th class="aaf-cas">CASILLA</th><th>${isIDA ? 'DATO — ДАННЫЕ' : (sec === 'BA' ? 'ACTIVO / PATRIMONIO NETO Y PASIVO — АКТИВ / КАПИТАЛ И ПАССИВ' : 'CUENTA DE PÉRDIDAS Y GANANCIAS — ПРИБЫЛИ И УБЫТКИ')}</th>${headThird}</tr></thead>
        <tbody>${body}</tbody></table>
      </div>`;
    }).join('');
    // ΣBANK-итоги + сверка с банком (на момент открытия страницы)
    const totRows = ['ingresos', 'gastos_explotacion', 'resultado', 'efectivo', 'total_activo', 'patrimonio_neto', 'acreedores_comerciales', 'deudores_comerciales']
      .filter(k => totals[k] && totals[k].cur != null)
      .map(k => `<tr class="aaf-lv0"><td class="aaf-cas">Σ</td><td class="aaf-lblcell"><span class="aaf-es">${esc(k)}</span><br><span class="aaf-ru">${esc(totals[k].ru || '')}</span></td><td class="aaf-num">${fmtN(totals[k].cur)}</td><td class="aaf-num">${fmtN(totals[k].prev)}</td></tr>`).join('');
    const cmpRows = (cmp || []).map(row => `<tr>
      <td class="aaf-lblcell"><span class="aaf-es">${esc(row.labelEs)}</span><br><span class="aaf-ru">${esc(row.labelRu)} · банк: ${esc(row.bankLabel)}</span></td>
      <td class="aaf-num">${fmtN(row.rep)}</td><td class="aaf-num">${fmtN(row.bankVal)}</td>
      <td class="aaf-num">${row.diff == null ? '' : (row.diff > 0 ? '+' : '') + fmtN(row.diff)}</td><td class="aaf-ctr">${row.status}</td></tr>`).join('');
    const bankHtml = (totRows || cmpRows) ? `<div class="aaf-sheet">
      <div class="aaf-title">RESUMEN Y COMPARACIÓN CON EL BANCO<span class="aaf-sheetcode">ΣBANK</span></div>
      <div class="aaf-titleru">Ключевые итоги и сверка с банком ${yearCur || ''} (сформировано ${new Date().toLocaleString('ru-RU')})</div>
      ${totRows ? `<table class="aaf-grid"><thead><tr><th class="aaf-cas">Σ</th><th>INDICADOR — ПОКАЗАТЕЛЬ</th><th class="aaf-num">${yearCur || ''}</th><th class="aaf-num">${yearPrev || ''}</th></tr></thead><tbody>${totRows}</tbody></table>` : ''}
      ${cmpRows ? `<table class="aaf-grid" style="margin-top:10px"><thead><tr><th>СВЕРКА С БАНКОМ</th><th class="aaf-num">ОТЧЁТНОСТЬ</th><th class="aaf-num">БАНК</th><th class="aaf-num">РАЗНИЦА</th><th></th></tr></thead><tbody>${cmpRows}</tbody></table>` : ''}
    </div>` : '';
    const css = `<style>
      .aaf{font-family:'Times New Roman',Times,serif;color:#1d1d1f;}
      .aaf-dochead{max-width:920px;margin:0 auto 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;color:#6e6e73;}
      .aaf-sheet{background:#fff;max-width:920px;margin:0 auto 22px;padding:16px 20px;border:2px solid #1d1d1f;box-shadow:0 2px 12px rgba(0,0,0,.08);}
      .aaf-title{text-align:center;font-weight:700;font-size:16px;letter-spacing:.05em;position:relative;}
      .aaf-sheetcode{position:absolute;right:0;top:0;font-size:13px;}
      .aaf-titleru{text-align:center;color:#6e6e73;font-size:12px;margin:2px 0 10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
      .aaf-fh{width:100%;border-collapse:collapse;margin-bottom:8px;font-size:12px;}
      .aaf-fh td{border:1.5px solid #1d1d1f;padding:5px 8px;vertical-align:top;}
      .aaf-code{font-weight:700;text-align:center;width:52px;font-size:15px;}
      .aaf-lbl{color:#3a3a3c;font-size:11px;}
      .aaf-grid{width:100%;border-collapse:collapse;font-size:12.5px;}
      .aaf-grid th{border:1px solid #1d1d1f;background:#f0f0f3;padding:4px 6px;text-align:left;font-size:11px;}
      .aaf-grid td{border:1px solid #9a9aa0;padding:3px 6px;vertical-align:top;}
      .aaf-cas{width:56px;text-align:right;font-variant-numeric:tabular-nums;color:#3a3a3c;white-space:nowrap;}
      .aaf-num{width:112px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
      .aaf-ctr{text-align:center;width:36px;}
      .aaf-val{font-weight:600;}
      .aaf-ru{color:#6e6e73;font-size:11px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
      tr.aaf-lv0 td{background:#f7f7f9;} tr.aaf-lv0 .aaf-es{font-weight:700;}
      @media print{body{background:#fff !important;padding:0 !important;}.aaf-sheet{box-shadow:none;border-width:1.5px;page-break-after:always;}}
    </style>`;
    const docHead = `<div class="aaf-dochead">Cuentas Anuales ${yearCur || ''} — ${esc(denom)}${nif ? ` · NIF ${esc(nif)}` : ''} · восстановленный вид формы из распознанных данных (НЕ официальный документ — сверяйте с оригиналом PDF)</div>`;
    const body = `${docHead}${secHtml}${bankHtml}`;
    if (!standalone) return `<div class="aaf">${css}${body}</div>`;
    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Cuentas Anuales ${yearCur || ''} — ${esc(denom)}</title></head><body style="background:#e8e8ed;margin:0;padding:24px;"><div class="aaf">${css}${body}</div></body></html>`;
  };

  // Открыть документ отдельной HTML-страницей (вид официальной формы; можно сохранить/напечатать из браузера)
  const openAnnualHTMLPage = (r) => {
    const blob = new Blob([buildAnnualHTML(r, true)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  // ========== ДВУЯЗЫЧНЫЙ ПРОСМОТР ТЕКСТА ДОКУМЕНТА (v35) ==========
  // Для многостраничных документов (договоры, формы, импорт из Word): постраничная навигация
  // + режимы «⇄ Оба» / «🇷🇺 Перевод» / «Оригинал».
  // В режиме «Оба»: если число строк оригинала и перевода совпадает — ПОСТРОЧНО: строка
  // оригинала, под ней серая строка перевода; Markdown-таблицы сливаются в одну — в каждой
  // ячейке значение оригинала, а перевод (если отличается) серым под ним. Если строки
  // разъехались — две колонки 50/50 с синхронной страницей.
  const renderDocTextBilingual = (r) => {
    const orig = String(r.raw_text || '');
    const ru = String(r.raw_text_ru || '');
    const pageCount = Math.max(1, (orig.match(/^═{2,}\s*СТРАНИЦА\s+\d+\s+из\s+\d+/gim) || []).length);
    const pageIdx = Math.min(docTextPage, pageCount - 1);
    const pageOrig = pageCount > 1 ? extractRawPage(orig, pageIdx + 1) : orig;
    const pageRu = pageCount > 1 ? extractRawPage(ru, pageIdx + 1) : ru;
    const modeBtn = (mode, label, enabled = true) => (
      <button key={mode} onClick={() => setDocTextMode(mode)} disabled={!enabled}
        style={{ padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: enabled ? 'pointer' : 'not-allowed', border: docTextMode === mode ? '1px solid #2980b9' : '1px solid #ccd6dd', background: docTextMode === mode ? '#eaf3fb' : '#fff', color: enabled ? '#2c3e50' : '#b2bec3' }}>
        {label}
      </button>
    );
    const preStyle = { margin: 0, fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', color: '#2c3e50', fontFamily: 'inherit' };
    const nav = pageCount > 1 && (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
        <button onClick={() => setDocTextPage(Math.max(0, pageIdx - 1))} disabled={pageIdx === 0} style={{ padding: '2px 9px', borderRadius: 6, border: '1px solid #ccd6dd', background: '#fff', cursor: pageIdx === 0 ? 'default' : 'pointer', fontSize: 13 }}>‹</button>
        <select value={pageIdx} onChange={e => setDocTextPage(Number(e.target.value))} style={{ padding: '2px 6px', borderRadius: 6, border: '1px solid #ccd6dd', fontSize: 12 }}>
          {Array.from({ length: pageCount }, (_, i) => <option key={i} value={i}>Стр. {i + 1} из {pageCount}</option>)}
        </select>
        <button onClick={() => setDocTextPage(Math.min(pageCount - 1, pageIdx + 1))} disabled={pageIdx >= pageCount - 1} style={{ padding: '2px 9px', borderRadius: 6, border: '1px solid #ccd6dd', background: '#fff', cursor: pageIdx >= pageCount - 1 ? 'default' : 'pointer', fontSize: 13 }}>›</button>
      </span>
    );
    const isTblRow = l => { const t = l.trim(); return t.length > 2 && t.startsWith('|') && t.endsWith('|'); };
    const isSepRow = l => /^\|[\s\-:|]+\|$/.test(l.trim());
    const rowCells = l => l.trim().slice(1, -1).split('|').map(c => c.trim());
    const renderBoth = () => {
      const ol = pageOrig.split('\n');
      const rl = pageRu.split('\n');
      if (!pageRu || ol.length !== rl.length) {
        // Число строк различается — две колонки, синхронно по странице
        return (
          <div style={{ display: 'table', width: '100%', tableLayout: 'fixed' }}>
            <div style={{ display: 'table-cell', width: '50%', verticalAlign: 'top', paddingRight: 8, borderRight: '1px solid #e0e6ed', boxSizing: 'border-box' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6e6e73', marginBottom: 4, textTransform: 'uppercase' }}>Оригинал</div>
              <pre style={preStyle}><HighlightText text={pageOrig} query={searchQuery} /></pre>
            </div>
            <div style={{ display: 'table-cell', width: '50%', verticalAlign: 'top', paddingLeft: 8, boxSizing: 'border-box' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6e6e73', marginBottom: 4, textTransform: 'uppercase' }}>Русский перевод</div>
              {pageRu
                ? <pre style={preStyle}><HighlightText text={pageRu} query={searchQuery} /></pre>
                : <p style={{ color: '#95a5a6', fontSize: 12 }}>Перевода этой страницы нет</p>}
            </div>
          </div>
        );
      }
      // Строки 1:1 — построчно; таблицы сливаем по ячейкам (перевод серым под оригиналом)
      const out = [];
      let tblPairs = [];
      const flushTbl = () => {
        if (!tblPairs.length) return;
        const pairs = tblPairs;
        out.push(
          <table key={`tbl-${out.length}`} style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, margin: '6px 0', background: '#fff' }}>
            <tbody>
              {pairs.map((pr, i) => {
                const oc = pr[0], rc = pr[1];
                const n = Math.max(oc.length, rc.length);
                return (
                  <tr key={i} style={i === 0 ? { fontWeight: 700, background: '#f5f5f7' } : undefined}>
                    {Array.from({ length: n }, (_, j) => {
                      const o = oc[j] || '';
                      const t = rc[j] || '';
                      return (
                        <td key={j} style={{ border: '1px solid #d2d2d7', padding: '3px 6px', verticalAlign: 'top' }}>
                          <HighlightText text={o} query={searchQuery} />
                          {t && t !== o && <div style={{ color: '#6e6e73', fontSize: 11 }}><HighlightText text={t} query={searchQuery} /></div>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
        tblPairs = [];
      };
      for (let i = 0; i < ol.length; i++) {
        const o = ol[i], t = rl[i];
        if (isSepRow(o)) continue; // разделитель Markdown-таблицы
        if (isTblRow(o) && isTblRow(t)) { tblPairs.push([rowCells(o), rowCells(t)]); continue; }
        if (isTblRow(o) && !isTblRow(t)) { tblPairs.push([rowCells(o), []]); continue; }
        flushTbl();
        if (!o.trim() && !t.trim()) continue;
        out.push(
          <div key={`ln-${i}`} style={{ margin: '2px 0' }}>
            {o.trim() ? <div style={preStyle}><HighlightText text={o} query={searchQuery} /></div> : null}
            {t.trim() && t.trim() !== o.trim() ? <div style={{ ...preStyle, color: '#6e6e73', fontSize: 12 }}><HighlightText text={t} query={searchQuery} /></div> : null}
          </div>
        );
      }
      flushTbl();
      return <div>{out}</div>;
    };
    const body = docTextMode === 'orig'
      ? <pre style={preStyle}><HighlightText text={pageOrig} query={searchQuery} /></pre>
      : docTextMode === 'ru'
        ? (pageRu ? <pre style={preStyle}><HighlightText text={pageRu} query={searchQuery} /></pre> : <p style={{ color: '#95a5a6', fontSize: 12 }}>Перевода этой страницы нет</p>)
        : renderBoth();
    return (
      <div className="info-block">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>Текст документа</span>
          {modeBtn('both', '⇄ Оба', !!(pageOrig && pageRu))}
          {modeBtn('ru', '🇷🇺 Перевод', !!pageRu)}
          {modeBtn('orig', 'Оригинал', !!pageOrig)}
          {nav}
        </h3>
        <div style={{ maxHeight: '60vh', overflowY: 'auto', overflowX: 'hidden', background: '#f8f9fa', border: '1px solid #e0e6ed', borderRadius: 8, padding: '10px 12px' }}>
          {body}
        </div>
      </div>
    );
  };

  const renderAnnualAccountsCard = (r) => {
    const items = Array.isArray(r.items) ? r.items : [];
    const SECTION_LABELS = {
      IDA: 'Identificación — Идентификация',
      BA: 'Balance de Situación — Баланс',
      PA: 'Cuenta de Pérdidas y Ganancias — Прибыли и убытки',
      LIQ: 'Liquidación — Ликвидация (расчёт налога)',
      DATOS: 'Datos del declarante — Данные декларанта',
      RES: 'Resultado — Результат декларации',
      OTROS: 'Otros — Прочее'
    };
    const { totals, yearCur, yearPrev, cmp, mvtsCount } = computeAnnualBankCmp(r);
    const tableRows = items.filter(it => it && it.section !== 'ΣBANK');
    const fmtN = n => n == null || isNaN(n)
      ? '—'
      : Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const numCell = n => (
      <td style={{ padding: '5px 8px', borderBottom: '1px solid #ececf0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: n == null ? '#8e8e93' : (Number(n) < 0 ? '#c0392b' : '#1d1d1f') }}>
        {fmtN(n)}
      </td>
    );

    return (
      <>
        <div className="info-block">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0 }}>📊 Cuentas Anuales — Годовая отчётность ({tableRows.length} строк)</h3>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button onClick={() => setAnnualFormView(v => !v)} style={{ padding: '6px 14px', fontSize: 13, cursor: 'pointer' }}
                title="Переключить: рабочая таблица / вид официальной формы">
                {annualFormView ? '📊 Таблица' : '📋 Вид формы'}
              </button>
              <button onClick={() => openAnnualHTMLPage(r)} style={{ padding: '6px 14px', fontSize: 13, cursor: 'pointer' }}
                title="Открыть документ отдельной HTML-страницей (вид официальной формы + сверка с банком; можно сохранить и напечатать)">
                🌐 HTML-страница
              </button>
              <button onClick={() => downloadAnnualWord(r)} style={{ padding: '6px 14px', fontSize: 13, cursor: 'pointer' }}
                title="Скачать текст документа в Word (.doc): исправьте ошибки и загрузите обратно — распознавание пойдёт из текста Word">
                ⬇ Word (.doc)
              </button>
              <button onClick={() => downloadAnnualCSV(r)} style={{ padding: '6px 14px', fontSize: 13, cursor: 'pointer' }}
                title="Выгрузить таблицу касилий в Excel (CSV)">
                ⬇ Excel (CSV)
              </button>
            </div>
          </div>
          {annualFormView ? (
            <div style={{ marginTop: 10, background: '#e8e8ed', padding: 12, borderRadius: 12 }}
              dangerouslySetInnerHTML={{ __html: buildAnnualHTML(r, false) }} />
          ) : (
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'linear-gradient(180deg,#f5f5f7,#e8e8ed)' }}>
                  <th style={{ padding: '7px 8px', textAlign: 'left', borderBottom: '2px solid #c7c7cc' }}>Casilla</th>
                  <th style={{ padding: '7px 8px', textAlign: 'left', borderBottom: '2px solid #c7c7cc' }}>Partida (оригинал)</th>
                  <th style={{ padding: '7px 8px', textAlign: 'left', borderBottom: '2px solid #c7c7cc' }}>Перевод</th>
                  <th style={{ padding: '7px 8px', textAlign: 'right', borderBottom: '2px solid #c7c7cc' }}>{yearCur || 'Ejercicio'}</th>
                  <th style={{ padding: '7px 8px', textAlign: 'right', borderBottom: '2px solid #c7c7cc' }}>{yearPrev || 'Anterior'}</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((it, i) => {
                  const prevSec = i > 0 ? tableRows[i - 1].section : null;
                  const secHeader = it.section && it.section !== prevSec ? (
                    <tr key={`sec-${i}`}>
                      <td colSpan={5} style={{ padding: '8px 8px 4px', fontWeight: 700, fontSize: 12, color: '#6e6e73', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #d2d2d7', background: '#f5f5f7' }}>
                        {SECTION_LABELS[it.section] || it.section}
                      </td>
                    </tr>
                  ) : null;
                  const val = it.text_value != null && it.text_value !== '' ? String(it.text_value) : null;
                  return (
                    <React.Fragment key={i}>
                      {secHeader}
                      <tr>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #ececf0', color: '#6e6e73', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{it.casilla || '—'}</td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #ececf0', color: '#1d1d1f' }}><HighlightText text={it.name || '—'} query={searchQuery} /></td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #ececf0', color: '#3a3a3c' }}><HighlightText text={it.name_ru || '—'} query={searchQuery} /></td>
                        {val != null
                          ? <td colSpan={2} style={{ padding: '5px 8px', borderBottom: '1px solid #ececf0', color: '#1d1d1f' }}>{val}</td>
                          : <>{numCell(it.total != null ? Number(it.total) : null)}{numCell(it.prev_total != null ? Number(it.prev_total) : null)}</>}
                      </tr>
                    </React.Fragment>
                  );
                })}
                {tableRows.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: '#8e8e93' }}>Строки отчётности не распознаны — смотрите оригинал текста ниже</td></tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </div>

        <div className="info-block" style={{ background: 'linear-gradient(135deg,#ffffff,#e8e8ed)', border: '2px solid #c7c7cc' }}>
          <h3 style={{ marginTop: 0 }}>🏦 Сравнить с банком {yearCur ? `— ${yearCur}` : ''}</h3>
          {mvtsCount === 0 ? (
            <p style={{ color: '#6e6e73', fontSize: 13 }}>
              Движения по счёту не загружены.{' '}
              <button onClick={loadBankMovements} disabled={bankLoading} style={{ padding: '5px 14px', fontSize: 13, cursor: 'pointer' }}>
                {bankLoading ? '⏳ Загружаю...' : '🏦 Загрузить движения из базы'}
              </button>
            </p>
          ) : !cmp ? (
            <p style={{ color: '#6e6e73', fontSize: 13 }}>Не удалось определить отчётный год — сверка недоступна.</p>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,.6)' }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '2px solid #c7c7cc' }}>Показатель</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '2px solid #c7c7cc' }}>Отчётность</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '2px solid #c7c7cc' }}>Банк</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '2px solid #c7c7cc' }}>Разница</th>
                    <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '2px solid #c7c7cc' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {cmp.map(row => (
                    <tr key={row.key}>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #ececf0' }}>
                        <div style={{ color: '#1d1d1f', fontWeight: 600 }}>{row.labelEs}</div>
                        <div style={{ color: '#6e6e73', fontSize: 12 }}>{row.labelRu} · банк: {row.bankLabel}</div>
                      </td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #ececf0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtN(row.rep)}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #ececf0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtN(row.bankVal)}</td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #ececf0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: row.diff == null ? '#8e8e93' : (Math.abs(row.diff) <= Math.max(100, Math.abs(row.rep || 0) * 0.05) ? '#1d1d1f' : '#c0392b') }}>
                        {row.diff == null ? '—' : (row.diff > 0 ? '+' : '') + fmtN(row.diff)}
                      </td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid #ececf0', textAlign: 'center' }}>{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: '#6e6e73', lineHeight: 1.45 }}>
                ✅ — расхождение в пределах 5% или 100 €. Учтите: доходы по отчёту ≠ поступлениям ровно —
                часть выручки может висеть в <b>deudores comerciales</b> (не оплачено на 31.12
                {totals.deudores_comerciales?.cur != null ? `: ${fmtN(totals.deudores_comerciales.cur)} €` : ''}),
                а расходы — в <b>acreedores comerciales</b>
                {totals.acreedores_comerciales?.cur != null ? ` (${fmtN(totals.acreedores_comerciales.cur)} €)` : ''}.
                Остаток «Efectivo» сверяется с балансом выписки на 31.12.{yearCur}.
              </p>
            </>
          )}
        </div>
      </>
    );
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
      lines.push(`  ──────────── MODELO 111 — RETENCIONES IRPF ${x.key} ────────────`);
      lines.push(...taxFormRows('111', x, d));
      if (x.isLate && (x.result420 > 0 || x.result111 > 0)) {
        lines.push(`  ⚠ ПРОСРОЧЕНО (дедлайн ${x.dl.toLocaleDateString('ru-RU')}, ${x.monthsLate} мес.): надбавка recargo ${(x.recargoRate * 100).toFixed(0)}% = ${f(x.recargo)} · пени intereses = ${f(x.intereses)}`);
      }
      lines.push('');
    });
    lines.push(`════════ ИТОГО ЗА ПЕРИОД ════════`);
    lines.push(`  IGIC (modelo 420) к оплате:      ${f(Math.max(0, d.total420))} €${d.total420 < 0 ? `   (ещё ${f(Math.abs(d.total420))} € — a compensar, к компенсации)` : ''}`);
    lines.push(`  IRPF retenciones (modelo 111):   ${f(d.total111)} €`);
    lines.push(`  IS прибыль (modelo 202, авансы): ${f(d.totalIS || 0)} €   (ставка ${d.isRate || 25}%; годовой — modelo 200 до 25.07)`);
    lines.push(`  ШТРАФ-надбавка (recargo):        ${f(d.totalRecargo)} €`);
    lines.push(`  ПЕНИ (intereses de demora):      ${f(d.totalIntereses)} €`);
    lines.push(`  ══ ВСЕГО К ОПЛАТЕ:               ${f(d.grandTotal)} € ══`);
    if (d.lateCount) lines.push(`  (просрочено кварталов: ${d.lateCount}; расчёт санкций — при добровольной подаче ДО требования AEAT; при требовании штраф 50–150%)`);
    return lines.join('\n');
  };

  // Текст ОДНОЙ заполненной модели (420 или 130) за конкретный квартал — для попапа и скачивания (v30.2)
  const buildSingleTaxFormText = (form, x, d) => {
    const f = n => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const lines = [`MODELO ${form} — ${form === '420' ? 'IGIC (ATC)' : 'RETENCIONES IRPF (AEAT)'} · ${x.key} — автозаполнено из банка (${new Date().toLocaleString('ru-RU')})`,
      `Основание: ${x.counts.incCount} поступлений и ${x.counts.outInvCount} платежей с фактурой за ${x.from}…${x.to}`,
      '(Это помощник для переноса цифр в веб-форму — НЕ официальный документ. Проверьте цифры!)', '',
      ...taxFormRows(form, x, d)];
    if (x.isLate && (x.result420 > 0 || x.result111 > 0)) {
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

  // Выбор диапазона «с/по»: свежая выборка из базы + сразу открываем заполненные формы (v30.4)
  const applyTaxRange = async (f, t) => {
    taxRangeTouched.current = true;
    setTaxQFrom(f);
    setTaxQTo(t);
    const mvts = await loadBankMovements();
    setTaxDraft(computeTaxRange(f, t, {}, mvts && mvts.length ? mvts : undefined));
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
  // v54.2: пометка бэкенда «· ⚠ дубликат #ID» в recognition_method (сумма совпала ±0.02, дата в пределах ±40 дн. —
  // ловит сбой OCR в дне, когда точный ключ выше не сработал) — вливаем в общую систему КОПИЯ/ОРИГИНАЛ
  receipts.forEach(r => {
    const m = String(r.recognition_method || '').match(/дубликат #(\d+)/i);
    if (!m) return;
    if (dupGroups.some(gr => gr.some(x => x.id === r.id))) return; // уже в группе по точному ключу
    const orig = receipts.find(x => x.id === Number(m[1]));
    if (!orig) return;
    const g = dupGroups.find(gr => gr.some(x => x.id === orig.id));
    if (g) g.push(r); else dupGroups.push([orig, r]);
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

  // v68.1: в режиме работы с копиями — каждая группа выводится «копии слева, оригинал справа»
  if (copiesFirstOrder) {
    const visIds = new Set(visibleReceipts.map(r => r.id));
    const ordered = [];
    dupGroups.forEach(g => {
      const vis = g.filter(r => visIds.has(r.id));
      if (vis.length > 1) ordered.push(...vis.slice(1), vis[0]); // копии, затем оригинал
      else ordered.push(...vis);
    });
    visibleReceipts.forEach(r => { if (!dupAllIds.has(r.id)) ordered.push(r); });
    sortedReceipts.length = 0;
    sortedReceipts.push(...ordered);
  }

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

  // Боковая навигация «год/месяц» (v39): группы текущей страницы в порядке списка
  const dateRailGroups = [];
  paginatedReceipts.forEach(r => {
    const gk = groupKeyOf(r);
    if (dateRailGroups.length && dateRailGroups[dateRailGroups.length - 1].gk === gk) return;
    const d = new Date(sortDateOf(r));
    const ok = !isNaN(d.getTime());
    const yr = ok ? d.getFullYear() : null;
    dateRailGroups.push({
      gk,
      title: groupTitleOf(r),
      year: yr,
      month: ok ? d.getMonth() : null,
      isYearStart: yr !== null && !dateRailGroups.some(g => g.year === yr)
    });
  });
  const scrollToGroup = (gk) => {
    const el = document.getElementById(`rg-${gk}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  const modelsAll = [LOCAL_MAC_MODEL, ...models];
  const filteredModels = modelsAll.filter(m => {
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
          <style>{'.login-box input{width:100% !important;box-sizing:border-box;padding:13px 16px;margin:0 0 10px;border-radius:12px;border:1px solid #d0d0d5;font-size:15px;text-align:center}'}</style>
          <h1>Receipt Manager</h1>
          <div style={{
            padding: '8px 12px',
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 13,
            background: 'linear-gradient(180deg,#ffffff,#ececf0)',
            color: '#1d1d1f',
            border: '1px solid #c7c7cc'
          }}>
            {serverStatus === 'checking' && '⏳ Проверка сервера...'}
            {serverStatus === 'ok' && '✅ Сервер доступен'}
            {serverStatus === 'error' && `❌ Сервер недоступен: ${API_URL}`}
          </div>
          <input type="text" placeholder="Логин" value={loginName} onChange={e => setLoginName(e.target.value)} onKeyPress={e => e.key === 'Enter' && login()} autoCapitalize="none" autoCorrect="off" />
          <input type="password" placeholder="Введите пароль" value={password} onChange={e => setPassword(e.target.value)} onKeyPress={e => e.key === 'Enter' && login()} />
          <div style={{ fontSize: 11.5, color: '#8e8e93', marginTop: 6, textAlign: 'center' }}>Новые пользователи — логин + пароль (выдаёт админ). Старые общие пароли работают с пустым логином.</div>
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
          </div>
          <style>{'.tabs-inline button.active{background:#0071e3 !important;color:#fff !important;border-color:#0071e3 !important;box-shadow:0 2px 8px rgba(0,113,227,0.3)}'}</style>
          <nav className="tabs-inline">
            {user?.role !== 'viewer' && tabAllowed('upload') && (
              <button className={activeTab === 'upload' ? 'active' : ''} onClick={() => setActiveTab('upload')}>Загрузка</button>
            )}
            {tabAllowed('list') && (
            <button className={activeTab === 'list' ? 'active' : ''} onClick={() => {setActiveTab('list'); loadReceipts();}}>
              Чеки/фактуры ({receiptCount}) · Прочие документы ({invoiceCount})
            </button>
            )}
            {/* Вкладка «Анализ»: банковские выписки и автопривязка платежей к фактурам */}
            {tabAllowed('analysis') && (
              <button className={activeTab === 'analysis' ? 'active' : ''} onClick={() => {setActiveTab('analysis'); loadReceipts(); loadBankMovements(); loadPlannedPayments();}}>
                📊 Анализ
              </button>
            )}
            {/* Вкладка «Налоги» (v29.2): полная копия банковского «Анализа» — основа под налоговый учёт */}
            {tabAllowed('taxes') && (
              <button className={activeTab === 'taxes' ? 'active' : ''} onClick={() => {setActiveTab('taxes'); loadReceipts(); loadBankMovements();}}>
                🧾 Налоги
              </button>
            )}
            {/* Вкладка «CRM» (v32): календарь задач, контрагенты, контакты, таймлайн исполнения — локально, без бэкенда */}
            {(user?.role === 'admin' || user?.role === 'manager' || user?.role === 'user') && tabAllowed('crm') && (
              <button className={activeTab === 'crm' ? 'active' : ''} onClick={() => setActiveTab('crm')}>
                🤝 CRM
              </button>
            )}
            {/* Вкладка «Документы» (v40): разделы Дома/Авто/Личное, файлы любых типов */}
            {tabAllowed('docs') && (
              <button className={activeTab === 'docs' ? 'active' : ''} onClick={() => setActiveTab('docs')}>
                📁 Документы
              </button>
            )}
            {/* v83: чат с бейджем непрочитанных */}
            {tabAllowed('chat') && (
              <button className={activeTab === 'chat' ? 'active' : ''} onClick={() => setActiveTab('chat')} style={{ position: 'relative' }}>
                💬 Чат
                {chatUnreadTotal > 0 && <span style={{ background: '#ff3b30', color: '#fff', borderRadius: 10, fontSize: 11, padding: '1px 7px', marginLeft: 5 }}>{chatUnreadTotal}</span>}
              </button>
            )}
            {/* v74: управление пользователями — только admin */}
            {user?.role === 'admin' && (
              <button className={activeTab === 'users' ? 'active' : ''} onClick={() => setActiveTab('users')}>
                👥 Доступ
              </button>
            )}
          </nav>
        </div>
        <div className="header-right">
          <span className="user-name">{formatUserName(user)}</span>
          <button className="logout-btn" onClick={logout}>Выйти</button>
        </div>
      </header>

      {backendInfo && !String(backendInfo.version || '').includes('2026-08-04.22') && (
        <div style={{ background: 'linear-gradient(180deg,#ffffff,#ececf0)', border: '1px solid #c7c7cc', color: '#1d1d1f', padding: '10px 16px', borderRadius: 12, margin: '10px 15px', fontSize: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong> Бэкенд устарел!</strong>
          <span>
            На householder-api сейчас: <code>{backendInfo.version || backendInfo.error || 'старая версия (до diagnostics)'}</code>, нужна: <code>2026-08-04.22</code>.
            Задеплой свежий index.js (Railway → householder-api → Deploy latest commit), иначе перевод не заработает.
          </span>
          <button onClick={() => setBackendInfo(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: '#1d1d1f' }}>✕</button>
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
            {freeModelTipOpen && (
              <div style={{ margin: '0 16px 8px', padding: '10px 12px', background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 8, fontSize: 12, lineHeight: 1.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <strong>💡 Бесплатная модель, которой может не быть в списке (проверено: август 2026)</strong>
                  <button onClick={() => setFreeModelTipOpen(false)} title="Скрыть подсказку" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#999', padding: 0 }}>✕</button>
                </div>
                <div style={{ marginTop: 4 }}>
                  📄 <b>NVIDIA Nemotron Nano 12B v2 VL</b> (<code style={{ fontSize: 11 }}>nvidia/nemotron-nano-12b-v2-vl:free</code>) — обучена специально на ДОКУМЕНТАХ (лидер OCRBench/DocVQA среди открытых моделей), идеальна для чеков и выписок. Бесплатно на OpenRouter: 20 зап/мин, 200 зап/день.
                </div>
                <div style={{ marginTop: 3 }}>
                  🔄 Альтернатива: <b>Google Gemma 4 31B</b> (<code style={{ fontSize: 11 }}>google/gemma-4-31b-it:free</code>) — мультимодальная (текст+фото+видео), контекст 262K.
                </div>
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed #ffe082' }}>
                  <b>Как подключить:</b> openrouter.ai → Keys → Create Key → Railway (householder-api) → Variables → добавьте <code style={{ fontSize: 11 }}>OPENROUTER_API_KEY</code> → Redeploy → здесь нажмите «🔄 Обновить». Все бесплатные vision-модели OpenRouter появятся в списке автоматически.
                </div>
              </div>
            )}
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

      {shareDlg && <ShareDialog dlg={shareDlg} setDlg={setShareDlg} token={token} />}

      {/* v68.3: универсальное всплывающее подтверждение (загрузка / удаление) */}
      {confirmDlg && (
        <div className="modal-overlay" onClick={() => setConfirmDlg(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 420, textAlign: 'center' }}>
            <h3 style={{ marginTop: 0 }}>{confirmDlg.title}</h3>
            <div style={{ fontSize: 14, color: '#3a3a3c', whiteSpace: 'pre-line', lineHeight: 1.5 }}>{confirmDlg.text}</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'center' }}>
              <button onClick={() => { const cb = confirmDlg.onYes; setConfirmDlg(null); if (cb) cb(); }}
                style={{ padding: '9px 22px', borderRadius: 980, border: 'none', background: confirmDlg.danger ? '#e74c3c' : '#34c759', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                {confirmDlg.yesLabel || 'Да'}
              </button>
              <button onClick={() => setConfirmDlg(null)}
                style={{ padding: '9px 22px', borderRadius: 980, border: '1px solid #c7c7cc', background: '#fff', color: '#1d1d1f', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
      {/* v68.2: окно прогресса «Загрузить» — загружено N из M + кнопка Остановить */}
      {exportProgress && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 22, width: '100%', maxWidth: 420, textAlign: 'center' }}>
            <h3 style={{ marginTop: 0 }}>⬇ Загрузка файлов…</h3>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#1d4ed8' }}>
              {exportProgress.done} <span style={{ color: '#8e8e93', fontSize: 16, fontWeight: 600 }}>из {exportProgress.total}</span>
            </div>
            <div style={{ fontSize: 13, color: '#6e6e73', marginTop: 4 }}>файлов сохранено: <b>{exportProgress.files}</b></div>
            <div style={{ height: 10, background: '#ececf0', borderRadius: 6, marginTop: 14, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${exportProgress.total ? Math.round(exportProgress.done / exportProgress.total * 100) : 0}%`, background: 'linear-gradient(90deg,#34c759,#1d4ed8)', transition: 'width 0.25s' }} />
            </div>
            <button onClick={() => { exportStopRef.current = true; }}
              style={{ marginTop: 16, padding: '9px 22px', borderRadius: 980, border: 'none', background: '#e74c3c', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              ⏹ Остановить
            </button>
          </div>
        </div>
      )}
      {viewModal && (
        <div className="modal-overlay" onClick={() => setViewModal(null)}>
          {renderRcLinkPicker()}
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
                    const bothMode = pageTextLang === 'both' && pageRu && pageOrig; // v35: оригинал + перевод одновременно
                    const effLang = bothMode ? 'both' : (pageTextLang === 'ru' && pageRu) ? 'ru' : (pageTextLang === 'orig' && pageOrig) ? 'orig' : (pageRu ? 'ru' : 'orig');
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
                          {langBtn('both', '⇄ Оба', !!(pageRu && pageOrig))}
                          {langBtn('ru', '🇷🇺 Перевод', !!pageRu)}
                          {langBtn('orig', 'Оригинал', !!pageOrig)}
                          <span style={{ fontSize: 11, color: '#95a5a6', alignSelf: 'center' }}>стр. {idx + 1}</span>
                        </div>
                        {bothMode ? (
                          <div style={{ maxHeight: isNarrowModal ? '45vh' : '55vh', overflowY: 'auto', overflowX: 'hidden', background: '#f8f9fa', border: '1px solid #e0e6ed', borderRadius: 8, padding: '10px 12px', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', color: '#2c3e50' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#6e6e73', textTransform: 'uppercase', marginBottom: 3 }}>Оригинал</div>
                            <div>{pageOrig}</div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#6e6e73', textTransform: 'uppercase', margin: '10px 0 3px', borderTop: '1px solid #e0e6ed', paddingTop: 8 }}>Русский перевод</div>
                            <div>{pageRu}</div>
                          </div>
                        ) : (
                        <div style={{ maxHeight: isNarrowModal ? '45vh' : '55vh', overflowY: 'auto', overflowX: 'hidden', background: '#f8f9fa', border: '1px solid #e0e6ed', borderRadius: 8, padding: '10px 12px', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', color: '#2c3e50' }}>
                          {pageText}
                        </div>
                        )}
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
                  <div className="info-block">
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
                {!editMode && (() => {
                  // v55: макет карточки зависит от типа документа:
                  // receipt — как было; invoice — продавец/№/суммы/адрес; proposal — поставщик/срок КП;
                  // contract/municipality (договор/справка) — стороны/№/подписание/действие
                  const r = viewModal;
                  const dt = r.document_type || 'receipt';
                  const nameNode = (label) => (
                    <React.Fragment key="name">
                      <p><strong>{label}:</strong> <HighlightText text={r.store_name || r.store_name_ru || '—'} query={searchQuery} /></p>
                      {r.store_name_ru && r.store_name && r.store_name_ru !== r.store_name && (
                        <p style={{ marginTop: -6 }}><strong>Название (рус):</strong> <HighlightText text={r.store_name_ru} query={searchQuery} /></p>
                      )}
                    </React.Fragment>
                  );
                  const payNode = (
                    <p key="pay"><strong>Оплата:</strong>{' '}
                      {/* Менюшка быстрой смены статуса прямо в карточке — сохраняется сразу, без режима редактирования */}
                      <select
                        value={r.payment_status || ''}
                        onChange={e => quickSavePaymentStatus(e.target.value)}
                        title="Сменить статус оплаты"
                        style={{
                          padding: '3px 8px', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                          border: `1px solid ${(PAYMENT_STATUS_META[r.payment_status] || {}).color || '#ddd'}`,
                          color: (PAYMENT_STATUS_META[r.payment_status] || {}).color || '#666',
                          background: (PAYMENT_STATUS_META[r.payment_status] || {}).bg || '#fff'
                        }}
                      >
                        <option value="">— не указан —</option>
                        {Object.entries(PAYMENT_STATUS_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
                      </select>
                      {/* v68: привязка к СУЩЕСТВУЮЩЕМУ платежу выписки — как из банка, только в обратную сторону */}
                      <button onClick={() => { setRcLinkSearch(''); setRcLinkPicker(r); }} title="Привязать фактуру к существующему платежу банковской выписки (строки в выписке НЕ создаются)"
                        style={{ marginLeft: 8, padding: '3px 10px', borderRadius: 10, border: '1px solid #27ae60', background: '#e4f7e9', color: '#1e8449', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
                        🔗 К платежу банка
                      </button>
                    </p>
                  );
                  const paidNode = r.paid_date ? (
                    <p key="paid"><strong>Дата оплаты:</strong> {formatDate(r.paid_date)}
                      {r.bank_movement_id && <span title="Привязано к движению по банковской выписке" style={{ marginLeft: 6, color: '#27ae60' }}>🏦 по выписке</span>}
                    </p>
                  ) : null;
                  // v67.9: метка «привязан к банку» ВНУТРИ карточки — клик ведёт в «Налоги» к платежу
                  const bankNode = (() => {
                    const links = bankMovements.filter(mv => String(mv.matched_receipt_id || '') === String(r.id));
                    if (!links.length && !r.bank_movement_id) return null;
                    const paidSum = links.reduce((a, mv) => a + Math.abs(Number(mv.amount) || 0), 0);
                    const lastDate = links.map(mv => mv.operation_date).filter(Boolean).sort().pop() || null;
                    return (
                      <p key="banklink"><strong>Банк:</strong>{' '}
                        {links.length > 0 ? (
                          <span onClick={() => gotoTaxesMovement(links[0].id, links[0].operation_date)}
                            title="Нажмите — переход в «Налоги» к этому платежу"
                            style={{ display: 'inline-block', fontSize: 12.5, fontWeight: 700, color: '#1d4ed8', background: '#eef4ff', border: '1px solid #1d4ed8', borderRadius: 10, padding: '2px 10px', cursor: 'pointer' }}>
                            🏦 привязан к банку · {formatAmount(paidSum, 'EUR')}{links.length > 1 ? ` · ${links.length} плат.` : ''}{lastDate ? ` · ${formatDate(lastDate)}` : ''}
                          </span>
                        ) : (
                          <span style={{ fontSize: 12.5, color: '#27ae60', fontWeight: 700 }}>🏦 по выписке</span>
                        )}
                      </p>
                    );
                  })();
                  const deltaNode = ['receipt', 'invoice', 'bill'].includes(dt) ? (() => {
                    const itemsTotal = calculateItemsTotal(r.items);
                    const total = parseFloat(r.total_amount) || 0;
                    const diff = Math.abs(total - itemsTotal).toFixed(2);
                    if (diff > 0.01) {
                      return (
                        <p key="delta" style={{ color: '#e74c3c', fontWeight: 600 }}>
                          Разница: {diff} {r.currency || ''}
                          <br/><small>(Сумма строк: {itemsTotal.toFixed(2)} ≠ Итого: {total.toFixed(2)})</small>
                        </p>
                      );
                    }
                    return <p key="delta" style={{ color: '#27ae60' }}> Сумма строк совпадает</p>;
                  })() : null;
                  const methodNode = <p key="method"><strong>Метод:</strong> {r.recognition_method || '—'}</p>;
                  const ownerNode = <p key="owner"><strong>Добавил:</strong> <HighlightText text={formatOwnerName(r)} query={searchQuery} /></p>;
                  const row = (key, label, value) => (value == null || value === '') ? null : (
                    <p key={key}><strong>{label}:</strong> {value}</p>
                  );
                  const periodNode = (label) => (r.valid_from || r.valid_to) ? (
                    <p key="period"><strong>{label}:</strong> {r.valid_from ? formatDate(r.valid_from) : '—'} → {r.valid_to ? formatDate(r.valid_to) : '—'}
                      {expiryInfo(r) && <span style={{ marginLeft: 8, color: expiryInfo(r).color, fontWeight: 600 }}>{expiryInfo(r).text}</span>}
                    </p>
                  ) : null;

                  let rows;
                  if (dt === 'invoice') {
                    // ФАКТУРА: продавец и реквизиты — наверх, суммы и контроль — рядом
                    rows = [
                      nameNode('Продавец'),
                      row('inv', '№ фактуры', r.invoice_number),
                      row('date', 'Дата фактуры', `${formatDate(r.receipt_date)} ${r.receipt_time || ''}`.trim()),
                      row('total', 'Итого к оплате', formatAmount(r.total_amount, r.currency)),
                      row('subtotal', 'База (подытог)', r.subtotal ? formatAmount(parseFloat(r.subtotal), r.currency) : null),
                      row('tax', 'Налог (IVA/IGIC)', r.tax_amount ? `${formatAmount(parseFloat(r.tax_amount), r.currency)}${r.tax_rate ? ` · ставка ${r.tax_rate}` : ''}` : null),
                      row('object', 'Объект', r.object && r.object !== 'other' ? r.object : null),
                      row('addr', 'Адрес поставки', r.supply_address),
                      row('provider', 'Поставщик', r.provider),
                      row('buyer', 'Покупатель', r.party_b),
                      row('sum', 'Суть документа', r.summary),
                      payNode, paidNode, bankNode, deltaNode,
                      row('contract', '№ договора', r.contract_number),
                      periodNode('Период'),
                      methodNode, ownerNode
                    ];
                  } else if (dt === 'proposal') {
                    // КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ: поставщик, № и срок действия КП, сумма
                    rows = [
                      nameNode('Поставщик (КП)'),
                      row('inv', '№ предложения', r.invoice_number || r.contract_number),
                      row('date', 'Дата предложения', formatDate(r.receipt_date)),
                      row('total', 'Сумма предложения', formatAmount(r.total_amount, r.currency)),
                      r.valid_to ? (
                        <p key="valid"><strong>Действительно до:</strong> {formatDate(r.valid_to)}
                          {expiryInfo(r) && <span style={{ marginLeft: 8, color: expiryInfo(r).color, fontWeight: 600 }}>{expiryInfo(r).text}</span>}
                        </p>
                      ) : null,
                      row('object', 'Объект', r.object && r.object !== 'other' ? r.object : null),
                      row('addr', 'Адрес', r.supply_address),
                      row('provider', 'Контакт поставщика', r.provider),
                      row('sum', 'Примечания', r.summary),
                      row('subtype', 'Подтип', r.subtype ? (SUBTYPE_LABELS[r.subtype] || r.subtype) : null),
                      methodNode, ownerNode
                    ];
                  } else if (dt === 'contract' || dt === 'municipality') {
                    // ДОГОВОР / СПРАВКА: документ, №, подписание, стороны, действие
                    rows = [
                      nameNode(dt === 'municipality' ? 'Документ / орган' : 'Документ'),
                      row('contract', '№ договора / документа', r.contract_number || r.invoice_number),
                      row('date', 'Дата подписания', formatDate(r.receipt_date)),
                      row('partyA', 'Сторона А / эмитент', r.party_a || r.provider),
                      row('partyB', 'Сторона Б', r.party_b),
                      row('total', 'Сумма по документу', r.total_amount != null ? formatAmount(r.total_amount, r.currency) : null),
                      row('sum', 'Суть документа', r.summary),
                      periodNode('Действует'),
                      row('object', 'Объект', r.object && r.object !== 'other' ? r.object : null),
                      row('addr', 'Адрес объекта', r.supply_address),
                      row('subtype', 'Подтип', r.subtype ? (SUBTYPE_LABELS[r.subtype] || r.subtype) : null),
                      methodNode, ownerNode
                    ];
                  } else {
                    // ЧЕК (и прочие типы) — как было
                    rows = [
                      nameNode(['annual_accounts', 'tax_form'].includes(dt) ? 'Документ' : 'Магазин'),
                      row('date', 'Дата', `${formatDate(r.receipt_date)} ${r.receipt_time || ''}`.trim()),
                      <p key="total"><strong>{dt === 'annual_accounts' ? 'Resultado — Результат года' : dt === 'tax_form' ? 'Resultado — Результат декларации' : 'Итого'}:</strong> {formatAmount(r.total_amount, r.currency)}</p>,
                      row('type', 'Тип', DOC_TYPE_LABELS[r.document_type] || r.document_type || '🧾 Чек'),
                      row('object', 'Объект', r.object || '—'),
                      row('subtype', 'Подтип', r.subtype ? (SUBTYPE_LABELS[r.subtype] || r.subtype) : null),
                      payNode, paidNode, bankNode,
                      row('provider', 'Поставщик', r.provider),
                      row('partyA', 'Сторона А', ['bank', 'tax', 'tax_form', 'annual_accounts'].includes(dt) ? r.party_a : null),
                      row('partyB', dt === 'bill' ? 'Титулар' : 'Сторона Б', ['bank', 'tax', 'tax_form', 'annual_accounts', 'bill'].includes(dt) ? r.party_b : null),
                      row('sum', 'Суть документа', ['bank', 'tax', 'tax_form', 'annual_accounts'].includes(dt) ? r.summary : null),
                      row('addr', 'Адрес поставки', r.supply_address),
                      row('inv', '№ фактуры', r.invoice_number),
                      row('contract', '№ договора', r.contract_number),
                      row('cups', 'CUPS', r.cups),
                      row('meter', '№ счётчика', r.meter_number),
                      row('cons', 'Потребление', r.consumption != null ? `${r.consumption} ${r.consumption_unit || ''}` : null),
                      periodNode(['bill', 'bank'].includes(dt) ? 'Период' : 'Действует'),
                      methodNode, ownerNode,
                      row('subtotal', 'Подытог', r.subtotal),
                      row('tax', 'Налог', r.tax_amount ? `${r.tax_amount}${r.tax_rate ? ` (${r.tax_rate})` : ''}` : null),
                      deltaNode
                    ];
                  }
                  return (
                    <div className="info-block">
                      <h3>{dt === 'invoice' ? 'Фактура' : dt === 'proposal' ? 'Коммерческое предложение' : dt === 'contract' ? 'Договор' : dt === 'municipality' ? 'Справка / документ мэрии' : 'Основная информация'}</h3>
                      {rows}
                    </div>
                  );
                })()}
                {['annual_accounts', 'tax_form'].includes(viewModal.document_type) ? (
                  renderAnnualAccountsCard(viewModal)
                ) : (['contract', 'municipality', 'bank', 'tax'].includes(viewModal.document_type) && !(viewModal.items || []).length) ? null : (() => {
                  // v56.5: позиции знают свою страницу документа (item.page) — перед таблицей листалка
                  // «Стр. N из M», в таблице — только позиции выбранной страницы. Номера строк сквозные.
                  const allItems = viewModal.items || [];
                  const maxPage = allItems.reduce((m, it) => Math.max(m, Number(it && it.page) || 1), 1);
                  const paged = maxPage > 1;
                  const cur = Math.min(Math.max(1, itemsPage), maxPage);
                  const rowsIt = allItems.map((item, i) => ({ item, i })).filter(x => !paged || (Number(x.item && x.item.page) || 1) === cur);
                  const pageBtn = {
                    width: 30, height: 30, borderRadius: '50%', border: '1px solid #d0d7de',
                    background: '#fff', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0
                  };
                  return (
                <div className="info-block">
                  <h3>{['invoice', 'proposal', 'bill'].includes(viewModal.document_type) ? 'Позиции' : 'Товары'} ({allItems.length})</h3>
                  {paged && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '2px 0 10px' }}>
                      <button onClick={() => setItemsPage(cur - 1)} disabled={cur <= 1} style={{ ...pageBtn, opacity: cur <= 1 ? 0.35 : 1 }}>‹</button>
                      <span style={{ fontWeight: 700 }}>Стр. {cur} из {maxPage}</span>
                      <button onClick={() => setItemsPage(cur + 1)} disabled={cur >= maxPage} style={{ ...pageBtn, opacity: cur >= maxPage ? 0.35 : 1 }}>›</button>
                      <span style={{ fontSize: 12, color: '#7f8c8d' }}>позиций на странице: {rowsIt.length} (всего {allItems.length})</span>
                    </div>
                  )}
                  <table className="items-table">
                    <thead><tr><th>№</th><th>Товар</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead>
                    <tbody>
                      {rowsIt.map(({ item, i }) => (
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
                  );
                })()}
                {/* Многостраничный документ (договор/форма/импорт из Word, v35) — двуязычный
                    постраничный просмотр; одностраничные чеки — как раньше, два блока */}
                {(() => {
                  const pageMarks = (String(viewModal.raw_text || '').match(/^═{2,}\s*СТРАНИЦА\s+\d+\s+из\s+\d+/gim) || []).length;
                  if (pageMarks >= 2) return renderDocTextBilingual(viewModal);
                  return null;
                })() || (
                  <>
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
                  </>
                )}
              </div>
            </div>
            <div className="modal-footer" style={{ flexShrink: 0 }}>
              <button onClick={() => setViewModal(null)}>Закрыть</button>
              {/* Кнопки редактирования НЕ монтируем/размонтируем, а прячем через display:
                  иначе Safari (backdrop-filter на overlay) оставляет «призрак» удалённой
                  оранжевой кнопки — линию через футер */}
              <button onClick={startEdit} style={{ background: '#f39c12', display: (editMode || user?.role === 'viewer') ? 'none' : undefined }}>✏️ Редактировать</button>
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
            <label htmlFor="statement-input" className="btn-folder" style={{ background: '#16a085' }} title="Excel-выписки банка (.xlsx), можно несколько сразу: дубликаты пропускаются, фактуры автоматически привяжутся к платежам">
              🏦 Выписки банка
            </label>
            {user?.role === 'admin' && (
              <React.Fragment>
                <button type="button" className="btn-folder" style={{ background: '#5e5ce6' }} onClick={downloadBackup} disabled={backupBusy || restoreBusy}
                  title="Скачать полный бэкап: все таблицы (JSON) + манифест файлов (URL) одним ZIP">
                  {backupBusy ? '⏳ Бэкап…' : '📦 Бэкап'}
                </button>
                <label className="btn-folder" style={{ background: '#bf5af2', opacity: restoreBusy ? 0.6 : 1 }}
                  title="Восстановить таблицы из файла бэкапа (.zip): существующие записи обновятся, недостающие добавятся">
                  {restoreBusy ? '⏳ Восстановление…' : '♻ Восстановить'}
                  <input type="file" accept=".zip" style={{ display: 'none' }} disabled={restoreBusy || backupBusy} onChange={handleRestoreFile} />
                </label>
              </React.Fragment>
            )}
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

          <input type="file" accept="image/*,application/pdf,.doc,.docx,.txt,.html,.htm" multiple onChange={handleFileSelect} id="file-input" style={{ display: 'none' }} />
          {/* Только webkitdirectory — без multiple/accept: тогда диалог выбирает ПАПКУ целиком,
              а файлы внутри не кликабельны (с accept/macOS диалог превращался в выбор файлов).
              Фильтрация по типу всё равно есть в handleFolderSelect */}
          <input type="file" id="folder-input" webkitdirectory="" directory="" onChange={handleFolderSelect} style={{ display: 'none' }} />
          <input type="file" id="statement-input" accept=".xlsx,.xls" multiple onChange={handleStatementSelect} style={{ display: 'none' }} />

          {bankImportReport && (
            <div style={{ background: '#fff', border: '1px solid #e3e6ea', borderRadius: 12, padding: '10px 14px', margin: '10px 0', fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <b>🏦 Импорт выписок: файлов {bankImportReport.totals.files} · новых {bankImportReport.totals.imported} · дублей пропущено {bankImportReport.totals.skipped} · привязано {bankImportReport.totals.autoMatched}</b>
                <button onClick={() => setBankImportReport(null)} style={{ border: 'none', background: '#f0f0f2', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', fontSize: 11 }}>✕</button>
              </div>
              {bankImportReport.files.map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '4px 0', borderTop: i ? '1px solid #f0f0f2' : 'none', alignItems: 'baseline' }}>
                  <span style={{ minWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📄 {f.name}</span>
                  {f.error ? (
                    <span style={{ color: '#e74c3c' }}>❌ {f.error}</span>
                  ) : (
                    <React.Fragment>
                      <span style={{ color: '#8e8e93' }}>{f.account || f.iban || 'счёт'}</span>
                      <span>строк: <b>{f.totalInFile}</b></span>
                      <span style={{ color: '#34c759' }}>новых: <b>{f.imported}</b></span>
                      <span style={{ color: f.skipped ? '#e67e22' : '#8e8e93' }}>дублей: <b>{f.skipped}</b></span>
                      <span style={{ color: '#0071e3' }}>привязано: <b>{f.autoMatched}</b></span>
                    </React.Fragment>
                  )}
                </div>
              ))}
              <div style={{ fontSize: 12, color: '#8e8e93', marginTop: 6 }}>Все движения и привязки — во вкладке «📊 Анализ».</div>
            </div>
          )}

          <div className="recognize-bar">
            <button
              className="recognize-main-btn"
              onClick={() => recognizeAndSave()}
              disabled={!selectedFiles.length || recognizing}
              style={recognizing ? { position: 'relative', overflow: 'hidden' } : {}}
            >
              <span className="model-active-badge-inline">
                <span className="provider-badge" style={{ backgroundColor: getProviderColor(activeModelDisplay.provider) }}>
                  {activeModelDisplay.provider}
                </span>
                <span className="model-active-name">{activeModelDisplay.displayName}</span>
              </span>
              {selectedModel === 'local-mac-ocr' && (
                <button
                  onClick={(e) => { e.stopPropagation(); configureMacOcr(); }}
                  title="Адрес Mac OCR (HTTPS-туннель cloudflared на 127.0.0.1:8787)"
                  style={{ marginLeft: 6, border: 'none', background: 'none', cursor: 'pointer', fontSize: 15, padding: 0 }}
                >⚙</button>
              )}
              {recognizing && progressStage ? (
                <>
                  <span style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: `${uploadProgress}%`,
                    // v56.1: цвет полосы по этапу — загрузка синяя, распознавание зелёное
                    background: progressStage === 'upload' ? 'rgba(66,165,245,0.55)' : 'rgba(102,187,106,0.55)',
                    transition: 'width 0.4s ease'
                  }} />
                  <span style={{ position: 'relative', zIndex: 1 }}>
                    {progressStage === 'upload'
                      ? <>⬆️ Загрузка… <span style={{ color: '#ffd54f', fontWeight: 800, textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}>{uploadProgress}%</span></>
                      : progressStage === 'analyze'
                        ? '🔍 Анализирую страницы…'
                        : progressStage === 'local'
                          ? <>🖥 Локальный OCR… <span style={{ color: '#ffd54f', fontWeight: 800, textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}>{uploadProgress}%</span></>
                          : <>🤖 Распознавание AI… <span style={{ color: '#ffd54f', fontWeight: 800, textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}>{uploadProgress}%</span></>}
                  </span>
                </>
              ) : recognizing ? (
                '⏳ Идёт загрузка папки…'
              ) : selectedFiles.length > 1 ? (
                `📄 Распознать ${selectedFiles.length} стр. (AI разберёт: отдельно или как один)`
              ) : 'Распознать и сохранить'}
            </button>
            <button
              onClick={recognizeViaMacOcr}
              disabled={!selectedFiles.length || recognizing}
              title="Бесплатный OCR на вашем Mac (Apple Vision, mac-ocr-server 127.0.0.1:8787). Текст распознаётся локально, карточку собирает и сохраняет сервер. Несколько выбранных страниц = один документ"
              style={{
                marginTop: 8, width: '100%', padding: '12px', fontSize: 15, fontWeight: 600,
                borderRadius: 10, border: '1.5px solid #27ae60', background: '#f0faf4', color: '#1e8449',
                cursor: (!selectedFiles.length || recognizing) ? 'not-allowed' : 'pointer',
                opacity: (!selectedFiles.length || recognizing) ? 0.55 : 1
              }}
            >
              🖥 Локально (Mac OCR, бесплатно)
            </button>
            {/* Метка сборки: если её не видно на сайте — фронтенд не пересобрался/закэширован */}
            <div style={{ marginTop: 6, fontSize: 11, color: '#95a5a6', textAlign: 'center' }}>
              сборка 2026-08-20 · v83 · Mac OCR: {macOcrUrl ? 'туннель (свой URL)' : 'прямой 127.0.0.1:8787'}
              <button
                onClick={configureMacOcr}
                title="Задать адрес Mac OCR (HTTPS-туннель cloudflared на 127.0.0.1:8787)"
                style={{ marginLeft: 6, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, padding: 0 }}
              >⚙</button>
            </div>
          </div>

          <div className="upload-layout">
            <div className="drop-zone" onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
              <input type="file" accept="image/*,application/pdf,.doc,.docx,.txt,.html,.htm" multiple onChange={handleFileSelect} id="file-input-hidden" style={{ display: 'none' }} />
              <label htmlFor="file-input" style={{ display: 'block', width: '100%', cursor: 'pointer' }}>
                {preparingPdf ? (
                  <div className="drop-text">
                    <p>⏳ Конвертирую PDF в страницы…</p>
                    <p className="hint">Длинный документ может занять до минуты</p>
                  </div>
                ) : previewUrl ? (
                  <div className="preview-container">
                    {selectedFiles[currentFileIndex] && isWordFile(selectedFiles[currentFileIndex]) ? (
                      <div style={{ padding: '26px 16px', textAlign: 'center', background: 'linear-gradient(180deg,#ffffff,#ececf0)', border: '1px solid #d2d2d7', borderRadius: 14, maxWidth: 420, margin: '0 auto' }}>
                        <div style={{ fontSize: 42, marginBottom: 8 }}>📝</div>
                        <div style={{ fontWeight: 700, color: '#1d1d1f', wordBreak: 'break-all' }}>{selectedFiles[currentFileIndex].name}</div>
                        <div style={{ fontSize: 12, color: '#6e6e73', marginTop: 6 }}>Файл Word/текста — распознавание выполнится ИЗ ТЕКСТА, без OCR.<br/>Нажмите «Распознать».</div>
                      </div>
                    ) : (
                    <>
                    <img
                      src={previewUrl}
                      alt="Preview"
                      className="preview"
                      title="Нажмите для увеличения"
                      style={{ cursor: 'zoom-in' }}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFullscreenImage(previewUrl); }}
                    />
                    <p style={{ fontSize: 11, color: '#95a5a6', margin: '4px 0 0' }}>Нажмите на изображение для увеличения</p>
                    </>
                    )}
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
                            : pdfExpandedRef.current
                              ? '📄 PDF → Markdown (MarkItDown; скан — OCR): ОДИН документ (лучший режим)'
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
                    {lastSavedReceipt.duplicate_of && (
                      <p style={{ color: '#c0392b' }}>
                        <strong>⚠️ Похоже на дубликат чека #{lastSavedReceipt.duplicate_of.id}:</strong>{' '}
                        {lastSavedReceipt.duplicate_of.store_name || '—'}, {formatDate(lastSavedReceipt.duplicate_of.receipt_date)},{' '}
                        {formatAmount(lastSavedReceipt.duplicate_of.total_amount, lastSavedReceipt.duplicate_of.currency)}.
                        Карточка сохранена — если это повтор, удалите одну из них.
                      </p>
                    )}
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

          {folderProgress.active && (() => {
            // v56.1: информативный пакетный прогресс — общий % внутри полосы, этап текущего файла,
            // счётчики успеха/ошибок и оценка оставшегося времени (по среднему на файл)
            const fp = folderProgress;
            const isConvert = fp.phase === 'converting';
            const convPct = fp.convertTotal > 0 ? Math.round(fp.convertPage / fp.convertTotal * 100) : 5;
            const overallPct = fp.total > 0 ? Math.min(100, Math.round(((fp.current - 1 + (fp.fileRatio || 0)) / fp.total) * 100)) : 0;
            const pct = isConvert ? convPct : overallPct;
            const barColor = isConvert ? 'linear-gradient(90deg,#42a5f5,#1e88e5)' : 'linear-gradient(90deg,#42a5f5,#66bb6a)';
            const fr = fp.fileRatio || 0;
            const filePhase = fp.retryNote ? fp.retryNote
              : fr <= 0 ? ''
              : fr < 0.5 ? ` — ⬆️ загрузка ${Math.round(fr * 200)}%`
              : fr < 1 ? ' — 🤖 распознаётся AI…'
              : ' — ✅ готово';
            let etaText = '';
            if (!isConvert && fp.current > 1 && fp.total > 0 && folderStartRef.current) {
              const elapsed = (Date.now() - folderStartRef.current) / 1000;
              const done = fp.current - 1 + fr;
              if (done > 0) {
                const remain = Math.max(0, fp.total - done) * (elapsed / done);
                etaText = ` · ⏱ прошло ${Math.round(elapsed)}с, осталось ~${remain >= 60 ? `${Math.floor(remain / 60)}м ${Math.round(remain % 60)}с` : `${Math.round(remain)}с`}`;
              }
            }
            return (
            <div className="folder-progress">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <strong>{isConvert ? '📄 Подготовка PDF (текст → Markdown, скан → страницы)…' : ` Распознавание файлов — ${Math.min(fp.current, fp.total) || 1} из ${fp.total}`}</strong>
                <span style={{ fontWeight: 800, color: isConvert ? '#1e88e5' : '#2e7d32' }}>{pct}%</span>
              </div>
              {/* Процент ВНУТРИ полосы — виден и на заполненной, и на пустой части */}
              <div className="folder-progress-bar" style={{ position: 'relative', height: 20, borderRadius: 10, background: '#e0e0e0', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 10,
                  width: `${pct}%`,
                  background: barColor,
                  transition: 'width 0.4s ease'
                }} />
                <span style={{
                  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 800, color: '#333', mixBlendMode: 'normal', pointerEvents: 'none'
                }}>
                  {isConvert ? `стр. ${fp.convertPage} / ${fp.convertTotal}` : `${pct}%`}
                </span>
              </div>
              <p style={{ fontSize: 12, color: '#555', marginTop: 6 }}>
                {isConvert
                  ? (fp.convertFile || 'Подготовка…') + (fp.convertTotal > 0 ? ` — страница ${fp.convertPage} из ${fp.convertTotal}` : '')
                  : <>{fp.currentFile}<span style={{ color: '#1e88e5', fontWeight: 600 }}>{filePhase}</span></>}
              </p>
              {isConvert ? (
                <p style={{ fontSize: 12, color: '#7f8c8d', marginTop: 4 }}>
                  Многостраничные PDF раскладываются по страницам — каждая станет отдельным документом. Дальше начнётся распознавание.
                </p>
              ) : (
                <p style={{ fontSize: 13, color: '#27ae60', marginTop: 4 }}>
                  ✅ Успешно: {fp.success} &nbsp;|&nbsp;
                  <span style={{ color: '#e74c3c' }}>❌ Ошибок: {fp.errors}</span>
                  {(fp.retries || 0) > 0 && <span style={{ color: '#7f8c8d' }}> &nbsp;|&nbsp; 🔁 повторов: {fp.retries}</span>}
                  <span style={{ color: '#7f8c8d' }}>{etaText}</span>
                </p>
              )}
            </div>
            );
          })()}

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
          {plannedPickMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#f4ecfb', border: '1px solid #8e44ad', borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 14, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: '#8e44ad' }}>🧾 Выбор фактуры для планового платежа</span>
              <span style={{ color: '#6e6e73', fontSize: 13 }}>Найдите чек/фактуру фильтрами и нажмите «✅ Выбрать» на карточке</span>
              <button onClick={() => { setPlannedPickMode(false); setActiveTab('analysis'); setPlannedModal(true); }} style={{ marginLeft: 'auto', border: '1px solid #8e44ad', background: '#fff', color: '#8e44ad', borderRadius: 980, padding: '4px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>← Назад к платежу без выбора</button>
            </div>
          )}
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
            <div className="bulk-actions-panel">
              {/* Верхняя строка — основные действия */}
              <div className="bulk-actions-row">
                <span> Выбрано: <strong>{selectedReceiptIds.size}</strong></span>
                {(user?.role === 'admin' || user?.role === 'manager' || user?.role === 'user') && (
                  <button className="bulk-btn bulk-btn-danger" onClick={bulkDelete}>🗑 Удалить</button>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select className="bulk-select" value={exportMode} onChange={(e) => setExportMode(e.target.value)}>
                    <option value="all">Все (Excel + Фото + Текст)</option>
                    <option value="excel">📊 Только Excel</option>
                    <option value="photos">📷 Только фото</option>
                    <option value="text">📝 Только текст</option>
                  </select>
                  <div style={{ position: 'relative' }}>
                    <button className="bulk-btn bulk-btn-success" onClick={() => setExportMenuOpen(v => !v)}>⬇ Загрузить ▾</button>
                    {exportMenuOpen && (
                      <React.Fragment>
                        <div onClick={() => setExportMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 900 }} />
                        <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 901, background: '#fff', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.18)', border: '1px solid #e3e6ea', padding: 6, minWidth: 250 }}>
                          <button onClick={() => { setExportMenuOpen(false); handleExport(); }}
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', background: 'transparent', borderRadius: 8, fontSize: 13.5, fontWeight: 600, color: '#1d1d1f', cursor: 'pointer' }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#f5f5f7'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                            📁 Загрузить файлы
                            <div style={{ fontSize: 11, fontWeight: 400, color: '#8e8e93', marginTop: 2 }}>в выбранную папку / по одному в «Загрузки»</div>
                          </button>
                          <button onClick={() => { setExportMenuOpen(false); handleExportZip(); }}
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', background: 'transparent', borderRadius: 8, fontSize: 13.5, fontWeight: 600, color: '#1d1d1f', cursor: 'pointer' }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#f5f5f7'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                            🗜 Загрузить ZIP-архив
                            <div style={{ fontSize: 11, fontWeight: 400, color: '#8e8e93', marginTop: 2 }}>один .zip — внутри папка на каждый чек</div>
                          </button>
                          <button onClick={() => { setExportMenuOpen(false); handleShareReceipts(); }}
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', background: 'transparent', borderRadius: 8, fontSize: 13.5, fontWeight: 600, color: '#1d1d1f', cursor: 'pointer' }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#f5f5f7'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                            🔗 Поделиться ссылкой
                            <div style={{ fontSize: 11, fontWeight: 400, color: '#8e8e93', marginTop: 2 }}>публичная страница с файлами — как Dropbox</div>
                          </button>
                        </div>
                      </React.Fragment>
                    )}
                  </div>
                </div>
                {user?.role !== 'viewer' && (
                  <React.Fragment>
                    <button className="bulk-btn bulk-btn-purple" onClick={() => bulkReprocess()}>🔄 Перераспознать</button>
                    <button className="bulk-btn bulk-btn-teal" onClick={() => bulkTranslate()}>🌐 Перевести</button>
                  </React.Fragment>
                )}
              </div>

              {/* Нижняя строка — Сменить... во всю ширину */}
              <div className="bulk-actions-row bulk-actions-row-full" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <select className="bulk-select" style={{ flex: '0 0 auto' }} onChange={(e) => { const v = e.target.value; if (!v) return; bulkChangeObject(v); e.target.value = ''; }}>
                  <option value="">Сменить объект...</option>
                  {objectsList.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <select className="bulk-select" style={{ flex: '0 0 auto' }} onChange={(e) => { const v = e.target.value; if (!v) return; bulkChangeType(v); e.target.value = ''; }}>
                  <option value="">Сменить тип...</option>
                  {Object.entries(DOC_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <select className="bulk-select" style={{ flex: '0 0 auto' }} onChange={(e) => { const v = e.target.value; if (!v) return; bulkChangeSubtype(v); e.target.value = ''; }}>
                  <option value="">Сменить подтип...</option>
                  {Object.entries(SUBTYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <select className="bulk-select" style={{ flex: '0 0 auto' }} onChange={(e) => { const v = e.target.value; if (!v) return; bulkChangePaymentStatus(v); e.target.value = ''; }}>
                  <option value="">Сменить оплату...</option>
                  <option value="to_pay">🟠 К оплате</option>
                  <option value="paid">🟢 Оплачено</option>
                  <option value="underpaid">🔴 Недоплачено</option>
                  <option value="__clear">✖ Очистить статус</option>
                </select>
                <select className="bulk-select" style={{ flex: '0 0 auto' }} onChange={(e) => { const v = e.target.value; if (!v) return; bulkChangeCurrency(v); e.target.value = ''; }}>
                  <option value="">Сменить валюту...</option>
                  <option value="AED">AED</option>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                  <option value="RUB">RUB</option>
                </select>
                <button className="bulk-btn bulk-btn-gray" style={{ flex: '0 0 auto' }} onClick={deselectAll}>✖ Сбросить</button>
                {dupFocusId && (
                  <button className="bulk-btn bulk-btn-gray" style={{ flex: '0 0 auto' }} onClick={() => { setDupFocusId(null); setShowDuplicates(false); setCopiesFirstOrder(false); }}>👁 Показать все</button>
                )}
                {selectedReceiptIds.size === 1 && !showDuplicates && (() => {
                  const rid = Array.from(selectedReceiptIds)[0];
                  const r = receipts.find(x => x.id === rid);
                  if (!r) return null;
                  const g = dupGroups.find(group => group.some(x => x.id === rid));
                  const n = g ? g.length : 0;
                  return (
                    <button
                      key="dup-btn"
                      className="bulk-btn bulk-btn-gray"
                      onClick={() => {
                        if (!g) { alert('У этой карточки нет дубликатов'); return; }
                        setDupFocusId(rid);
                        setShowDuplicates(true);
                      }}
                      style={!g ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
                    >
                      👯 Показать копии ({n})
                    </button>
                  );
                })()}
              </div>
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
            <div style={{ background: 'linear-gradient(180deg,#ffffff,#ececf0)', border: '1px solid #d2d2d7', padding: '10px 15px', borderRadius: 12, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 14 }}>
              <span>
                Найдено групп дубликатов: <strong>{dupGroups.length}</strong>, лишних копий: <strong>{dupCopyIds.size}</strong>
                <span style={{ color: '#7f8c8d' }}> — оригиналы помечены зелёным, копии красным</span>
              </span>
              {dupCopyIds.size > 0 && (
                <button
                  onClick={() => { setSelectedReceiptIds(new Set(dupCopyIds)); setShowDuplicates(true); setCopiesFirstOrder(true); setCurrentPage(1); }}
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
              {dateRailGroups.length >= 2 && (
                <div style={{ position: 'fixed', right: 6, top: '50%', transform: 'translateY(-50%)', zIndex: 60, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 2, background: 'rgba(255,255,255,0.94)', border: '1px solid #e3e6ea', borderRadius: 12, padding: '8px 8px', boxShadow: '0 2px 10px rgba(0,0,0,0.10)', maxHeight: '74vh', overflowY: 'auto', scrollbarWidth: 'none', width: 76, boxSizing: 'border-box' }}>
                  {dateRailGroups.map(g => {
                    const active = String(activeRailGk) === String(g.gk);
                    const label = g.year === null ? '—' : g.isYearStart ? String(g.year) : MONTH_NAMES[g.month].slice(0, 3);
                    return (
                      <button key={g.gk} onClick={() => scrollToGroup(g.gk)} title={g.title}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, width: '100%', boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none', border: 'none', borderRadius: 0, background: 'none', boxShadow: 'none', margin: 0, padding: '2px 0', minWidth: 0, minHeight: 0, fontFamily: 'inherit', lineHeight: 1.2, whiteSpace: 'nowrap', cursor: 'pointer', color: active ? '#0a84ff' : (g.isYearStart ? '#1d1d1f' : '#8e8e93'), fontWeight: g.isYearStart ? 800 : 600, fontSize: g.isYearStart ? 12 : 11 }}>
                        <span>{label}</span>
                        <span style={{ display: 'inline-block', width: active ? 18 : 12, height: 2, borderRadius: 1, background: active ? '#0a84ff' : '#c7c7cc', transition: 'all 0.15s' }} />
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="receipts-grid">
                {paginatedReceipts.map((receipt, idx) => {
                  const itemsTotal = calculateItemsTotal(receipt.items);
                  const total = parseFloat(receipt.total_amount) || 0;
                  const diff = Math.abs(total - itemsTotal).toFixed(2);
                  // Δ имеет смысл только для документов со строками товаров (чек/фактура/счёт);
                  // у договоров, полисов и выписок суммы нет строк — Δ не показываем
                  const hasDiff = diff > 0.01 && ['receipt', 'invoice', 'bill'].includes(receipt.document_type || 'receipt');
                  // v67.9: привязка к банку — платежи выписки, привязанные к этой фактуре
                  const bankLinks = bankMovements.filter(mv => String(mv.matched_receipt_id || '') === String(receipt.id));
                  const bankPaidSum = bankLinks.reduce((a, mv) => a + Math.abs(Number(mv.amount) || 0), 0);
                  const bankLastDate = bankLinks.map(mv => mv.operation_date).filter(Boolean).sort().pop() || null;
                  // Заголовок группы, когда меняется год-месяц
                  const gk = groupKeyOf(receipt);
                  const prevGk = idx > 0 ? groupKeyOf(paginatedReceipts[idx - 1]) : null;
                  const showGroupHeader = !copiesFirstOrder && gk !== prevGk; // v68.1: в режиме копий заголовки месяцев не показываем
                  const groupCount = showGroupHeader ? paginatedReceipts.filter(r => groupKeyOf(r) === gk).length : 0;
                  return (
                    <React.Fragment key={receipt.id}>
                    {showGroupHeader && (
                      <div id={`rg-${gk}`} style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10, margin: idx === 0 ? '0 0 4px' : '14px 0 4px', scrollMarginTop: 110 }}>
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
                        {plannedPickMode && (
                          <button onClick={() => { setPlannedForm(f => ({ ...f, fileUrl: `receipt:${receipt.id}`, fileName: receipt.store_name || receipt.store_name_ru || `Чек #${receipt.id}` })); setPlannedPickMode(false); setActiveTab('analysis'); setPlannedModal(true); }}
                            style={{ flexShrink: 0, marginTop: 2, border: 'none', background: '#8e44ad', color: '#fff', borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✅ Выбрать</button>
                        )}
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
                      {/* v67.9: метка привязки к банку — клик открывает «Налоги» на строке платежа */}
                      {bankLinks.length > 0 && (
                        <p style={{ margin: '2px 0' }}>
                          <span onClick={() => gotoTaxesMovement(bankLinks[0].id, bankLinks[0].operation_date)}
                            title={`Привязан к выписке: оплачено ${formatAmount(bankPaidSum, 'EUR')} по ${bankLinks.length} плат.${bankLastDate ? ', последний ' + formatDate(bankLastDate) : ''} — нажмите, чтобы перейти в «Налоги» к платежу`}
                            style={{ display: 'inline-block', fontSize: 11.5, fontWeight: 700, color: '#1d4ed8', background: '#eef4ff', border: '1px solid #1d4ed8', borderRadius: 10, padding: '2px 9px', cursor: 'pointer' }}>
                            🏦 привязан к банку · {formatAmount(bankPaidSum, 'EUR')}{bankLinks.length > 1 ? ` · ${bankLinks.length} плат.` : ''}{bankLastDate ? ` · ${formatDate(bankLastDate)}` : ''}
                          </span>
                        </p>
                      )}
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
                          <img 
                            src={fixImageUrl(receipt.photo_url || receipt.image_url)} 
                            alt="Чек" 
                            className="receipt-thumb" 
                            onError={(e) => { e.target.style.display = 'none'; }}
                            onClick={(e) => { e.stopPropagation(); setFullscreenImage(fixImageUrl(receipt.photo_url || receipt.image_url)); }}
                            title="Нажмите для увеличения"
                          />
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
            // ---- Таймлайн обязательных повторяющихся платежей (v41) ----
            const RECUR_CATS = [
              { key: 'utilities', label: '💡 Коммуналка', kw: ['endesa', 'iberdrola', 'naturgy', 'canal', 'agua', 'luz', 'gas ', 'electric', 'aqualia', 'hidralia', 'emasesa', 'repsol'] },
              { key: 'insurance', label: '🛡 Страховка', kw: ['seguro', 'mapfre', 'axa', 'allianz', 'generali', 'linea directa', 'mutua', 'asefa', 'sanitas', 'adeslas'] },
              { key: 'phone', label: '📱 Телефон', kw: ['movistar', 'orange', 'vodafone', 'yoigo', 'telefonica', 'pepephone', 'masmovil', 'digi', 'jazztel', 'o2'] },
              { key: 'internet', label: '🌐 Интернет', kw: ['internet', 'fibra', 'adsl', 'wifi'] },
              { key: 'cleaning', label: '🧹 Уборка', kw: ['limpieza', 'cleaning', 'limpio', 'уборк'] },
              { key: 'pool', label: '🏊 Бассейн', kw: ['piscina', 'pool', 'бассейн'] },
              { key: 'other', label: '🔁 Платёж', kw: [] }
            ];
            const normCpKey = (v) => String(v || '').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim().slice(0, 40);
            const recurGroups = {};
            out.forEach(m => {
              const key = normCpKey(m.counterparty) || normCpKey(m.concept);
              if (!key) return;
              if (!recurGroups[key]) recurGroups[key] = { name: String(m.counterparty || m.concept || '').trim(), items: [] };
              recurGroups[key].items.push(m);
            });
            // Метки периодичности для строк выписки (v43): по всем группам с ≥2 платежами
            const freqByKey = {};
            Object.entries(recurGroups).forEach(([key, g]) => {
              const dates = g.items.map(m => m.operation_date).filter(Boolean).sort();
              if (dates.length < 2) return;
              const fD = new Date(dates[0]), lD = new Date(dates[dates.length - 1]);
              const span = Math.max(1, (lD.getFullYear() - fD.getFullYear()) * 12 + (lD.getMonth() - fD.getMonth()) + 1);
              const perMonth = g.items.length / span;
              let info;
              if (perMonth >= 1.5) info = { icon: '🔂', text: `${Math.round(perMonth)} раза в месяц` };
              else if (perMonth >= 0.5) info = { icon: '📅', text: 'ежемесячный' };
              else if (span >= 10) info = { icon: '🗓', text: 'ежегодный' };
              else info = { icon: '🔁', text: 'периодический' };
              freqByKey[key] = info;
            });
            const freqOfMovement = (m) => freqByKey[normCpKey(m.counterparty) || normCpKey(m.concept)] || null;
            // Календарь (v42): текущий + следующий месяц, платежи по датам
            const nowD = new Date();
            const curYm = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}`;
            const calBases = [new Date(nowD.getFullYear(), nowD.getMonth() + payCalOffset, 1), new Date(nowD.getFullYear(), nowD.getMonth() + payCalOffset + 1, 1)];
            const buildCalWeeks = (base) => {
              const y = base.getFullYear(), mo = base.getMonth();
              const lead = (new Date(y, mo, 1).getDay() + 6) % 7; // неделя с понедельника
              const dim = new Date(y, mo + 1, 0).getDate();
              const cells = [];
              for (let i = 0; i < lead; i++) cells.push(null);
              for (let d = 1; d <= dim; d++) cells.push(d);
              while (cells.length % 7) cells.push(null);
              return cells;
            };
            // Календарь (v44): только ручные записи planned_payments; авто-детект — только для меток периодичности
            const paidSet = new Set();
            out.forEach(m => {
              const k = normCpKey(m.counterparty) || normCpKey(m.concept);
              if (k && m.operation_date) paidSet.add(`${k}|${m.operation_date.slice(0, 7)}`);
            });
            const manualRows = plannedPayments.map(p => ({
              manual: true, id: p.id, name: p.title, avg: p.amount, usualDay: p.dayOfMonth || 1,
              freq: p.freqMonths || 1,
              startYm: (p.startDate || '').slice(0, 7) || curYm,
              cpKey: normCpKey(p.counterparty), fileUrl: p.fileUrl || '', fileName: p.fileName || '', active: p.active !== false,
              cat: RECUR_CATS.find(c => c.key === p.category) || RECUR_CATS[RECUR_CATS.length - 1]
            }));
            const bmMonths = [...new Set(bankMovements.map(m => (m.operation_date || '').slice(0, 7)).filter(Boolean))].sort().reverse();
            const plannedCpOptions = [...new Set(bankMovements.map(m => m.counterparty).filter(Boolean))].sort((a, b) => a.localeCompare(b));
            const dueInMonth = (g, ymStr) => {
              const diff = ((+ymStr.slice(0, 4)) - (+g.startYm.slice(0, 4))) * 12 + ((+ymStr.slice(5, 7)) - (+g.startYm.slice(5, 7)));
              if (g.freq === 0) return diff === 0; // одноразовый: только месяц начала
              return diff >= 0 && diff % g.freq === 0;
            };
            // Таймлайн: диапазон месяцев, выбирается пользователем (v50)
            const tlNextMonths = [];
            {
              const dd = new Date(+tlFrom.slice(0, 4), +tlFrom.slice(5, 7) - 1, 1);
              const end = new Date(+tlTo.slice(0, 4), +tlTo.slice(5, 7) - 1, 1);
              for (let i = 0; i < 48 && dd <= end; i++) {
                tlNextMonths.push(`${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}`);
                dd.setMonth(dd.getMonth() + 1);
              }
            }
            const tlOptions = [];
            {
              const dd = new Date(nowD.getFullYear() - 2, 0, 1);
              for (let i = 0; i < 72; i++) {
                tlOptions.push(`${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}`);
                dd.setMonth(dd.getMonth() + 1);
              }
            }
            const tlYmLabel = ym => `${MONTH_NAMES[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
            // Σ за весь выбранный диапазон (v51): активные платежи, причитающиеся в каждом месяце диапазона
            const tlTotal = tlNextMonths.reduce((acc, ym) => acc + manualRows.filter(g => g.active && dueInMonth(g, ym)).reduce((a, g) => a + (g.avg || 0), 0), 0);
            const railTarget = new Map();
            bmMonths.forEach(ym => railTarget.set(ym, `bm-${ym}`));
            tlNextMonths.forEach(ym => { if (!railTarget.has(ym)) railTarget.set(ym, `tl-${ym}`); });
            const railYears = [...new Set([...railTarget.keys()].map(ym => ym.slice(0, 4)))].sort().reverse();
            return (
              <>
                {railYears.length > 0 && (
                  <div style={{ position: 'fixed', right: 6, top: '50%', transform: 'translateY(-50%)', zIndex: 90, width: 76, maxHeight: '86vh', overflowY: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none', background: 'rgba(255,255,255,0.96)', borderRadius: 14, padding: '6px 4px', boxShadow: '0 2px 12px rgba(0,0,0,0.10)' }}>
                    <button onClick={() => { const el = document.getElementById('paycal-top'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} title="К началу плана платежей"
                      style={{ display: 'block', width: '100%', WebkitAppearance: 'none', appearance: 'none', border: 'none', background: 'none', boxShadow: 'none', margin: 0, padding: '3px 0', fontSize: 18, cursor: 'pointer', borderRadius: 6, fontFamily: 'inherit', lineHeight: 1.2 }}>📅</button>
                    <button onClick={() => { const el = document.getElementById('banklist-top'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} title="К началу выписки банка"
                      style={{ display: 'block', width: '100%', WebkitAppearance: 'none', appearance: 'none', border: 'none', background: 'none', boxShadow: 'none', margin: '0 0 4px', padding: '3px 0', fontSize: 18, cursor: 'pointer', borderRadius: 6, fontFamily: 'inherit', lineHeight: 1.2 }}>🏦</button>
                    {railYears.map(y => {
                      const months = [...railTarget.keys()].filter(ym => ym.startsWith(y)).sort().reverse();
                      return (
                        <div key={`ry_${y}`}>
                          <button onClick={() => { const el = document.getElementById(railTarget.get(months[0])); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                            style={{ display: 'block', width: '100%', WebkitAppearance: 'none', appearance: 'none', border: 'none', background: 'none', boxShadow: 'none', margin: '4px 0 0', padding: '3px 0', fontSize: 14, fontWeight: 800, color: '#1d1d1f', cursor: 'pointer', borderRadius: 6, whiteSpace: 'nowrap', fontFamily: 'inherit' }}>
                            {y}
                          </button>
                          {months.map(ym => (
                            <button key={`r_${ym}`} onClick={() => { const el = document.getElementById(railTarget.get(ym)); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                              style={{ display: 'block', width: '100%', WebkitAppearance: 'none', appearance: 'none', border: 'none', background: ym === curYm ? '#eef4ff' : 'none', boxShadow: 'none', margin: 0, padding: '3px 0', fontSize: 13, fontWeight: 600, color: '#3a3a3c', cursor: 'pointer', borderRadius: 6, whiteSpace: 'nowrap', fontFamily: 'inherit' }}>
                              {MONTH_NAMES[+ym.slice(5, 7) - 1].slice(0, 3)}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
                {bankMovements.length === 0 && !bankLoading && (
                  <div style={{ background: 'linear-gradient(180deg,#ffffff,#ececf0)', border: '1px solid #d2d2d7', borderRadius: 12, padding: 12, marginBottom: 4 }}>
                    Выписка ещё не загружена. Откройте вкладку «Загрузка» → кнопка «🏦 Выписка банка» и выберите Excel-файл (.xlsx) из банка — движения появятся здесь, а фактуры с совпавшими суммами сами получат статус 🟢 Оплачено.
                  </div>
                )}
                {(manualRows.length > 0 || bankMovements.length > 0) && (
                  <div id="paycal-top" style={{ background: '#fff', border: '1px solid #e3e6ea', borderRadius: 12, padding: '10px 12px', marginBottom: 10, scrollMarginTop: 100 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: payCalCollapsed ? 0 : 8 }}>
                      <button onClick={() => setPayCalCollapsed(c => !c)} title="Свернуть/развернуть блок" style={{ border: '1px solid #d2d2d7', background: '#fff', borderRadius: 8, padding: '2px 8px', cursor: 'pointer', fontSize: 12, lineHeight: 1.4 }}>{payCalCollapsed ? '▸' : '▾'}</button>
                      <span style={{ fontSize: 15, fontWeight: 800, color: '#1d1d1f' }}>📅 Обязательные повторяющиеся платежи</span>
                      <span style={{ fontSize: 11, color: '#8e8e93' }}>🟢 оплачен (по выписке) · жёлтый — плановый · клик по дню — добавить · 📅 в строке выписки — в календарь (Duque, Kit, Maria, Volvo, Porsche, Mercedes × 1/2/6/12 мес)</span>
                      <button onClick={() => setPlannedModal(true)} style={{ marginLeft: 'auto', border: 'none', background: '#0071e3', color: '#fff', borderRadius: 980, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>＋ Добавить платёж</button>
                    </div>
                    {payCalCollapsed ? null : (
                      <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <button onClick={() => setPayCalOffset(o => o - 2)} title="На 2 месяца назад" style={{ border: '1px solid #d2d2d7', background: '#fff', borderRadius: 980, padding: '3px 12px', cursor: 'pointer', fontSize: 13 }}>←</button>
                        <button onClick={() => setPayCalOffset(o => o + 2)} title="На 2 месяца вперёд" style={{ border: '1px solid #d2d2d7', background: '#fff', borderRadius: 980, padding: '3px 12px', cursor: 'pointer', fontSize: 13 }}>→</button>
                        <button onClick={() => setPayCalOffset(0)} style={{ border: '1px solid #d2d2d7', background: '#fff', borderRadius: 980, padding: '3px 12px', cursor: 'pointer', fontSize: 13 }}>Сегодня</button>
                      </div>
                      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                        {calBases.map((base, bi) => {
                          const cy = base.getFullYear(), cmo = base.getMonth();
                          const ymStr = `${cy}-${String(cmo + 1).padStart(2, '0')}`;
                          const dim = new Date(cy, cmo + 1, 0).getDate();
                          const cells = buildCalWeeks(base);
                          const dayItems = manualRows.filter(g => g.active && dueInMonth(g, ymStr)).map(g => ({
                            key: `m_${g.id}`, label: `${g.cat.label} ${g.name}`, amount: g.avg,
                            day: Math.min(g.usualDay || 1, dim),
                            paid: g.cpKey ? paidSet.has(`${g.cpKey}|${ymStr}`) : false,
                            manual: true
                          }));
                          return (
                            <div key={ymStr} style={{ flex: '1 1 360px', minWidth: 300 }}>
                              <div style={{ fontSize: 14, fontWeight: 800, margin: '2px 0 6px', color: bi === 0 ? '#0071e3' : '#1d1d1f' }}>{MONTH_NAMES[cmo]} {cy}</div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 3 }}>
                                {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(w => (
                                  <div key={w} style={{ fontSize: 10, color: '#8e8e93', textAlign: 'center', fontWeight: 700 }}>{w}</div>
                                ))}
                                {cells.map((d, ci) => {
                                  const itemsHere = d ? dayItems.filter(it => it.day === d) : [];
                                  const isToday = ymStr === curYm && d === nowD.getDate();
                                  return (
                                    <div key={ci} onClick={() => { if (d) { setPlannedForm(f => ({ ...f, day: String(d) })); setPlannedModal(true); } }} title={d ? 'Нажмите, чтобы добавить платёж на этот день' : ''}
                                      style={{ minHeight: 58, minWidth: 0, overflow: 'hidden', borderRadius: 8, border: `1px solid ${isToday ? '#0a84ff' : '#f0f0f0'}`, background: d ? (isToday ? '#f0f7ff' : '#fafafa') : 'transparent', padding: 2, cursor: d ? 'pointer' : 'default' }}>
                                      {d && <div style={{ fontSize: 10, fontWeight: isToday ? 800 : 600, color: isToday ? '#0a84ff' : '#6e6e73', textAlign: 'right', paddingRight: 3 }}>{d}</div>}
                                      {itemsHere.map(it => (
                                        <div key={it.key} title={`${it.label}${it.amount != null ? ` — ${formatAmount(it.amount, 'EUR')}` : ''}${it.paid ? ' (оплачен)' : ' (ожидается)'}`}
                                          style={{ fontSize: 9, lineHeight: 1.3, borderRadius: 4, padding: '1px 4px', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default',
                                            background: it.paid ? '#e8f8ef' : it.manual ? '#fff6dd' : '#eef4ff',
                                            color: it.paid ? '#1e7e34' : it.manual ? '#8a6d3b' : '#3457d5',
                                            border: `1px solid ${it.paid ? '#b7e4c7' : it.manual ? '#f0dfa8' : '#cfdefc'}` }}>
                                          {it.paid ? '🟢' : '◌'} {it.label}{it.amount != null ? ` · ${formatAmount(it.amount, 'EUR')}` : ''}
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      </div>
                    )}
                    {!payCalCollapsed && manualRows.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        {manualRows.map(g => (
                          <div key={`del_${g.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#fff', borderRadius: 8, padding: '8px 10px', marginBottom: 6, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', opacity: g.active ? 1 : 0.55 }}>
                            <span style={{ flex: '0 0 86px', color: '#7f8c8d', fontSize: 13 }}>~{String(g.usualDay || 1).padStart(2, '0')} числа</span>
                            <span style={{ flex: '1 1 240px', minWidth: 0, overflowWrap: 'break-word', fontSize: 14 }}>
                              <b>{g.name}</b>
                              <span title={`Повторяющийся платёж: ${calFreqLabel(g.freq)}`} style={{ marginLeft: 6, fontSize: 10, color: '#5856d6', background: '#efeffd', borderRadius: 8, padding: '1px 7px', fontWeight: 700, whiteSpace: 'nowrap' }}>🔁 {calFreqLabel(g.freq)}</span>
                              {g.active && (<span style={{ marginLeft: 6, fontSize: 11, color: '#8e8e93', whiteSpace: 'nowrap' }}>{(() => { for (let i = 0; i < 24; i++) { const dd2 = new Date(nowD.getFullYear(), nowD.getMonth() + i, 1); const ym2 = `${dd2.getFullYear()}-${String(dd2.getMonth() + 1).padStart(2, '0')}`; if (dueInMonth(g, ym2)) return `след: ${MONTH_NAMES[+ym2.slice(5, 7) - 1].slice(0, 3)} ${ym2.slice(2, 4)}`; } return ''; })()}</span>)}
                            </span>
                            <span style={{ flex: '0 0 110px', textAlign: 'right' }}>
                              <span style={{ fontWeight: 700, color: '#e74c3c' }}>−{formatAmount(g.avg || 0, 'EUR')}</span>
                            </span>
                            {g.fileUrl ? (
                              g.fileUrl.startsWith('receipt:') ? (
                                <button type="button" onClick={() => openReceiptById(g.fileUrl.slice(8))} title={g.fileName || 'Фактура'} style={{ flex: '0 0 auto', fontSize: 12, color: '#27ae60', background: '#e8f8ef', border: '1px solid #27ae60', borderRadius: 10, padding: '3px 10px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>🟢 {g.fileName || 'Фактура'}</button>
                              ) : (
                                <a href={g.fileUrl} target="_blank" rel="noreferrer" title={g.fileName || 'Фактура'} style={{ flex: '0 0 auto', fontSize: 12, color: '#27ae60', background: '#e8f8ef', border: '1px solid #27ae60', borderRadius: 10, padding: '3px 10px', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>🟢 Фактура</a>
                              )
                            ) : (
                              <span style={{ flex: '0 0 auto', fontSize: 12, color: '#e67e22', background: '#fdf2e3', borderRadius: 10, padding: '3px 10px', fontWeight: 700 }}>⚪ Без фактуры</span>
                            )}
                            <button onClick={() => togglePlannedPayment(g)} title={g.active ? 'Сделать неактивным (убрать из календаря и таймлайна)' : 'Сделать активным'}
                              style={{ flex: '0 0 auto', border: `1px solid ${g.active ? '#27ae60' : '#8e8e93'}`, background: g.active ? '#e8f8ef' : '#f2f2f7', color: g.active ? '#27ae60' : '#8e8e93', borderRadius: 10, padding: '3px 10px', fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              {g.active ? '🟢 Активна' : '⚪ Неактивна'}
                            </button>
                            <button onClick={() => removePlannedPayment(g.id)} title="Удалить плановый платёж" style={{ flex: '0 0 auto', border: '1px solid #e74c3c', background: '#fff', color: '#e74c3c', borderRadius: 10, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}>✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                    {!payCalCollapsed && manualRows.length > 0 && (
                      <div style={{ marginTop: 10, borderTop: '1px dashed #e3e6ea', paddingTop: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, fontWeight: 800, color: '#6e6e73' }}>🗓 Таймлайн платежей</span>
                          <span style={{ fontSize: 12, color: '#8e8e93' }}>с</span>
                          <select value={tlFrom} onChange={e => setTlFrom(e.target.value)} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 12, background: '#fff' }}>
                            {tlOptions.map(ym => <option key={`f_${ym}`} value={ym}>{tlYmLabel(ym)}</option>)}
                          </select>
                          <span style={{ fontSize: 12, color: '#8e8e93' }}>по</span>
                          <select value={tlTo} onChange={e => setTlTo(e.target.value)} style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 12, background: '#fff' }}>
                            {tlOptions.map(ym => <option key={`t_${ym}`} value={ym}>{tlYmLabel(ym)}</option>)}
                          </select>
                          <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: '#e74c3c', whiteSpace: 'nowrap' }}>Σ за период: −{formatAmount(tlTotal, 'EUR')}</span>
                        </div>
                        {tlNextMonths.map(ym => {
                          const due = manualRows.filter(g => g.active && dueInMonth(g, ym)).sort((a, b) => (a.usualDay || 1) - (b.usualDay || 1));
                          if (!due.length) return null;
                          const sum = due.reduce((a, g) => a + (g.avg || 0), 0);
                          return (
                            <div key={ym} id={`tl-${ym}`} style={{ marginBottom: 10, scrollMarginTop: 100 }}>
                              <div style={{ display: 'flex', alignItems: 'baseline', padding: '0 2px 5px' }}>
                                <span style={{ fontWeight: 800, fontSize: 13, color: ym === curYm ? '#0071e3' : '#1d1d1f' }}>{MONTH_NAMES[+ym.slice(5, 7) - 1].slice(0, 3)} {ym.slice(2, 4)}</span>
                                <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 12, color: '#6e6e73', whiteSpace: 'nowrap' }}>Σ {formatAmount(sum, 'EUR')}</span>
                              </div>
                              {due.map(g => (
                                <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#fff', borderRadius: 8, padding: '8px 10px', marginBottom: 6, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                                  <span style={{ flex: '0 0 86px', color: '#7f8c8d', fontSize: 13 }}>~{String(g.usualDay || 1).padStart(2, '0')}.{ym.slice(5, 7)}.{ym.slice(0, 4)}</span>
                                  <span style={{ flex: '1 1 240px', minWidth: 0, overflowWrap: 'break-word', fontSize: 14 }}>
                                    <b>{g.name}</b>
                                    <span title={`Повторяющийся платёж: ${calFreqLabel(g.freq)}`} style={{ marginLeft: 6, fontSize: 10, color: '#5856d6', background: '#efeffd', borderRadius: 8, padding: '1px 7px', fontWeight: 700, whiteSpace: 'nowrap' }}>🔁 {calFreqLabel(g.freq)}</span>
                                  </span>
                                  <span style={{ flex: '0 0 130px', textAlign: 'right' }}>
                                    <span style={{ fontWeight: 700, color: '#e74c3c' }}>−{formatAmount(g.avg || 0, 'EUR')}</span>
                                  </span>
                                  {g.fileUrl ? (
                                    g.fileUrl.startsWith('receipt:') ? (
                                      <button type="button" onClick={() => openReceiptById(g.fileUrl.slice(8))} title={g.fileName || 'Фактура'} style={{ flex: '0 0 auto', fontSize: 12, color: '#27ae60', background: '#e8f8ef', border: '1px solid #27ae60', borderRadius: 10, padding: '3px 10px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>🟢 {g.fileName || 'Фактура'}</button>
                                    ) : (
                                      <a href={g.fileUrl} target="_blank" rel="noreferrer" title={g.fileName || 'Фактура'} style={{ flex: '0 0 auto', fontSize: 12, color: '#27ae60', background: '#e8f8ef', border: '1px solid #27ae60', borderRadius: 10, padding: '3px 10px', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>🟢 Фактура</a>
                                    )
                                  ) : (
                                    <span style={{ flex: '0 0 auto', fontSize: 12, color: '#e67e22', background: '#fdf2e3', borderRadius: 10, padding: '3px 10px', fontWeight: 700 }}>⚪ Без фактуры</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                <div id="banklist-top" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 8px', scrollMarginTop: 100 }}>
                  <button onClick={() => setBankListCollapsed(c => !c)} title="Свернуть/развернуть выписку" style={{ border: '1px solid #d2d2d7', background: '#fff', borderRadius: 8, padding: '2px 8px', cursor: 'pointer', fontSize: 12, lineHeight: 1.4 }}>{bankListCollapsed ? '▸' : '▾'}</button>
                  <span style={{ fontSize: 15, fontWeight: 800, color: '#1d1d1f' }}>🏦 Выписка банка</span>
                  {bankListCollapsed && <span style={{ fontSize: 11, color: '#8e8e93' }}>скрыто строк: {visible.length} · Σ −{formatAmount(sumVis.out, 'EUR')}</span>}
                </div>
                <div style={{ display: bankListCollapsed ? 'none' : 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 0 }}>
                  <select value={bankFilter} onChange={e => setBankFilter(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 14, background: '#fff', color: '#333', height: 36, boxSizing: 'border-box' }}>
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
                <div style={{ display: bankListCollapsed ? 'none' : 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: '#555', marginBottom: 4, background: '#f4f6f7', borderRadius: 8, padding: '6px 10px' }}>
                  <span>Показано строк: <b>{visible.length}</b> из {bankMovements.length}</span>
                  <span>Σ по фильтру: <b style={{ color: '#e74c3c' }}>−{formatAmount(sumVis.out, 'EUR')}</b> / <b style={{ color: '#27ae60' }}>+{formatAmount(sumVis.inc, 'EUR')}</b></span>
                  <span style={{ marginLeft: 'auto', textAlign: 'right', whiteSpace: 'nowrap' }}>Σ всей выписки: <b style={{ color: '#e74c3c' }}>−{formatAmount(sumAll.out, 'EUR')}</b> / <b style={{ color: '#27ae60' }}>+{formatAmount(sumAll.inc, 'EUR')}</b></span>
                </div>
                {bankLoading && <div className="loading-center"><div className="spinner"></div><p>Загрузка движений...</p></div>}
                {!bankLoading && !bankListCollapsed && visible.map((m, mi) => {
                  const bmYm = (m.operation_date || '').slice(0, 7);
                  const bmAnchor = mi === 0 || (visible[mi - 1].operation_date || '').slice(0, 7) !== bmYm;
                  const linked = linkedReceiptOf(m);
                  return (
                    <div key={m.id} id={bmAnchor ? `bm-${bmYm}` : undefined} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#fff', borderRadius: 8, padding: '8px 10px', marginBottom: 6, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', scrollMarginTop: 100 }}>
                      <span style={{ flex: '0 0 86px', color: '#7f8c8d', fontSize: 13 }}>{formatDate(m.operation_date)}</span>
                      <span onClick={() => applyBankCpFilter(m.counterparty || m.concept)} title="Клик — отфильтровать выписку по этому контрагенту (чип + поисковая строка)"
                        style={{ flex: '1 1 240px', minWidth: 0, overflowWrap: 'break-word', fontSize: 14, cursor: 'pointer' }}>
                        <b style={{ color: '#1d1d1f', borderBottom: '1px dashed #c7c7cc' }}>{m.concept || '—'}</b>
                        {m.prefix && <span style={{ marginLeft: 6, fontSize: 11, color: '#95a5a6' }}>{m.prefix}</span>}
                        {freqOfMovement(m) && (
                          <span title={`Повторяющийся платёж: ${freqOfMovement(m).text}`} style={{ marginLeft: 6, fontSize: 10, color: '#5856d6', background: '#efeffd', borderRadius: 8, padding: '1px 7px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            {freqOfMovement(m).icon} {freqOfMovement(m).text}
                          </span>
                        )}
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
                      {isOut(m) && (
                        <span style={{ position: 'relative', flex: '0 0 auto' }}>
                          <button onClick={(e) => { e.stopPropagation(); setCalPicker(calPicker === m.id ? null : m.id); }} title="Добавить платёж в календарь (имя + частота)" style={{ border: '1px solid #d2d2d7', background: calPicker === m.id ? '#eef4ff' : '#fff', color: '#1d1d1f', borderRadius: 10, padding: '3px 9px', fontSize: 12, cursor: 'pointer' }}>📅▾</button>
                          {calPicker === m.id && (
                            <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', right: 0, top: '110%', zIndex: 120, background: '#fff', border: '1px solid #d2d2d7', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.16)', padding: 6, width: 230, maxHeight: 330, overflowY: 'auto' }}>
                              <div style={{ display: 'flex', alignItems: 'center', padding: '2px 4px 6px 8px' }}>
                                <span style={{ fontSize: 10, color: '#8e8e93', flex: 1 }}>В календарь: имя → частота (мес)</span>
                                <button onClick={() => setCalPicker(null)} title="Закрыть меню" style={{ border: 'none', background: 'none', color: '#8e8e93', cursor: 'pointer', fontSize: 13, padding: '0 4px' }}>✕</button>
                              </div>
                              {CAL_PAYEES.map(name => (
                                <div key={name}>
                                  <div style={{ fontSize: 11, fontWeight: 800, color: '#1d1d1f', padding: '5px 8px 1px', borderTop: '1px solid #f0f0f0' }}>{name}</div>
                                  {CAL_FREQS.map(n => (
                                    <button key={n} onClick={() => assignToCalendar(m, name, n)}
                                      style={{ display: 'block', width: '100%', textAlign: 'left', WebkitAppearance: 'none', appearance: 'none', border: 'none', borderRadius: 6, background: 'none', boxShadow: 'none', margin: 0, padding: '4px 8px 4px 20px', fontSize: 13, color: '#3457d5', cursor: 'pointer', fontFamily: 'inherit' }}>
                                      {n === 0 ? '⚡ 1 раз — одноразовый' : `${n} — ${calFreqLabel(n)}`}
                                    </button>
                                  ))}
                                </div>
                              ))}
                              {plannedPayments.some(pp => normCpKey(pp.counterparty) && normCpKey(pp.counterparty) === (normCpKey(m.counterparty) || normCpKey(m.concept))) && (
                                <button onClick={() => resetCalendarChoice(m)}
                                  style={{ display: 'block', width: '100%', textAlign: 'left', WebkitAppearance: 'none', appearance: 'none', border: 'none', borderTop: '1px solid #f0f0f0', background: 'none', margin: '4px 0 0', padding: '7px 8px 3px', fontSize: 12, color: '#e74c3c', cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit' }}>
                                  ✖ Сбросить выбор (убрать из календаря)
                                </button>
                              )}
                            </div>
                          )}
                        </span>
                      )}
                    </div>
                  );
                })}
                {!bankLoading && !bankListCollapsed && bankMovements.length > 0 && visible.length === 0 && (
                  <p style={{ color: '#95a5a6' }}>Ничего не найдено по текущему фильтру.</p>
                )}
                {plannedModal && (
                  <div onClick={() => setPlannedModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                    <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 18, width: '100%', maxWidth: 380 }}>
                      <h3 style={{ margin: '0 0 12px', fontSize: 17 }}>＋ Плановый платёж</h3>
                      <div style={{ display: 'grid', gap: 10 }}>
                        <label style={{ fontSize: 12, color: '#6e6e73' }}>Название (например: Коммуналка, Страховка, Телефон, Интернет, Уборка, Бассейн)
                          <input autoFocus value={plannedForm.title} onChange={e => setPlannedForm(f => ({ ...f, title: e.target.value }))} placeholder="Например: Интернет Movistar" style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid #d2d2d7', fontSize: 14 }} />
                        </label>
                        <label style={{ fontSize: 12, color: '#6e6e73' }}>Объект (как в меню выписки)
                          <select value={plannedForm.object} onChange={e => setPlannedForm(f => ({ ...f, object: e.target.value }))} style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid #d2d2d7', fontSize: 14, background: '#fff' }}>
                            <option value="">— не привязан —</option>
                            {CAL_PAYEES.map(name => <option key={name} value={name}>{name}</option>)}
                          </select>
                        </label>
                        <label style={{ fontSize: 12, color: '#6e6e73' }}>Контрагент (из выписки или вручную)
                          <input list="planned-cp-list" value={plannedForm.counterparty} onChange={e => setPlannedForm(f => ({ ...f, counterparty: e.target.value }))} placeholder="Например: o2 fibra - telefonica de espana sau" style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid #d2d2d7', fontSize: 14 }} />
                          <datalist id="planned-cp-list">
                            {plannedCpOptions.map(cp => <option key={cp} value={cp} />)}
                          </datalist>
                        </label>
                        <label style={{ fontSize: 12, color: '#6e6e73' }}>Категория
                          <select value={plannedForm.category} onChange={e => setPlannedForm(f => ({ ...f, category: e.target.value }))} style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid #d2d2d7', fontSize: 14, background: '#fff' }}>
                            {RECUR_CATS.filter(c => c.key !== 'other').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                            <option value="other">🔁 Другое</option>
                          </select>
                        </label>
                        <label style={{ fontSize: 12, color: '#6e6e73' }}>Частота
                          <select value={plannedForm.freq} onChange={e => setPlannedForm(f => ({ ...f, freq: e.target.value }))} style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid #d2d2d7', fontSize: 14, background: '#fff' }}>
                            {CAL_FREQS.map(n => <option key={n} value={n}>{calFreqLabel(n)}</option>)}
                          </select>
                        </label>
                        <div style={{ fontSize: 12, color: '#6e6e73' }}>Фактура (файл из выписки: pdf, фото)
                          {plannedForm.fileUrl ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                              <a href={plannedForm.fileUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#0071e3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>📎 {plannedForm.fileName || 'Фактура'}</a>
                              <button type="button" onClick={() => setPlannedForm(f => ({ ...f, fileUrl: '', fileName: '' }))} style={{ border: 'none', background: 'none', color: '#e74c3c', cursor: 'pointer', fontSize: 13 }}>✕</button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                              <input type="file" accept=".pdf,image/*,.jpg,.jpeg,.png,.webp,.heic" onChange={e => { const fl = e.target.files && e.target.files[0]; if (fl) uploadPlannedFile(fl); e.target.value = ''; }} style={{ fontSize: 13, flex: '1 1 180px' }} />
                              <button type="button" onClick={() => { setPlannedModal(false); setPlannedPickMode(true); setActiveTab('list'); loadReceipts(); }} style={{ border: '1px solid #8e44ad', background: '#fff', color: '#8e44ad', borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>🧾 Выбрать из распознанных →</button>
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                          <label style={{ fontSize: 12, color: '#6e6e73', flex: 1 }}>Сумма, € (необязательно)
                            <input type="number" min="0" step="0.01" value={plannedForm.amount} onChange={e => setPlannedForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid #d2d2d7', fontSize: 14 }} />
                          </label>
                          <label style={{ fontSize: 12, color: '#6e6e73', flex: 1 }}>День месяца
                            <input type="number" min="1" max="31" value={plannedForm.day} onChange={e => setPlannedForm(f => ({ ...f, day: e.target.value }))} style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, padding: '8px 10px', borderRadius: 8, border: '1px solid #d2d2d7', fontSize: 14 }} />
                          </label>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                        <button onClick={() => setPlannedModal(false)} style={{ padding: '8px 16px', borderRadius: 980, border: '1px solid #c7c7cc', background: '#fff', cursor: 'pointer' }}>Отмена</button>
                        <button onClick={savePlannedPayment} disabled={plannedSaving} style={{ padding: '8px 16px', borderRadius: 980, border: 'none', background: '#0071e3', color: '#fff', fontWeight: 700, cursor: plannedSaving ? 'wait' : 'pointer' }}>{plannedSaving ? '⏳ Сохранение…' : 'Сохранить'}</button>
                      </div>
                    </div>
                  </div>
                )}
                {renderLinkPicker()}
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
        // Платежи банка показываются сразу за ВЕСЬ выбранный диапазон расчёта налогов («с … по …»), отдельного выбора квартала больше нет
        const qRangeKeys = [taxQFrom, taxQTo].sort();
        const [qFrom] = taxQuarterRange(qRangeKeys[0]);
        const [, qTo] = taxQuarterRange(qRangeKeys[1]);
        const qOut = bankMovements.filter(m => Number(m.amount) < 0 && m.operation_date && m.operation_date >= qFrom && m.operation_date <= qTo);
        // v61.3: итоги диапазона — общий приход / общий расход / подтверждено фактурами
        const qInc = bankMovements.filter(m => Number(m.amount) > 0 && m.operation_date && m.operation_date >= qFrom && m.operation_date <= qTo);
        const sumAbs = (list) => list.reduce((a, m) => a + Math.abs(Number(m.amount) || 0), 0);
        const qIncSum = sumAbs(qInc);
        const qOutSum = sumAbs(qOut);
        const qInvSum = sumAbs(qOut.filter(isConfirmedExpense));
        // v62.1: из них авто-вычеты (налоги / Seguridad Social / зарплаты) — без фактуры
        const qAutoSum = sumAbs(qOut.filter(m => !m.has_invoice && !m.matched_receipt_id && autoDeductOf(m)));
        // v61.4: налоги за выбранный диапазон (IGIC 420 + IRPF 111) — тем же расчётом, что и автозаполнение форм
        const qRangeTax = computeTaxRange(qRangeKeys[0], qRangeKeys[1]);
        // v61.5: справочная статистика банка (перенесена из «Анализа»)
        const qBankMatched = bankMovements.filter(m => m.matched_receipt_id).length;
        const qBankUnmatchedOut = bankMovements.filter(m => Number(m.amount) < 0 && !m.matched_receipt_id).length;
        // v67.5/v67.9.2: суммы затрат по категориям. «Всего по выписке» = ТОЛЬКО строки банковской выписки
        // (ручные платежи «из карточки фактуры» — отдельная плашка, иначе общая сумма расхода завышалась)
        const isManualMvt = (m) => m.prefix === 'manual' || m.account_name === 'Ручное добавление';
        const qOutStmt = bankMovements.filter(m => Number(m.amount) < 0 && !isManualMvt(m));
        const qCatManual = bankMovements.filter(m => Number(m.amount) < 0 && isManualMvt(m));
        const qSumOf = (list) => list.reduce((a, m) => a + Math.abs(Number(m.amount) || 0), 0);
        const qCatLinked = qOutStmt.filter(m => !!m.matched_receipt_id);                      // привязанные фактуры
        const qCatAuto = qOutStmt.filter(m => !m.matched_receipt_id && autoDeductOf(m));      // налог-автовычет
        const qCatFlag = qOutStmt.filter(m => !m.matched_receipt_id && !autoDeductOf(m) && m.has_invoice); // помечены галкой (без привязанных)
        const qCatNone = qOutStmt.filter(m => !m.matched_receipt_id && !autoDeductOf(m) && !m.has_invoice); // без фактур
        const qBankUnpaidBills = receipts.filter(r => ['bill', 'invoice'].includes(r.document_type) && !r.bank_movement_id && r.payment_status !== 'paid').length;
        // v67.4/v67.5: плашки статистики — АКТИВНЫЕ фильтры, показывают СУММЫ по категориям (клик — включить, повторный клик — сбросить)
        const qBankStat = (label, sumVal, count, color, chipKey) => {
          const active = chipKey ? qBankChip === chipKey : qBankChip === null;
          return (
            <div key={label} onClick={() => setQBankChip(prev => (chipKey && prev !== chipKey) ? chipKey : null)}
              title={chipKey ? `Нажмите — отфильтровать платежи: ${label}` : 'Сбросить фильтр по признаку'}
              style={{ flex: '0 0 auto', display: 'flex', alignItems: 'baseline', gap: 6, background: active ? 'linear-gradient(180deg,#eef4ff,#dbe7fd)' : 'linear-gradient(180deg,#ffffff,#ececf0)', border: active ? '2px solid #1d4ed8' : '1px solid #d2d2d7', borderRadius: 999, padding: '3px 12px', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}>
              <span style={{ fontSize: 15, fontWeight: 800, color }}>{formatAmount(sumVal, 'EUR')}</span>
              <span style={{ fontSize: 12, color: '#6e6e73' }}>{label} · {count}</span>
            </div>
          );
        };
        // v60.1: локальный фильтр по контрагенту (клик по строке или поисковая строка)
        const qCpQ = qCpSearch.trim().toLowerCase();
        // v63: активный слот (1..5) → показываем только запомненные в нём платежи
        const pmSlotIds = pmSlotView ? new Set(pmSlots[String(pmSlotView)] || []) : null;
        const qOutSlot = pmSlotIds ? qOut.filter(m => pmSlotIds.has(String(m.id))) : qOut;
        // v64.1: фильтры по столбцам — контрагент (qCpSearch), дата (подстрока, напр. 2025-06), сумма от/до
        const qAmtMinN = parseFloat(qAmtMin), qAmtMaxN = parseFloat(qAmtMax);
        // v64.2: контрагенты диапазона по алфавиту — для выпадающего фильтра
        const qCpList = [...new Set(qOut.map(m => String(m.counterparty || m.concept || '').trim()).filter(Boolean))]
          .sort((a, b) => qCpSortAsc ? a.localeCompare(b, 'es', { sensitivity: 'base' }) : b.localeCompare(a, 'es', { sensitivity: 'base' }));
        let qOutVis = qOutSlot.filter(m => {
          if (qCpQ) {
            // v67.6: поиск по всем столбцам — контрагент, концепт, дата, сумма, привязанная фактура
            const linked = m.matched_receipt_id ? receipts.find(r => String(r.id) === String(m.matched_receipt_id)) : null;
            const amt = Math.abs(Number(m.amount) || 0);
            const hay = [
              m.counterparty, m.concept,
              m.operation_date, m.operation_date ? formatDate(m.operation_date) : '',
              String(amt), amt.toFixed(2), formatAmount(amt, 'EUR'),
              linked ? (linked.store_name || '') : '', linked ? (linked.store_name_ru || '') : '',
              linked ? (linked.provider || '') : '', linked ? String(linked.total_amount || '') : '',
              linked && linked.invoice_number ? String(linked.invoice_number) : '',
              autoDeductOf(m) ? 'налог авто-вычет autodeducir' : '',
              m.has_invoice ? 'есть фактура в расходах' : ''
            ].join(' ').toLowerCase().replace(/[\s.,\u00a0]+/g, ' ');
            const needle = qCpQ.replace(/[\s.,\u00a0]+/g, ' ');
            if (!hay.includes(needle)) return false;
          }
          if (qDateFilter.trim() && !String(m.operation_date || '').includes(qDateFilter.trim())) return false;
          const amt = Math.abs(Number(m.amount) || 0);
          if (!Number.isNaN(qAmtMinN) && qAmtMin !== '' && amt < qAmtMinN) return false;
          if (!Number.isNaN(qAmtMaxN) && qAmtMax !== '' && amt > qAmtMaxN) return false;
          return true;
        });
        // v65: фильтр по галке выбора (выбранные / не выбранные); при активном варианте — членство в нём
        const qSelOf = (m) => pmSlotArm ? pmSlotHas(pmSlotArm, m.id) : !!pmSelected[String(m.id)];
        if (qSelFilter === 'sel') qOutVis = qOutVis.filter(qSelOf);
        else if (qSelFilter === 'unsel') qOutVis = qOutVis.filter(m => !qSelOf(m));
        // v67.5: фильтр по плашкам-категориям затрат
        if (qBankChip === 'linked') qOutVis = qOutVis.filter(m => !!m.matched_receipt_id);
        else if (qBankChip === 'auto') qOutVis = qOutVis.filter(m => !m.matched_receipt_id && autoDeductOf(m));
        else if (qBankChip === 'flagged') qOutVis = qOutVis.filter(m => !m.matched_receipt_id && !autoDeductOf(m) && !!m.has_invoice);
        else if (qBankChip === 'none') qOutVis = qOutVis.filter(m => !m.matched_receipt_id && !autoDeductOf(m) && !m.has_invoice);
        else if (qBankChip === 'manual') qOutVis = qOutVis.filter(isManualMvt);
        // v64.4: сортировка строк по контрагенту А→Я / Я→А (кнопка у фильтра); внутри контрагента — по дате, новые сверху
        qOutVis.sort((a, b) => {
          const ca = String(a.counterparty || a.concept || '').toLowerCase();
          const cb = String(b.counterparty || b.concept || '').toLowerCase();
          const c = ca.localeCompare(cb, 'es', { sensitivity: 'base' });
          if (c !== 0) return qCpSortAsc ? c : -c;
          return String(b.operation_date || '').localeCompare(String(a.operation_date || ''));
        });
        const pmSelIds = Object.keys(pmSelected).filter(id => pmSelected[id]);
        const pmSelSum = qOut.filter(m => pmSelected[String(m.id)]).reduce((a, m) => a + Math.abs(Number(m.amount) || 0), 0);
        const fmtD = d => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
        // Опции кварталов покрывают все годы, за которые есть движения в банке (плюс текущий ±1)
        const mvtYears = bankMovements.map(m => m.operation_date ? +m.operation_date.slice(0, 4) : year).filter(y => y > 2000 && y < 2100);
        const minOptY = Math.min(year - 1, ...mvtYears), maxOptY = Math.max(year + 1, ...mvtYears);
        const quarterOptions = [];
        for (let y = minOptY; y <= maxOptY; y++) for (let q = 1; q <= 4; q++) quarterOptions.push(`${y}-${q}T`);
        const taxIconBtn = (open) => ({
          fontSize: 20, lineHeight: 1, padding: '6px 10px', borderRadius: 8, cursor: 'pointer',
          border: `1px solid ${open ? '#8e8e93' : '#d2d2d7'}`, background: open ? 'linear-gradient(180deg,#ffffff,#e4e4e8)' : '#fff'
        });
        return (
          <div style={{ padding: '6px 0 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '4px 0' }}>
              <h2 style={{ margin: 0 }}>🧾 Налоги (Испания · Канары)</h2>
              <button onClick={() => setTaxCalOpen(v => !v)} style={taxIconBtn(taxCalOpen)} title="Календарь налоговых дедлайнов">📅</button>
              <button onClick={() => setTaxGuideOpen(v => !v)} style={taxIconBtn(taxGuideOpen)} title="Справочник: какие налоги и какие документы подавать">📚</button>
            </div>

            {/* ОПОВЕЩЕНИЕ: за месяц до дедлайна — что подать и что подготовить */}
            {soon.length > 0 && (
              <div style={{ background: 'linear-gradient(180deg,#ffffff,#e8e8ed)', border: '2px solid #8e8e93', borderRadius: 12, padding: '12px 16px', marginBottom: 14 }}>
                <strong style={{ color: '#1d1d1f', fontSize: 15 }}>⏰ До дедлайна меньше месяца — готовьте документы:</strong>
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

            {/* КАЛЕНДАРЬ ПЛАТЕЖЕЙ И ПОДАЧИ (открывается иконкой 📅 в шапке — v30.4) */}
            {taxCalOpen && (
            <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: '12px 16px', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 8px' }}>
                <h3 style={{ margin: 0 }}>📅 Календарь налоговых дедлайнов</h3>
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
                    background: ev.daysLeft <= 35 ? '#d9d9de' : ev.daysLeft <= 65 ? '#e8e8ed' : '#f5f5f7',
                    color: ev.daysLeft <= 35 ? '#1d1d1f' : ev.daysLeft <= 65 ? '#3a3a3c' : '#6e6e73'
                  }}>через {ev.daysLeft} дн.</span>
                  <span style={{ fontWeight: 700 }}>{ev.name}</span>
                  <span style={{ color: '#7f8c8d', fontSize: 13, flex: '1 1 260px' }}>{ev.what}</span>
                </div>
              ))}
            </div>
            )}

            {/* СПРАВОЧНИК: какие налоги и какие документы подавать (открывается иконкой 📚 в шапке — v30.4) */}
            {taxGuideOpen && (
            <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: '12px 16px', marginBottom: 14 }}>
              <h3 style={{ margin: '0 0 10px' }}>📚 Справочник: какие налоги и какие документы подавать</h3>
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
            </div>
            )}

            {/* АВТОЗАПОЛНЕНИЕ ФОРМ ИЗ БАНКА ЗА ДИАПАЗОН КВАРТАЛОВ (v30.1) */}
            <div style={{ background: 'linear-gradient(135deg,#ffffff,#e8e8ed)', border: '2px solid #c7c7cc', borderRadius: 12, padding: '12px 16px' }}>
              <h3 style={{ margin: '0 0 6px' }}>🤖 Автозаполнение форм из банка</h3>
              <p style={{ fontSize: 13, color: '#555', margin: '0 0 10px' }}>
                Выберите диапазон кварталов (например, 1T 2025 → 2T 2026). Доходы = поступления квартала; расходы = платежи с галкой «есть фактура»
                (или привязанные к фактуре); IGIC soportado — из поля «налог» привязанных фактур. За прошлые кварталы, где налог не платился,
                отдельно считаются штраф-надбавка (recargo 1% + 1% за каждый полный месяц, после 12 мес. — 15%) и пени (intereses 4,0625% годовых с 13-го месяца просрочки).
                Нажимайте «Финальный пересчёт» перед подачей — черновик всегда собирается из свежих данных.
              </p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14 }}>с</span>
                <select value={taxQFrom} onChange={e => applyTaxRange(e.target.value, taxQTo)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #c7c7cc' }}>
                  {quarterOptions.map(k => <option key={k} value={k}>{k.replace('-', ' · ')}</option>)}
                </select>
                <span style={{ fontSize: 14 }}>по</span>
                <select value={taxQTo} onChange={e => applyTaxRange(taxQFrom, e.target.value)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #c7c7cc' }}>
                  {quarterOptions.map(k => <option key={k} value={k}>{k.replace('-', ' · ')}</option>)}
                </select>
                <button
                  onClick={() => applyTaxRange(taxQFrom, taxQTo)}
                  style={{ background: '#8e44ad', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}
                >
                  🧮 Заполнить формы из банка
                </button>
                <span style={{ fontSize: 12, color: '#7f8c8d' }}>диапазон подставлен автоматически по датам движений в базе; при смене «с/по» формы заполняются сразу</span>
              </div>
            </div>

            {/* ПЛАТЕЖИ БАНКА ЗА ВЫБРАННЫЙ ДИАПАЗОН + ГАЛКА «ЕСТЬ ФАКТУРА» (ниже расчётов; диапазон общий с автозаполнением — v30.5) */}
            <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10, padding: '12px 16px', marginTop: 14 }}>
              {/* v61.5: справочная строка статистики банка — перенесена из «Анализа» в «Налоги» */}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10, overflowX: 'auto', flexWrap: 'nowrap' }}>
                <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>🏦</span>
                {qBankStat('Всего затраты по выписке', qSumOf(qOutStmt), qOutStmt.length, '#2c3e50', null)}
                {qCatManual.length > 0 && qBankStat('✍ Ручные платежи (не из выписки)', qSumOf(qCatManual), qCatManual.length, '#7d3c98', 'manual')}
                {qBankStat('Фактуры привязанные', qSumOf(qCatLinked), qCatLinked.length, '#27ae60', 'linked')}
                {qBankStat('Налог-автовычет', qSumOf(qCatAuto), qCatAuto.length, '#1e8449', 'auto')}
                {qBankStat('Помечены фактуры', qSumOf(qCatFlag), qCatFlag.length, '#8e44ad', 'flagged')}
                {qBankStat('Без фактур', qSumOf(qCatNone), qCatNone.length, '#e67e22', 'none')}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>💶 Платежи из банка за выбранный диапазон — отметьте, по каким есть фактура</h3>
                <button disabled={bankLoading} onClick={async () => { const r = await loadBankMovements(); if (r === null) alert('⚠ Движения не загрузились (таймаут или ошибка сервера) — проверьте, что householder-api переложен (redeploy), и попробуйте ещё раз.'); }}
                  style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #ccc', background: '#fff', cursor: bankLoading ? 'wait' : 'pointer' }}>{bankLoading ? '⏳ Загрузка…' : '🔄 Обновить движения'}</button>
                <button disabled={bankLoading} onClick={rematchBank} title="Обновить движения и автоматически привязать фактуры (по сумме и по названию)"
                  style={{ padding: '5px 10px', borderRadius: 6, border: 'none', background: '#8e44ad', color: '#fff', fontWeight: 700, cursor: bankLoading ? 'wait' : 'pointer' }}>🔁 Привязать фактуры</button>
                <span style={{ fontSize: 13, color: '#7f8c8d' }}>{qFrom} … {qTo} · исходящих: {qOut.length} · в расходах: {qOut.filter(isConfirmedExpense).length}</span>
                <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                  📥 приход: <b style={{ color: '#27ae60' }}>+{formatAmount(qIncSum, 'EUR')}</b>
                  {' · '}📤 расход: <b style={{ color: '#c0392b' }}>−{formatAmount(qOut.filter(m => !isManualMvt(m)).reduce((a, m) => a + Math.abs(Number(m.amount) || 0), 0), 'EUR')}</b>
                  {qOut.some(isManualMvt) && <span title="Ручные платежи, добавленные из карточек фактур — их нет в банковской выписке"> · ✍ ручные: <b style={{ color: '#7d3c98' }}>−{formatAmount(qOut.filter(isManualMvt).reduce((a, m) => a + Math.abs(Number(m.amount) || 0), 0), 'EUR')}</b></span>}
                  {' · '}📄 подтверждено: <b style={{ color: '#1e8449' }}>{formatAmount(qInvSum, 'EUR')}</b>
                </span>
                {/* v61.4: отдельная заметная плашка итогов + налоги за диапазон (всегда видна, не теряется в шапке) */}
                <div style={{ flex: '1 1 100%', display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'baseline',
                  background: '#f5f5f7', border: '1px solid #e0e0e0', borderRadius: 8, padding: '8px 12px', marginTop: 2 }}>
                  <span style={{ fontSize: 13 }}>📥 приход: <b style={{ color: '#27ae60' }}>+{formatAmount(qIncSum, 'EUR')}</b></span>
                  <span style={{ fontSize: 13 }}>📤 расход: <b style={{ color: '#c0392b' }}>−{formatAmount(qOut.filter(m => !isManualMvt(m)).reduce((a, m) => a + Math.abs(Number(m.amount) || 0), 0), 'EUR')}</b>{qOut.some(isManualMvt) && <span style={{ fontSize: 11, color: '#7d3c98' }}> (+✍ ручные {formatAmount(qOut.filter(isManualMvt).reduce((a, m) => a + Math.abs(Number(m.amount) || 0), 0), 'EUR')})</span>}</span>
                  <span style={{ fontSize: 13 }}>📄 подтверждено (расходы): <b style={{ color: '#1e8449' }}>{formatAmount(qInvSum, 'EUR')}</b>
                    {qAutoSum > 0 && <span style={{ fontSize: 11, color: '#7f8c8d' }}> (в т.ч. 🏛 налоги/соцстрах/зарплаты авто: {formatAmount(qAutoSum, 'EUR')})</span>}
                  </span>
                  <span style={{ fontSize: 13 }}>🧾 IGIC (mod.420): <b style={{ color: '#8e44ad' }}>{formatAmount(Math.max(0, qRangeTax.total420), 'EUR')}</b>
                    {qRangeTax.total420 < 0 && <span style={{ fontSize: 11, color: '#7f8c8d' }}> ({formatAmount(Math.abs(qRangeTax.total420), 'EUR')} к компенсации)</span>}
                  </span>
                  <span style={{ fontSize: 13 }}>🧾 IRPF (mod.111): <b style={{ color: '#8e44ad' }}>{formatAmount(qRangeTax.total111, 'EUR')}</b></span>
                  <span style={{ fontSize: 13 }}>🏛 IS прибыль (mod.202, {qRangeTax.isRate || 25}%): <b style={{ color: '#8e44ad' }}>{formatAmount(qRangeTax.totalIS || 0, 'EUR')}</b></span>
                  {(qRangeTax.totalRecargo > 0 || qRangeTax.totalIntereses > 0) && (
                    <span style={{ fontSize: 12, color: '#c0392b' }}>⚠ recargo {formatAmount(qRangeTax.totalRecargo, 'EUR')} · пени {formatAmount(qRangeTax.totalIntereses, 'EUR')}</span>
                  )}
                  <span style={{ fontSize: 14 }}>💰 К оплате за период: <b style={{ color: '#1d1d1f' }}>{formatAmount(qRangeTax.grandTotal, 'EUR')}</b></span>
                </div>
                {/* v63: слоты запоминания выбора 1..5 — сохранить текущие галки / вывести сохранённые */}
                <div style={{ flex: '1 1 100%', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', background: '#eef4ff', border: '1px solid #c7d7f5', borderRadius: 8, padding: '6px 10px' }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#1d4ed8' }}>💾 Варианты:</span>
                  {pmSlotArm ? (
                    <span style={{ fontSize: 12, color: '#1e8449', fontWeight: 700 }}>✔ вариант {pmSlotArm} активен: <b>{(pmSlots[String(pmSlotArm)] || []).length}</b> платежей
                      {' на '}<b>{formatAmount(bankMovements.filter(m => Number(m.amount) < 0 && (pmSlots[String(pmSlotArm)] || []).includes(String(m.id))).reduce((a, m) => a + Math.abs(Number(m.amount) || 0), 0), 'EUR')}</b>
                      <span style={{ fontWeight: 400, color: '#6e6e73' }}> · галки строк пишутся в него автоматически</span>
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, color: '#555' }}>выбрано: <b>{pmSelIds.length}</b>{pmSelIds.length > 0 && <> на <b>{formatAmount(pmSelSum, 'EUR')}</b></>}</span>
                  )}
                  <span style={{ fontSize: 12, color: '#6e6e73' }}>добавлять в →</span>
                  {[1, 2, 3, 4, 5].map(n => {
                    const armed = pmSlotArm === n;
                    return (
                      <button key={`arm${n}`}
                        title={armed ? `Вариант ${n} активен: галки строк добавляются в него автоматически (накопительно). Нажмите ещё раз — выключить` : `Включить вариант ${n}: дальше галки строк будут накапливаться в нём автоматически`}
                        onClick={() => {
                          if (armed) { setPmSlotArm(null); return; }
                          // v65 FIX: при включении варианта — текущие выбранные галки сразу попадают в него (накопительно)
                          const ids = Object.keys(pmSelected).filter(id => pmSelected[id]);
                          if (ids.length) {
                            savePmSlots(prev => { const cur = new Set(prev[String(n)] || []); ids.forEach(id => cur.add(String(id))); return { ...prev, [String(n)]: [...cur] }; });
                            setPmSelected({});
                          }
                          setPmSlotArm(n);
                        }}
                        style={{ padding: '3px 10px', borderRadius: 999, border: `1px solid ${armed ? '#1e8449' : '#1d4ed8'}`, background: armed ? '#1e8449' : '#fff', color: armed ? '#fff' : '#1d4ed8', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                        {armed ? `✔ ${n} (${(pmSlots[String(n)] || []).length})` : `${n} (${(pmSlots[String(n)] || []).length})`}
                      </button>
                    );
                  })}
                  <span style={{ fontSize: 12, color: '#6e6e73' }}>сохранить в →</span>
                  {[1, 2, 3, 4, 5].map(n => (
                    <button key={`sv${n}`} disabled={!pmSelIds.length}
                      title={pmSelIds.length ? `Запомнить выбранные ${pmSelIds.length} платежей в варианте ${n}` : 'Сначала отметьте платежи галкой ☑ в строках'}
                      onClick={() => { savePmSlots(prev => ({ ...prev, [String(n)]: pmSelIds })); setPmSlotView(null); }}
                      style={{ padding: '3px 10px', borderRadius: 999, border: '1px solid #1d4ed8', background: pmSelIds.length ? '#1d4ed8' : '#dbe4f5', color: pmSelIds.length ? '#fff' : '#8ea6cf', fontSize: 12, fontWeight: 800, cursor: pmSelIds.length ? 'pointer' : 'not-allowed' }}>
                      →{n}{(pmSlots[String(n)] || []).length > 0 && <span style={{ fontWeight: 400 }}> ({(pmSlots[String(n)] || []).length})</span>}
                    </button>
                  ))}
                  <span style={{ fontSize: 12, color: '#6e6e73', marginLeft: 8 }}>вывести из →</span>
                  {[1, 2, 3, 4, 5].map(n => {
                    const cnt = (pmSlots[String(n)] || []).length;
                    const active = pmSlotView === n;
                    return (
                      <button key={`ld${n}`} disabled={!cnt}
                        title={cnt ? `Показать сохранённые ${cnt} платежей варианта ${n}` : `Вариант ${n} пуст`}
                        onClick={() => setPmSlotView(active ? null : n)}
                        style={{ padding: '3px 10px', borderRadius: 999, border: '1px solid #7c3aed', background: active ? '#7c3aed' : '#fff', color: active ? '#fff' : cnt ? '#7c3aed' : '#c4b5e0', fontSize: 12, fontWeight: 800, cursor: cnt ? 'pointer' : 'not-allowed' }}>
                        {n} ({cnt})
                      </button>
                    );
                  })}
                  {pmSlotView && (
                    <button onClick={() => setPmSlotView(null)} title="Показать все платежи диапазона"
                      style={{ padding: '3px 10px', borderRadius: 999, border: '1px solid #c0392b', background: '#fff', color: '#c0392b', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                      ✕ вариант {pmSlotView}: показано {qOutSlot.length} — сбросить
                    </button>
                  )}
                  <button onClick={() => {
                      if (pmSlotArm) { // v64: накопительно добавить все показанные в активный вариант
                        savePmSlots(prev => { const cur = new Set(prev[String(pmSlotArm)] || []); qOutVis.forEach(m => cur.add(String(m.id))); return { ...prev, [String(pmSlotArm)]: [...cur] }; });
                      } else setPmSelected(prev => { const nx = { ...prev }; qOutVis.forEach(m => { nx[String(m.id)] = true; }); return nx; });
                    }}
                    title={pmSlotArm ? `Добавить все показанные (${qOutVis.length}) в вариант ${pmSlotArm} (накопительно)` : `Выбрать все показанные платежи (${qOutVis.length}) — для сохранения в вариант 1..5`}
                    style={{ padding: '3px 10px', borderRadius: 999, border: '1px solid #1d4ed8', background: '#fff', color: '#1d4ed8', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                    ☑ {pmSlotArm ? `все в вариант ${pmSlotArm} (${qOutVis.length})` : `выбрать все (${qOutVis.length})`}
                  </button>
                  <button onClick={() => {
                      if (pmSlotArm) { // v64: убрать показанные из активного варианта
                        savePmSlots(prev => { const cur = new Set(prev[String(pmSlotArm)] || []); qOutVis.forEach(m => cur.delete(String(m.id))); return { ...prev, [String(pmSlotArm)]: [...cur] }; });
                      } else setPmSelected({});
                    }} title={pmSlotArm ? `Убрать показанные из варианта ${pmSlotArm}` : 'Снять выделение со всех платежей'}
                    style={{ padding: '3px 10px', borderRadius: 999, border: '1px solid #d0d0d5', background: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>☐ {pmSlotArm ? `убрать из варианта ${pmSlotArm}` : 'снять выделение'}</button>
                </div>
                {/* v64.1: фильтры по каждому столбцу */}
                <input value={qDateFilter} onChange={e => setQDateFilter(e.target.value)} placeholder="📅 дата (напр. 2025-06)"
                  title="Фильтр по столбцу «дата» — подстрока: 2025, 2025-06, -06-15…"
                  style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #d0d0d5', fontSize: 13, width: 150 }} />
                <input value={qAmtMin} onChange={e => setQAmtMin(e.target.value)} placeholder="€ от" type="number" step="0.01"
                  title="Фильтр по столбцу «сумма» — минимум"
                  style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid #d0d0d5', fontSize: 13, width: 80 }} />
                <input value={qAmtMax} onChange={e => setQAmtMax(e.target.value)} placeholder="€ до" type="number" step="0.01"
                  title="Фильтр по столбцу «сумма» — максимум"
                  style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid #d0d0d5', fontSize: 13, width: 80 }} />
                {(qDateFilter || qAmtMin !== '' || qAmtMax !== '') && (
                  <button onClick={() => { setQDateFilter(''); setQAmtMin(''); setQAmtMax(''); }} title="Сбросить фильтры по дате и сумме"
                    style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #d0d0d5', background: '#fff', fontSize: 12, cursor: 'pointer' }}>✕ дата/сумма · показано {qOutVis.length}</button>
                )}
                {[['all', '○ все'], ['sel', '☑ выбранные'], ['unsel', '☐ не выбранные']].map(([k, lbl]) => (
                  <button key={`sf_${k}`} onClick={() => setQSelFilter(k)}
                    title={k === 'all' ? 'Показать все платежи' : k === 'sel' ? 'Показать только выбранные галкой' : 'Показать только НЕ выбранные галкой'}
                    style={{ padding: '5px 10px', borderRadius: 999, border: `1px solid ${qSelFilter === k ? '#1d4ed8' : '#d0d0d5'}`, background: qSelFilter === k ? '#1d4ed8' : '#fff', color: qSelFilter === k ? '#fff' : '#1d1d1f', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {lbl}
                  </button>
                ))}
                <button onClick={() => setQCpSortAsc(v => !v)}
                  title={qCpSortAsc ? 'Сортировка таблицы и списка по контрагенту А→Я — нажмите для обратного порядка (Я→А)' : 'Сортировка таблицы и списка по контрагенту Я→А — нажмите для прямого порядка (А→Я)'}
                  style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #d0d0d5', background: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {qCpSortAsc ? 'А→Я' : 'Я→А'}
                </button>
                <select value={qCpList.includes(qCpSearch) ? qCpSearch : ''} onChange={e => setQCpSearch(e.target.value)}
                  title={`Фильтр по контрагенту — список ${qCpSortAsc ? 'по возрастанию (А→Я)' : 'по убыванию (Я→А)'}`}
                  style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid #d0d0d5', fontSize: 13, maxWidth: 220, cursor: 'pointer', background: '#fff' }}>
                  <option value="">⇅ контрагент {qCpSortAsc ? 'А–Я' : 'Я–А'} ({qCpList.length})</option>
                  {qCpList.map(cp => <option key={cp} value={cp}>{cp}</option>)}
                </select>
                <input value={qCpSearch} onChange={e => setQCpSearch(e.target.value)} placeholder="🔍 Поиск по всем столбцам: контрагент, дата, сумма, фактура…"
                  style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #d0d0d5', fontSize: 13, flex: '1 1 220px', maxWidth: 340 }} />
                {qCpSearch && (
                  <button onClick={() => setQCpSearch('')} title="Сбросить фильтр"
                    style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #d0d0d5', background: '#fff', fontSize: 12, cursor: 'pointer' }}>✕ {qCpSearch} · показано {qOutVis.length} из {qOut.length}</button>
                )}
                <button onClick={() => bulkInvoiceFlag(qOutVis, true)} title={`Отметить «есть фактура» у всех показанных платежей (${qOutVis.length})`}
                  style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #1e8449', background: '#eafaf1', color: '#1e8449', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>☑ Отметить все{qCpSearch ? ` (${qOutVis.length})` : ''}</button>
                <button onClick={() => bulkInvoiceFlag(qOutVis, false)} title={`Снять галку у всех показанных платежей (${qOutVis.length})`}
                  style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid #d0d0d5', background: '#fff', color: '#1d1d1f', fontSize: 12, cursor: 'pointer' }}>☐ Снять все</button>
              </div>
              {qOut.length === 0 && <p style={{ color: '#7f8c8d', fontSize: 13 }}>Нет исходящих платежей за этот диапазон — загрузите выписку банка на вкладке «Загрузка» (🏦 Выписка банка).</p>}
              {qOutVis.map(m => {
                const linked = m.matched_receipt_id ? receipts.find(r => String(r.id) === String(m.matched_receipt_id)) : null;
                const autoK = autoDeductKind(m); // v62.1: налоги/соцстрах/зарплаты — подтверждены автоматически
                return (
                  <div key={m.id} id={`mvt-row-${m.id}`} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 13, flexWrap: 'wrap', background: hlMvtId === String(m.id) ? '#fff3bf' : (pmSlotArm ? pmSlotHas(pmSlotArm, m.id) : pmSelected[String(m.id)]) ? '#eef4ff' : autoK ? '#f6fef9' : 'transparent', boxShadow: hlMvtId === String(m.id) ? '0 0 0 2px #f0c36d' : 'none', borderRadius: (autoK || pmSelected[String(m.id)] || hlMvtId === String(m.id) || (pmSlotArm && pmSlotHas(pmSlotArm, m.id))) ? 6 : 0 }}>
                    <input type="checkbox" checked={pmSlotArm ? pmSlotHas(pmSlotArm, m.id) : !!pmSelected[String(m.id)]}
                      onChange={() => {
                        if (pmSlotArm) pmSlotToggle(pmSlotArm, m.id, !pmSlotHas(pmSlotArm, m.id));
                        else setPmSelected(prev => { const nx = { ...prev }; if (nx[String(m.id)]) delete nx[String(m.id)]; else nx[String(m.id)] = true; return nx; });
                      }}
                      title={pmSlotArm ? `Галка = платёж в варианте ${pmSlotArm} (накопительно, сохраняется автоматически)` : 'Выбрать платёж — затем «сохранить в → 1..5»'}
                      style={{ cursor: 'pointer', accentColor: pmSlotArm ? '#1e8449' : '#1d4ed8' }} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', minWidth: 150, fontWeight: 700, color: (m.has_invoice || autoK) ? '#1e8449' : '#95a5a6' }}
                      title={autoK ? `${autoK.label}: обязательный платёж — прямой вычет из прибыли, фактура не нужна (галка не требуется)` : 'Галка = по этому платежу есть фактура → платёж попадает в расходы modelo 420/IS'}>
                      <input type="checkbox" checked={!!m.has_invoice || !!autoK} onChange={() => toggleInvoiceFlag(m)} />
                      📄 {autoK ? 'в расходах' : 'есть фактура'}
                    </label>
                    {autoK && (
                      <span style={{ fontSize: 11, fontWeight: 800, color: autoK.color, background: '#fff', border: `1px solid ${autoK.color}`, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}
                        title="Обязательный платёж — автоматически зачтён как подтверждённый расход (прямой вычет из прибыли)">
                        {autoK.icon} {autoK.label} · авто-вычет
                      </span>
                    )}
                    <span style={{ minWidth: 92, color: '#7f8c8d' }}>{m.operation_date}</span>
                    <span onClick={() => setQCpSearch(String(m.counterparty || m.concept || '').trim())}
                      onDoubleClick={() => applyBankCpFilter(m.counterparty || m.concept)}
                      title="Клик — фильтр по контрагенту в этом списке · двойной клик — открыть в выписке (📊 Анализ) с фильтром"
                      style={{ flex: '1 1 220px', cursor: 'pointer', color: '#0071e3', borderBottom: '1px dashed #0071e3' }}>{m.counterparty || m.concept || '—'}</span>
                    <span style={{ minWidth: 100, textAlign: 'right', fontWeight: 700, color: '#c0392b' }}>{formatAmount(Math.abs(Number(m.amount)), 'EUR')}</span>
                    {linked
                      ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <button onClick={() => openReceiptById(linked.id)} style={{ fontSize: 12, border: '1px solid #27ae60', color: '#1e8449', background: '#eafaf1', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>🔗 {(linked.store_name || 'фактура')} · {formatAmount(linked.total_amount, linked.currency || 'EUR')}</button>
                          {Math.abs(Math.abs(Number(linked.total_amount) || 0) - Math.abs(Number(m.amount) || 0)) >= 0.01 && (
                            <span title={`Сумма фактуры отличается от платежа на ${formatAmount(Math.abs(Math.abs(Number(linked.total_amount) || 0) - Math.abs(Number(m.amount) || 0)), 'EUR')} — проверьте привязку`}
                              style={{ fontSize: 11, fontWeight: 800, color: '#e67e22', border: '1px solid #e67e22', borderRadius: 999, padding: '1px 7px', background: '#fdf2e3' }}>
                              Δ не совпадает
                            </span>
                          )}
                          <button onClick={() => { const man = isManualMvt(m); if (window.confirm(man ? 'Это РУЧНОЙ платёж (в выписке банка его нет) — он будет УДАЛЁН целиком, фактура останется. Продолжить?' : 'Отвязать платёж от этой фактуры?')) unlinkMovement(m.id); }} title="Отвязать платёж от фактуры (ручной платёж будет удалён)"
                            style={{ fontSize: 11, border: '1px solid #e74c3c', color: '#e74c3c', background: '#fff', borderRadius: 6, padding: '3px 7px', cursor: 'pointer' }}>✖</button>
                        </span>
                      )
                      : isManualMvt(m) ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 800, color: '#7d3c98', border: '1px solid #7d3c98', borderRadius: 999, padding: '1px 7px', background: '#f5eef8' }}>✍ ручной</span>
                          <button onClick={() => deleteManualMvt(m)} title="Удалить ручной платёж (в выписке банка его нет — это ошибочная строка)"
                            style={{ fontSize: 11, border: '1px solid #e74c3c', color: '#e74c3c', background: '#fff', borderRadius: 6, padding: '3px 7px', cursor: 'pointer' }}>🗑 удалить</button>
                        </span>
                      ) : <button onClick={() => { setLinkSearch(''); setLinkPicker(m); }} title="Привязать платёж к фактуре"
                        style={{ fontSize: 12, color: '#0071e3', border: '1px solid #0071e3', background: '#fff', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontWeight: 700 }}>🔗 привязать</button>}
                  </div>
                );
              })}
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
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 10, marginLeft: 16 }}>
                    <span style={{ color: '#555' }}>Ставка IS (прибыль), %:</span>
                    <input type="number" step="1" value={taxDraft.isRate || 25}
                      onChange={e => setTaxDraft(prev => computeTaxRange(prev.fromKey, prev.toKey, { ...prev, isRate: parseFloat(e.target.value) || 0 }))}
                      style={{ width: 70, padding: '5px 8px', borderRadius: 6, border: '1px solid #ccc' }} />
                    <span style={{ fontSize: 11, color: '#7f8c8d' }}>25 общая · 24 PYME&lt;10М · 21–22 микро&lt;1М</span>
                  </label>

                  {taxDraft.quarters.map(x => {
                    const late = x.isLate && (x.result420 > 0 || x.result111 > 0 || x.isPago202 > 0);
                    return (
                      <div key={x.key} style={{ border: `1px solid ${late ? '#8e8e93' : '#e0e0e0'}`, borderLeft: `4px solid ${late ? '#48484a' : '#c7c7cc'}`, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                          <strong>{x.key.replace('-', ' · ')} <span style={{ fontSize: 12, color: '#7f8c8d' }}>({x.from}…{x.to})</span></strong>
                          <span style={{ fontSize: 12, color: '#7f8c8d' }}>поступлений {x.counts.incCount} · расходов с фактурой {x.counts.outInvCount} из {x.counts.outCount} · прибыль нетто {formatAmount(x.benefNetoQ, 'EUR')} · IS аванс 202: <b style={{ color: '#b03a2e' }}>{formatAmount(x.isPago202, 'EUR')}</b></span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, fontSize: 13, marginBottom: 8 }}>
                          {[// v61: casillas официальной Modelo 420 (базы НЕТТО) + Modelo 111 (retenciones — вручную)
                            [`ingresos_${x.y}_${x.q}`, '420 · cas.01 База IGIC (нетто), €', 'baseDev'],
                            [`gastos_${x.y}_${x.q}`, '420 · cas.26 База deducible, €', 'baseDed'],
                            [`igicSop_${x.y}_${x.q}`, '420 · cas.27 Cuota deducible, €', 'cuotaDed'],
                            [`numTrab_${x.y}_${x.q}`, '111 · cas.01 Perceptores (чел.)', 'numTrab'],
                            [`percTrab_${x.y}_${x.q}`, '111 · cas.02 Percepciones trabajo, €', 'percTrab'],
                            [`retTrab_${x.y}_${x.q}`, '111 · cas.03 Retenciones trabajo, €', 'retTrab'],
                            [`numAct_${x.y}_${x.q}`, '111 · cas.07 Perceptores act. (чел.)', 'numAct'],
                            [`percAct_${x.y}_${x.q}`, '111 · cas.08 Percepciones act. econ., €', 'percAct'],
                            [`retAct_${x.y}_${x.q}`, '111 · cas.09 Retenciones act. econ., €', 'retAct'],
                          ].map(([field, label, valKey]) => (
                            <label key={field} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <span style={{ color: '#555' }}>{label}</span>
                              <input type="number" step="0.01" value={x[valKey]}
                                onChange={e => setTaxDraft(prev => computeTaxRange(prev.fromKey, prev.toKey, { ...prev, [field]: parseFloat(e.target.value) || 0 }))}
                                style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #ccc' }} />
                            </label>
                          ))}
                        </div>
                        <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                          {x.y === 2025 && x.q === 1 && (
                            <div style={{ fontSize: 11, color: '#1e8449', background: '#eafaf1', borderRadius: 6, padding: '4px 8px', marginBottom: 4 }}>
                              ✅ Эталон (поданная 1T-2025, justificante 4205586417155): cas.01 = 134 557,29 · cas.25 = 9 419,01 · cas.40 = 1 199,43 · cas.45 = 8 219,58 — сверьте с цифрами выше
                            </div>
                          )}
                          <div role="button" onClick={() => setTaxFormPopup({ form: '420', q: x })} title="Открыть заполненную modelo 420"
                            style={{ cursor: 'pointer', borderRadius: 6, padding: '3px 6px', marginLeft: -6 }}
                            onMouseEnter={e => e.currentTarget.style.background = '#ececf0'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            📄 <strong style={{ color: '#1d1d1f', textDecoration: 'underline dotted' }}>Modelo 420</strong> (IGIC): cuota {formatAmount(x.cuotaDev, 'EUR')} − deducible {formatAmount(x.cuotaDed, 'EUR')}{x.comp43 ? ` − a compensar ${formatAmount(x.comp43, 'EUR')}` : ''} = <strong>{formatAmount(x.result420, 'EUR')}</strong>
                            {x.result420 < 0 && <span style={{ fontSize: 12, color: '#1e8449' }}> → к компенсации (cas.43 след. квартала)</span>}
                          </div>
                          <div role="button" onClick={() => setTaxFormPopup({ form: '111', q: x })} title="Открыть заполненную modelo 111"
                            style={{ cursor: 'pointer', borderRadius: 6, padding: '3px 6px', marginLeft: -6 }}
                            onMouseEnter={e => e.currentTarget.style.background = '#ececf0'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            📄 <strong style={{ color: '#1d1d1f', textDecoration: 'underline dotted' }}>Modelo 111</strong> (retenciones IRPF): cas.03 {formatAmount(x.retTrab, 'EUR')} + cas.09 {formatAmount(x.retAct, 'EUR')} = <strong>{formatAmount(x.result111, 'EUR')}</strong>
                            <span style={{ fontSize: 11, color: '#8e8e93' }}> · заполняется по платёжным ведомостям (cas.02/08 — в форме)</span>
                          </div>
                          {late && (
                            <div style={{ color: '#1d1d1f', fontWeight: 700, background: '#e4e4e8', borderRadius: 6, padding: '6px 8px', marginTop: 6 }}>
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

                  {/* СУММА К ОПЛАТЕ — отдельный блок (сумма остаётся красной по запросу пользователя) */}
                  <div style={{ background: 'linear-gradient(180deg,#ffffff,#e4e4e8)', border: '2px solid #8e8e93', borderRadius: 12, padding: '12px 16px', marginBottom: 12 }}>
                    <div style={{ fontSize: 14, display: 'grid', gap: 4 }}>
                      <div>IGIC (modelo 420) к оплате: <strong>{formatAmount(Math.max(0, taxDraft.total420), 'EUR')}</strong>
                        {taxDraft.total420 < 0 && <span style={{ fontSize: 12, color: '#3a3a3c' }}> (ещё {formatAmount(Math.abs(taxDraft.total420), 'EUR')} к компенсации в следующих кварталах — a compensar)</span>}
                      </div>
                      <div>IRPF retenciones (modelo 111) к оплате: <strong>{formatAmount(taxDraft.total111, 'EUR')}</strong></div>
                      <div>🏛 Impuesto de Sociedades — авансы modelo 202 ({taxDraft.isRate || 25}% от прибыли квартала): <strong>{formatAmount(taxDraft.totalIS || 0, 'EUR')}</strong>
                        <span style={{ fontSize: 12, color: '#7f8c8d' }}> годовой расчёт — modelo 200 до 25 июля: 25% (PYME 24%) от прибыли года минус авансы 202</span></div>
                      <div>Штраф-надбавка (recargo): <strong style={{ color: taxDraft.totalRecargo > 0 ? '#c0392b' : 'inherit' }}>{formatAmount(taxDraft.totalRecargo, 'EUR')}</strong></div>
                      <div>Пени (intereses de demora): <strong style={{ color: taxDraft.totalIntereses > 0 ? '#c0392b' : 'inherit' }}>{formatAmount(taxDraft.totalIntereses, 'EUR')}</strong></div>
                    </div>
                    <div style={{ borderTop: '2px solid #8e8e93', marginTop: 8, paddingTop: 8, color: '#c0392b', fontWeight: 800, fontSize: 22 }}>
                      💶 К ОПЛАТЕ: {formatAmount(taxDraft.grandTotal, 'EUR')}
                    </div>
                    {taxDraft.lateCount > 0 && (
                      <div style={{ fontSize: 12, color: '#7f8c8d', marginTop: 6 }}>
                        Санкции посчитаны для добровольной подачи ДО требования налоговой; если придёт требование — штраф 50–150% от суммы налога. Если дело дойдёт до providencia de apremio (modelo 049): recargo de apremio 20% (10% — при оплате в срок apremio, 5% — если долг погашен до уведомления).
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
                  <p style={{ fontSize: 12, color: '#95a5a6', margin: '10px 0 0' }}>v61: пересчёт по официальным формам ISERA 2020, SL — Modelo 420 (cas. 01/03/25/26/27/40/41/43/45; базы НЕТТО = брутто/1,07) и Modelo 111 (cas. 02/03/08/09/28/30). Modelo 130 для SL не подаётся. Проверьте цифры: переводы между своими счетами уберите правкой cas.01, расходы без галки в вычет не идут.</p>
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
                      <h3 style={{ margin: 0 }}>{form === '420' ? '📄 Modelo 420 — IGIC (ATC)' : '📄 Modelo 111 — Retenciones IRPF (AEAT)'} · {x.key.replace('-', ' · ')}</h3>
                      <button onClick={() => setTaxFormPopup(null)} style={{ border: 'none', background: '#eee', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>✖</button>
                    </div>
                    <pre style={{ background: '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: 8, padding: 12, fontSize: 13, whiteSpace: 'pre-wrap', margin: '0 0 12px' }}>{buildSingleTaxFormText(form, x, taxDraft)}</pre>
                    {(form === '420' ? Math.max(0, x.result420) : x.result111) > 0 && (
                      <div style={{ background: 'linear-gradient(180deg,#ffffff,#e4e4e8)', border: '2px solid #8e8e93', borderRadius: 10, padding: '8px 14px', marginBottom: 12, color: '#c0392b', fontWeight: 800, fontSize: 18 }}>
                        💶 К ОПЛАТЕ: {formatAmount(form === '420' ? Math.max(0, x.result420) : x.result111, 'EUR')}
                        {x.isLate && (x.recargo > 0 || x.intereses > 0) && <span style={{ fontSize: 13, fontWeight: 700 }}> + штраф {formatAmount(x.recargo, 'EUR')} + пени {formatAmount(x.intereses, 'EUR')}</span>}
                      </div>
                    )}
                    {form === '420' && x.result420 < 0 && (
                      <div style={{ background: 'linear-gradient(180deg,#ffffff,#e4e4e8)', border: '2px solid #8e8e93', borderRadius: 10, padding: '8px 14px', marginBottom: 12, color: '#3a3a3c', fontWeight: 700, fontSize: 15 }}>
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
          {renderLinkPicker()}
          </div>
        );
      })()}

      {/* Вкладка «CRM» (v32) */}
      {activeTab === 'crm' && <CrmTab user={user} token={token} />}
      {activeTab === 'chat' && tabAllowed('chat') && <ChatTab user={user} token={token} />}

      {/* Вкладка «Документы» (v40) */}
      {activeTab === 'docs' && <DocsTab user={user} token={token} />}
      {activeTab === 'users' && user?.role === 'admin' && <UsersTab token={token} objectsList={objectsList} />}

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
                  <div style={{ height: '100%', width: `${uploadProgress}%`, borderRadius: 6, background: progressStage === 'upload' ? '#42a5f5' : '#4caf50', transition: 'width 0.4s ease' }} />
                </div>
                <div style={{ marginTop: 8, fontSize: 16, fontWeight: 800, color: '#ffd54f' }}>{uploadProgress}%</div>
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