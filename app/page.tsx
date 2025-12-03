'use client';

import { useState, useRef } from 'react';

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ message: string; isError: boolean } | null>(null);
  const [debugJson, setDebugJson] = useState<string | null>(null);

  const triggerFileSelect = () => document.getElementById('fileInput')?.click();

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
    setDebugJson(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await fetch('/api/ocr', { method: 'POST', body: formData });
      const text = await res.text();
      const data = JSON.parse(text);

      if (data.error) return showStatus(data.error, true);

      setDebugJson(JSON.stringify(data.tables, null, 2));

      // ⭐ Excel Base64 → Blob → ダウンロード
      const excelBlob = b64toBlob(data.excel, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

      const url = URL.createObjectURL(excelBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ocr_output.xlsx';
      a.click();
      URL.revokeObjectURL(url);

      showStatus('Excelをダウンロードしました', false);

    } catch (err: any) {
      console.error(err);
      showStatus(err.message, true);
    } finally {
      setLoading(false);
    }
  };

  // Base64 → Blob
  const b64toBlob = (b64Data: string, contentType = '', sliceSize = 512) => {
    const byteCharacters = atob(b64Data);
    const byteArrays = [];

    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);

      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }

      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }

    return new Blob(byteArrays, { type: contentType });
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>📄 OCR → Excel 変換</h1>

      <button onClick={triggerFileSelect} style={{ marginBottom: 10 }}>
        画像 / PDF を選択
      </button>

      <input
        type="file"
        id="fileInput"
        accept="image/*,application/pdf"
        onChange={handleImageSelect}
        style={{ display: 'none' }}
      />

      {imagePreview && <img src={imagePreview} style={{ maxWidth: '100%', marginTop: 10 }} />}

      <div>
        <button onClick={processImage} disabled={!selectedFile || loading} style={{ marginTop: 20 }}>
          🔍 OCR → Excelに変換
        </button>
      </div>

      {loading && <p>処理中です...</p>}

      {debugJson && (
        <pre style={{ marginTop: 20, background: '#f0f0f0', padding: 10 }}>
          {debugJson}
        </pre>
      )}

      {statusMessage && (
        <div style={{ marginTop: 10, color: statusMessage.isError ? 'red' : 'green' }}>
          {statusMessage.message}
        </div>
      )}
    </div>
  );
}
