import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import { Capacitor, registerPlugin } from '@capacitor/core';

const API_URL = 'https://householder-api-production.up.railway.app';

const OBJECTS = ['other', 'Duqe', 'Maria', 'Kit', 'Dubai', 'Tich'];
const ITEMS_PER_PAGE_OPTIONS = [10, 20, 50, 'all'];
const MAX_FILE_SIZE_MB = 2;
const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

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
  { name: 'groq-llama-3.2-90b', displayName: 'Groq Llama 3.2 90B Vision', provider: 'Groq' },
  { name: 'groq-llama-3.2-11b', displayName: 'Groq Llama 3.2 11B Vision', provider: 'Groq' },
  { name: 'groq-llama-4-scout', displayName: 'Groq Llama 4 Scout', provider: 'Groq' },
  { name: 'groq-llama-4-maverick', displayName: 'Groq Llama 4 Maverick', provider: 'Groq' },
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
  { name: 'groq-mixtral', displayName: 'Groq Mixtral', provider: 'Groq' },
  { name: 'groq-gemma', displayName: 'Groq Gemma', provider: 'Groq' },
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

async function convertPdfToImages(pdfFile) {
  const pdfjsLib = await loadPdfJs();
  const data = await pdfFile.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const baseName = (pdfFile.name || 'document').replace(/\.pdf$/i, '');
  const out = [];
  const maxPages = Math.min(pdf.numPages, 10);
  for (let p = 1; p <= maxPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2.0 });
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
async function expandFilesWithPdf(files) {
  const result = [];
  for (const f of files) {
    if (isPdfFile(f)) {
      try {
        result.push(...await convertPdfToImages(f));
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
  'groq-llama-4-scout': 'groq-meta-llama/llama-4-scout-17b-16e-instruct',
  'groq-llama-4-maverick': 'groq-meta-llama/llama-4-maverick-17b-128e-instruct',
  'groq-llama-3.2-90b': 'groq-llama-3.2-90b-vision-preview',
  'groq-llama-3.2-11b': 'groq-llama-3.2-11b-vision-preview',
  'groq-llama-3.3-70b': 'groq-llama-3.3-70b-versatile',
  'groq-llama-3.1-8b': 'groq-llama-3.1-8b-instant',
  'groq-mixtral': 'groq-mixtral-8x7b-32768',
  'groq-gemma': 'groq-gemma2-9b-it'
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
  const [uploadProgress, setUploadProgress] = useState(0);
  const [progressStage, setProgressStage] = useState(null); // 'upload' | 'recognize'

  // Загрузка с реальным прогрессом (XHR: fetch не даёт upload-прогресс)
  const uploadWithProgress = (url, formData, onUploadProgress) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.timeout = 180000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onUploadProgress(e.loaded / e.total);
    };
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, text: xhr.responseText });
    xhr.onerror = () => reject(new Error('Ошибка сети'));
    xhr.ontimeout = () => reject(new Error('Превышено время ожидания (180 сек)'));
    xhr.send(formData);
  });
  const [lastSavedReceipt, setLastSavedReceipt] = useState(null);
  const [scanResultOpen, setScanResultOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState('groq-llama-4-scout');
  const [currency, setCurrency] = useState('auto');
  const [docType, setDocType] = useState('auto');
  const [object, setObject] = useState('other');
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [exportMode, setExportMode] = useState('all');

  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  const [filterYears, setFilterYears] = useState([]);
  const [filterMonths, setFilterMonths] = useState([]);
  const [filterTypes, setFilterTypes] = useState([]);
  const [filterObjects, setFilterObjects] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [currentPage, setCurrentPage] = useState(1);
  // Сортировка списка: 'receipt' — по дате чека, 'recognized' — по дате распознавания
  const [sortMode, setSortMode] = useState('receipt');
  const [sortDir, setSortDir] = useState('desc');
  // Режим поиска дубликатов
  const [showDuplicates, setShowDuplicates] = useState(false);

  const [selectedReceiptIds, setSelectedReceiptIds] = useState(new Set());
  const [viewModal, setViewModal] = useState(null);
  const [fullscreenImage, setFullscreenImage] = useState(null);

  // Закрытие полноэкранного просмотра по Escape
  useEffect(() => {
    if (!fullscreenImage) return;
    const onKey = (e) => { if (e.key === 'Escape') setFullscreenImage(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreenImage]);

  const [folderProgress, setFolderProgress] = useState({ active: false, current: 0, total: 0, success: 0, errors: 0, currentFile: '' });
  const [folderResults, setFolderResults] = useState([]);

  const receiptCount = receipts.filter(r => r.document_type === 'receipt' || !r.document_type).length;
  const invoiceCount = receipts.filter(r => r.document_type === 'invoice').length;

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
      const files = await expandFilesWithPdf(picked);
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
      const files = await expandFilesWithPdf(picked);
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

  const recognizeAndSave = async (fileArg) => {
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

      const receiptData = data.data || data;
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

  const handleFolderSelect = async (e) => {
    const picked = Array.from(e.target.files).filter(f => f.type.startsWith('image/') || isPdfFile(f));
    if (picked.length === 0) {
      alert('В папке не найдено изображений или PDF');
      return;
    }
    const allFiles = await expandFilesWithPdf(picked);
    if (allFiles.length === 0) return;
    setFolderProgress({ active: true, current: 0, total: allFiles.length, success: 0, errors: 0, currentFile: '', fileRatio: 0 });
    setFolderResults([]);
    setRecognizing(true);
    const results = [];
    for (let i = 0; i < allFiles.length; i++) {
      const file = allFiles[i];
      setFolderProgress(prev => ({ ...prev, current: i + 1, currentFile: file.name, fileRatio: 0 }));
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
        const receiptData = data.data || data;
        if (receiptData.image_url) receiptData.image_url = fixImageUrl(receiptData.image_url);
        results.push({ file: file.name, status: 'success', receipt: receiptData });
        setFolderProgress(prev => ({ ...prev, success: prev.success + 1 }));
      } catch (err) {
        console.error(`Folder upload error for ${file.name}:`, err);
        results.push({ file: file.name, status: 'error', error: err.message });
        setFolderProgress(prev => ({ ...prev, errors: prev.errors + 1 }));
      }
    }
    setFolderResults(results);
    setFolderProgress(prev => ({ ...prev, active: false, currentFile: '' }));
    setRecognizing(false);
    loadReceipts();
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    if (errorCount === 0) {
      alert(`✅ Все ${successCount} чеков успешно распознаны и сохранены!`);
    } else {
      alert(`✅ Успешно: ${successCount}\n❌ Ошибок: ${errorCount}\n\nСмотрите детали ниже.`);
    }
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

  const filteredReceipts = receipts.filter(r => {
    if (filterTypes.length && !filterTypes.includes(r.document_type || 'receipt')) return false;
    if (filterObjects.length && !filterObjects.includes(r.object || 'other')) return false;
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
      String(r.id || ''), String(r.store_name_ru || r.store_name || ''), String(r.raw_text || r.recognized_text || ''),
      String(r.object || ''), String(r.currency || ''), String(r.owner_name || r.owner_id || ''),
      String(r.document_type || ''), String(r.total_amount || ''), String(r.subtotal || ''),
      String(r.tax_amount || ''), String(r.tax_rate || ''), String(r.receipt_date || ''),
      String(r.receipt_time || ''), String(r.receipt_address || ''), String(r.phone || ''),
      String(r.card_last4 || ''), String(r.recognition_method || ''), String(r.warning || ''),
      String(r.notes || ''), String(r.payment_method || ''), String(r.discount_amount || ''),
      String(r.loyalty_card || ''),
    ];
    const itemsText = (r.items || []).map(i =>
      `${i.name || ''} ${i.name_ru || ''} ${i.price || ''} ${i.quantity || ''} ${i.total || ''} ${i.category || ''} ${i.sku || ''}`
    ).join(' ');
    const allText = searchFields.join(' ') + ' ' + itemsText;
    return allText.toLowerCase().includes(q);
  });

  // Поиск дубликатов: одинаковые магазин + дата чека + итоговая сумма.
  // В группе самый ранний по created_at — ОРИГИНАЛ, остальные — КОПИИ.
  const dupMap = new Map();
  receipts.forEach(r => {
    const key = `${String(r.store_name || '').toLowerCase().trim()}|${r.receipt_date || ''}|${parseFloat(r.total_amount) || 0}`;
    if (!dupMap.has(key)) dupMap.set(key, []);
    dupMap.get(key).push(r);
  });
  const dupGroups = [];
  dupMap.forEach(g => {
    if (g.length > 1) {
      g.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
      dupGroups.push(g);
    }
  });
  const dupAllIds = new Set(dupGroups.flat().map(r => r.id));           // все участники групп дубликатов
  const dupCopyIds = new Set(dupGroups.flatMap(g => g.slice(1)).map(r => r.id)); // копии (все, кроме оригинала)

  // В режиме дубликатов показываем только чеки из групп дубликатов
  const visibleReceipts = showDuplicates
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
              Чеки ({receiptCount}) · Фактуры ({invoiceCount})
            </button>
          </nav>
        </div>
        <div className="header-right">
          <span className="user-name">{formatUserName(user)}</span>
          <button className="logout-btn" onClick={logout}>Выйти</button>
        </div>
      </header>

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
            <div className="modal-header">
              <h2> Чек #{viewModal.id}</h2>
              <button className="modal-close" onClick={() => setViewModal(null)}>✕</button>
            </div>
            <div className="modal-body">
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
              <div className="modal-info">
                <div className="info-block">
                  <h3>Основная информация</h3>
                  <p><strong>Магазин:</strong> <HighlightText text={viewModal.store_name_ru || viewModal.store_name || '—'} query={searchQuery} /></p>
                  <p><strong>Дата:</strong> {formatDate(viewModal.receipt_date)} {viewModal.receipt_time}</p>
                  <p><strong>Итого:</strong> {formatAmount(viewModal.total_amount, viewModal.currency)}</p>
                  <p><strong>Тип:</strong> {viewModal.document_type}</p>
                  <p><strong>Объект:</strong> <HighlightText text={viewModal.object || '—'} query={searchQuery} /></p>
                  <p><strong>Метод:</strong> {viewModal.recognition_method || '—'}</p>
                  <p><strong>Добавил:</strong> <HighlightText text={formatOwnerName(viewModal)} query={searchQuery} /></p>
                  {viewModal.subtotal && <p><strong>Подытог:</strong> {viewModal.subtotal}</p>}
                  {viewModal.tax_amount && <p><strong>Налог:</strong> {viewModal.tax_amount} ({viewModal.tax_rate || ''})</p>}
                  {(() => {
                    const itemsTotal = calculateItemsTotal(viewModal.items);
                    const total = parseFloat(viewModal.total_amount) || 0;
                    const diff = Math.abs(total - itemsTotal).toFixed(2);
                    if (diff > 0.01) {
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
            <div className="modal-footer">
              <button onClick={() => setViewModal(null)}>Закрыть</button>
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
            <label htmlFor="folder-input" className="btn-folder">
              📁 Распознать папку
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
                  <option value="receipt">Чек</option>
                  <option value="invoice">Фактура</option>
                </select>
              </div>
              <div className="control-group compact">
                <label>Объект:</label>
                <select value={object} onChange={e => setObject(e.target.value)}>
                  {OBJECTS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
          </div>

          <input type="file" accept="image/*,application/pdf" multiple onChange={handleFileSelect} id="file-input" style={{ display: 'none' }} />
          <input type="file" id="folder-input" webkitdirectory="" directory="" multiple accept="image/*,application/pdf" onChange={handleFolderSelect} style={{ display: 'none' }} />

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
                      : `🤖 Распознавание AI… ${uploadProgress}%`}
                  </span>
                </>
              ) : recognizing ? (
                '⏳ Идёт загрузка папки…'
              ) : 'Распознать и сохранить'}
            </button>
          </div>

          <div className="upload-layout">
            <div className="drop-zone" onDrop={handleDrop} onDragOver={e => e.preventDefault()}>
              <input type="file" accept="image/*,application/pdf" multiple onChange={handleFileSelect} id="file-input-hidden" style={{ display: 'none' }} />
              <label htmlFor="file-input" style={{ display: 'block', width: '100%', cursor: 'pointer' }}>
                {previewUrl ? (
                  <div className="preview-container">
                    <img src={previewUrl} alt="Preview" className="preview" />
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
                  <h3>✅ {lastSavedReceipt.document_type === 'invoice' ? 'Фактура сохранена' : 'Чек сохранён'}</h3>
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
                    <p><strong>Магазин:</strong> {lastSavedReceipt.store_name_ru || lastSavedReceipt.store_name || '—'}</p>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <strong> Распознавание папки...</strong>
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
                {(folderProgress.fileRatio || 0) > 0 && (folderProgress.fileRatio || 0) < 0.5 && ` — загрузка ${Math.round((folderProgress.fileRatio || 0) * 200)}%`}
                {(folderProgress.fileRatio || 0) >= 0.5 && (folderProgress.fileRatio || 0) < 1 && ' — распознаётся AI…'}
              </p>
              <p style={{ fontSize: 13, color: '#27ae60', marginTop: 4 }}>
                Успешно: {folderProgress.success} &nbsp;|&nbsp;
                <span style={{ color: '#e74c3c' }}>❌ Ошибок: {folderProgress.errors}</span>
              </p>
            </div>
          )}

          {folderResults.length > 0 && !folderProgress.active && (
            <div style={{ marginTop: 15, padding: 15, background: '#e8f5e9', borderRadius: 8, maxHeight: 300, overflowY: 'auto' }}>
              <h4 style={{ margin: '0 0 10px 0' }}>📁 Результаты загрузки папки</h4>
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
                      {res.receipt.document_type === 'invoice' ? '📄' : '🧾'} {res.receipt.store_name_ru || res.receipt.store_name || 'Чек'} — {formatAmount(res.receipt.total_amount, res.receipt.currency)}
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
            <ExcelFilter label="Тип" options={[{ value: 'receipt', label: '🧾 Чеки' }, { value: 'invoice', label: '📄 Фактуры' }]} selected={filterTypes} onChange={v => { setFilterTypes(v); setCurrentPage(1); }} />
            <ExcelFilter label="Объект" options={OBJECTS.map(o => ({ value: o, label: o }))} selected={filterObjects} onChange={v => { setFilterObjects(v); setCurrentPage(1); }} />
            <input type="text" placeholder="🔍 Поиск..." value={searchQuery} onChange={e => {setSearchQuery(e.target.value); setCurrentPage(1);}}
              style={{ flex: '1 1 140px', maxWidth: 200, padding: '6px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #ccc' }} />
            <select value={itemsPerPage} onChange={e => {setItemsPerPage(e.target.value === 'all' ? 'all' : parseInt(e.target.value)); setCurrentPage(1);}}
              style={{ padding: '6px 8px', fontSize: 13, borderRadius: 6, border: '1px solid #ccc', width: 'auto' }}>
              {ITEMS_PER_PAGE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt === 'all' ? 'Все' : opt}</option>)}
            </select>
            <button onClick={() => exportExcel()} style={{ padding: '6px 12px', fontSize: 13 }}>📊 Excel (все)</button>
            <button onClick={() => loadReceipts()} style={{ padding: '6px 12px', fontSize: 13 }}>🔄 Обновить</button>
            <button
              onClick={() => { setShowDuplicates(v => !v); setCurrentPage(1); setSelectedReceiptIds(new Set()); }}
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
                {OBJECTS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
              <select onChange={e => { if (e.target.value) bulkChangeType(e.target.value); e.target.value = ''; }} style={{ padding: '6px 10px', borderRadius: 6 }}>
                <option value="">Сменить тип...</option>
                <option value="receipt"> Чек</option>
                <option value="invoice"> Фактура</option>
              </select>
              <select onChange={e => { if (e.target.value) bulkChangeCurrency(e.target.value); e.target.value = ''; }} style={{ padding: '6px 10px', borderRadius: 6 }}>
                <option value="">Сменить валюту...</option>
                <option value="AED">AED</option>
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="RUB">RUB</option>
              </select>
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
                  const hasDiff = diff > 0.01;
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
                      <div className="receipt-header" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, paddingTop: 2 }}>
                        <input type="checkbox" checked={selectedReceiptIds.has(receipt.id)} onChange={() => toggleSelect(receipt.id)} style={{ width: 20, height: 20, cursor: 'pointer', flexShrink: 0, marginTop: 2 }} />
                        <h3 style={{ margin: 0, flex: 1, lineHeight: 1.3 }}>
                          <HighlightText text={receipt.store_name_ru || receipt.store_name || 'Без названия'} query={searchQuery} />
                        </h3>
                        <span className="type-badge" style={{ flexShrink: 0 }}>{receipt.document_type}</span>
                        {dupAllIds.has(receipt.id) && (
                          dupCopyIds.has(receipt.id)
                            ? <span title="Дубликат: такой же магазин, дата и сумма" style={{ flexShrink: 0, background: '#e74c3c', color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 10 }}>КОПИЯ</span>
                            : <span title="Оригинал (самый ранний из группы дубликатов)" style={{ flexShrink: 0, background: '#27ae60', color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 10 }}>ОРИГИНАЛ</span>
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
                  <div><strong>Магазин:</strong> {lastSavedReceipt.store_name_ru || lastSavedReceipt.store_name || '—'}</div>
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
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16, cursor: 'zoom-out'
          }}
        >
          <img
            src={fullscreenImage}
            alt="Чек"
            style={{
              maxWidth: '97vw', maxHeight: '97vh',
              objectFit: 'contain', borderRadius: 8,
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