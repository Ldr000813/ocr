'use client';

import { useState, useRef } from 'react';

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ message: string; isError: boolean } | null>(null);

  const imageRef = useRef<HTMLImageElement | null>(null);

  const triggerFileSelect = () => document.getElementById('fileInput')?.click();
  const triggerCamera = () => document.getElementById('cameraInput')?.click();

  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);

      const reader = new FileReader();
      reader.onload = (e) => setImagePreview(e.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const showStatus = (message: string, isError = false) => {
    setStatusMessage({ message, isError });
    setTimeout(() => setStatusMessage(null), 5000);
  };

  const processImage = async () => {
    if (!selectedFile) return showStatus('画像を選択してください', true);

    setLoading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await fetch('/api/ocr', { method: 'POST', body: formData });

      const text = await res.text();
      const data = JSON.parse(text);

      if (data.error) {
        return showStatus(data.error, true);
      }

      // ⭐ 修正済み：サーバーが返す result を表示
      setResult(JSON.stringify(data.result, null, 2));

      showStatus('OCR処理が完了しました', false);

    } catch (err: any) {
      console.error(err);
      showStatus(err.message, true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container" style={{ padding: 20 }}>
      <div className="header" style={{ textAlign: 'center', marginBottom: 20 }}>
        <h1>📄 OCR Document Scanner</h1>
        <p>Azure AI Document Intelligence Layout の文字起こし結果を表示</p>
      </div>

      {/* --- ファイル選択 UI --- */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <button className="btn btn-primary" onClick={triggerCamera} style={{ marginRight: 10 }}>
          📷 カメラで撮影
        </button>
        <button className="btn btn-primary" onClick={triggerFileSelect}>
          🖼️ 既存の画像を選択
        </button>

        <input
          type="file"
          id="cameraInput"
          accept="image/*"
          capture="environment"
          onChange={handleImageSelect}
          style={{ display: 'none' }}
        />

        <input
          type="file"
          id="fileInput"
          accept="image/*"
          onChange={handleImageSelect}
          style={{ display: 'none' }}
        />
      </div>

      {/* --- プレビュー表示 --- */}
      {imagePreview && (
        <div style={{ textAlign: 'center' }}>
          <img
            ref={imageRef}
            src={imagePreview}
            alt="Image Preview"
            style={{ maxWidth: '100%', borderRadius: 10 }}
          />
        </div>
      )}

      {/* --- OCRボタン --- */}
      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <button className="btn btn-primary" onClick={processImage} disabled={!selectedFile || loading}>
          🔍 OCR処理を開始
        </button>
      </div>

      {/* --- ローディング --- */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <p>処理中です...</p>
        </div>
      )}

      {/* --- OCR結果 --- */}
      {result && (
        <div style={{ marginTop: 20, padding: 20, background: '#f8f9fa', borderRadius: 10 }}>
          <h3>📋 OCR結果</h3>
          <pre>{result}</pre>
        </div>
      )}

      {/* --- ステータス通知 --- */}
      {statusMessage && (
        <div
          style={{
            marginTop: 20,
            padding: 10,
            background: statusMessage.isError ? '#f8d7da' : '#d4edda',
            borderRadius: 8,
            textAlign: 'center',
            color: statusMessage.isError ? '#721c24' : '#155724',
          }}
        >
          {statusMessage.message}
        </div>
      )}
    </div>
  );
}
