import React, { useState, useEffect } from 'react';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

const API_URL = 'https://backend-production-adc7.up.railway.app';
const MAX_FILE_SIZE_MB = 2;

function compressImageFile(file, maxWidth = 1600, maxHeight = 2400, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (file.size <= MAX_FILE_SIZE_MB * 1024 * 1024) return resolve(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) { height = Math.round(height * (maxWidth / width)); width = maxWidth; }
        if (height > maxHeight) { width = Math.round(width * (maxHeight / height)); height = maxHeight; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('Canvas toBlob failed'));
          const compressedFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
            type: 'image/jpeg', lastModified: Date.now()
          });
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

export default function Scanner({ token, selectedModel, currency, docType, object, onSuccess, onClose }) {
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, file: '' });
  const [results, setResults] = useState([]);

  const isNative = () => {
    return typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform();
  };

  const scanDocument = async () => {
    setScanning(true);
    setResults([]);

    try {
      let imageData;

      if (isNative()) {
        // НАТИВНЫЙ РЕЖИМ: вызываем кастомный плагин ML Kit Document Scanner
        if (window.Capacitor.Plugins.DocumentScanner) {
          const result = await window.Capacitor.Plugins.DocumentScanner.scan({
            pageLimit: 1,
            format: 'JPEG',
            quality: 90
          });
          imageData = result.images[0]; // base64 или путь к файлу
        } else {
          // Fallback — обычная камера Capacitor
          const photo = await Camera.getPhoto({
            quality: 90,
            allowEditing: false,
            resultType: CameraResultType.Base64,
            source: CameraSource.Camera,
            saveToGallery: false
          });
          imageData = `data:image/jpeg;base64,${photo.base64String}`;
        }
      } else {
        // WEB-РЕЖИМ: обычный input file
        alert('На телефоне установите приложение через «Добавить на главный экран» для нативного сканера');
        setScanning(false);
        return;
      }

      // Конвертируем в File
      const file = await dataUrlToFile(imageData, `receipt_${Date.now()}.jpg`);
      await processFile(file);
    } catch (err) {
      console.error('Scan error:', err);
      alert('Ошибка сканирования: ' + err.message);
    }
    setScanning(false);
  };

  const scanMultiple = async () => {
    setScanning(true);
    setResults([]);
    let images = [];

    try {
      if (isNative() && window.Capacitor.Plugins.DocumentScanner) {
        const result = await window.Capacitor.Plugins.DocumentScanner.scan({
          pageLimit: 10,
          format: 'JPEG',
          quality: 90
        });
        images = result.images;
      } else {
        alert('Множественное сканирование доступно только в нативном приложении');
        setScanning(false);
        return;
      }

      setProgress({ current: 0, total: images.length, file: '' });
      const processed = [];

      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        setProgress({ current: i + 1, total: images.length, file: `Файл ${i + 1}` });
        const file = await dataUrlToFile(img, `receipt_${Date.now()}_${i}.jpg`);
        try {
          const receipt = await uploadAndRecognize(file);
          processed.push({ status: 'success', file: file.name, receipt });
        } catch (e) {
          processed.push({ status: 'error', file: file.name, error: e.message });
        }
      }

      setResults(processed);
      if (onSuccess) onSuccess(processed);
    } catch (err) {
      console.error('Multi-scan error:', err);
    }
    setScanning(false);
  };

  const dataUrlToFile = async (dataUrl, filename) => {
    if (dataUrl.startsWith('file://')) {
      // Нативный путь — читаем через fetch
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      return new File([blob], filename, { type: 'image/jpeg' });
    }
    if (dataUrl.startsWith('data:')) {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      return new File([blob], filename, { type: 'image/jpeg' });
    }
    // base64 строка без data:
    const res = await fetch(`data:image/jpeg;base64,${dataUrl}`);
    const blob = await res.blob();
    return new File([blob], filename, { type: 'image/jpeg' });
  };

  const uploadAndRecognize = async (file) => {
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

    const res = await fetch(`${API_URL}/api/upload-receipt?token=${token}`, {
      method: 'POST',
      body: formData
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Server error: ${res.status}`); }
    if (!res.ok || (!data.success && !data.id)) throw new Error(data.error || 'Failed');

    return data.data || data;
  };

  const processFile = async (file) => {
    try {
      const receipt = await uploadAndRecognize(file);
      setResults([{ status: 'success', file: file.name, receipt }]);
      if (onSuccess) onSuccess([{ status: 'success', file: file.name, receipt }]);
    } catch (e) {
      setResults([{ status: 'error', file: file.name, error: e.message }]);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#1a1a2e', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#16213e' }}>
        <h2 style={{ color: '#fff', margin: 0, fontSize: 18 }}>📷 Сканер чеков</h2>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 24 }}>✕</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        {!scanning && results.length === 0 && (
          <>
            <div style={{ textAlign: 'center', color: '#fff', marginBottom: 40 }}>
              <div style={{ fontSize: 80, marginBottom: 20 }}>📄</div>
              <h3 style={{ margin: '0 0 10px 0' }}>Наведите камеру на чек</h3>
              <p style={{ color: '#aaa', fontSize: 14 }}>ML Kit автоматически найдёт границы, обрежет фон и улучшит изображение</p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 300 }}>
              <button
                onClick={scanDocument}
                style={{
                  padding: '16px 24px', borderRadius: 12, border: 'none',
                  background: '#e94560', color: '#fff', fontSize: 18, fontWeight: 600,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10
                }}
              >
                📷 Сканировать 1 чек
              </button>
              <button
                onClick={scanMultiple}
                style={{
                  padding: '14px 24px', borderRadius: 12, border: '2px solid #e94560',
                  background: 'transparent', color: '#e94560', fontSize: 16, fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                📁 Сканировать папку (до 10)
              </button>
            </div>

            <div style={{ marginTop: 30, padding: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 8, fontSize: 12, color: '#888' }}>
              <p style={{ margin: '0 0 6px 0' }}><strong>Модель:</strong> {selectedModel}</p>
              <p style={{ margin: '0 0 6px 0' }}><strong>Валюта:</strong> {currency}</p>
              <p style={{ margin: '0 0 6px 0' }}><strong>Тип:</strong> {docType}</p>
              <p style={{ margin: 0 }}><strong>Объект:</strong> {object}</p>
            </div>
          </>
        )}

        {scanning && (
          <div style={{ textAlign: 'center', color: '#fff' }}>
            <div style={{ fontSize: 60, marginBottom: 20 }}>⏳</div>
            <h3>Распознавание...</h3>
            {progress.total > 0 && (
              <>
                <p style={{ color: '#aaa' }}>{progress.current} / {progress.total}</p>
                <p style={{ color: '#888', fontSize: 13 }}>{progress.file}</p>
                <div style={{ width: 250, height: 8, background: '#333', borderRadius: 4, margin: '20px auto', overflow: 'hidden' }}>
                  <div style={{
                    width: `${progress.total > 0 ? (progress.current / progress.total * 100) : 0}%`,
                    height: '100%', background: '#e94560', transition: 'width 0.3s', borderRadius: 4
                  }} />
                </div>
              </>
            )}
          </div>
        )}

        {!scanning && results.length > 0 && (
          <div style={{ width: '100%', maxWidth: 400 }}>
            <h3 style={{ color: '#fff', textAlign: 'center', marginBottom: 15 }}>Результаты</h3>
            {results.map((res, idx) => (
              <div key={idx} style={{
                padding: 12, marginBottom: 8, borderRadius: 8,
                background: res.status === 'success' ? 'rgba(46, 204, 113, 0.2)' : 'rgba(231, 76, 60, 0.2)',
                border: `1px solid ${res.status === 'success' ? '#2ecc71' : '#e74c3c'}`
              }}>
                <div style={{ color: '#fff', fontWeight: 600, marginBottom: 4 }}>
                  {res.status === 'success' ? '✅' : '❌'} {res.file}
                </div>
                {res.status === 'success' && res.receipt && (
                  <div style={{ color: '#ddd', fontSize: 14 }}>
                    <p style={{ margin: '4px 0' }}><strong>{res.receipt.store_name_ru || res.receipt.store_name || 'Чек'}</strong></p>
                    <p style={{ margin: '4px 0', color: '#2ecc71' }}>{parseFloat(res.receipt.total_amount || 0).toFixed(2)} {res.receipt.currency}</p>
                    <p style={{ margin: '4px 0', fontSize: 12, color: '#aaa' }}>{res.receipt.items?.length || 0} товаров</p>
                  </div>
                )}
                {res.status === 'error' && (
                  <div style={{ color: '#e74c3c', fontSize: 13 }}>{res.error}</div>
                )}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, marginTop: 15 }}>
              <button onClick={() => { setResults([]); }} style={{ flex: 1, padding: 12, borderRadius: 8, border: 'none', background: '#e94560', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>
                Ещё чек
              </button>
              <button onClick={onClose} style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid #555', background: 'transparent', color: '#fff', cursor: 'pointer' }}>
                Закрыть
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
