'use client';

import { useState } from 'react';

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tablesJson, setTablesJson] = useState<string | null>(null);
  const [headerJson, setHeaderJson] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // ファイル選択
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);

      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const triggerFileSelect = () => {
    document.getElementById('fileInput')?.click();
  };

  // OCR 実行
  const processImage = async () => {
    if (!selectedFile) {
      setStatusMessage("画像を選択してください");
      return;
    }

    setLoading(true);
    setStatusMessage(null);
    setTablesJson(null);
    setHeaderJson(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await fetch('/api/ocr', { method: 'POST', body: formData });
      const text = await res.text();
      const data = JSON.parse(text);

      if (data.error) {
        setStatusMessage("エラー: " + data.error);
        return;
      }

      // ---- 全テーブル JSON を表示 ----
      setTablesJson(JSON.stringify(data.tables, null, 2));

      // ---- ヘッダー行（rowIndex = 0）だけ抽出して表示 ----
      if (data.tables && data.tables.length > 0) {
        const headerCells = data.tables[0].cells.filter(
          (cell: any) => cell.rowIndex === 0
        );

        setHeaderJson(JSON.stringify(headerCells, null, 2));
      }

      setStatusMessage("OCR が完了しました（ヘッダー行を表示）");

    } catch (err: any) {
      setStatusMessage("エラー: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>📄 Azure OCR デバッグビューア</h1>
      <p>ヘッダー情報（rowIndex = 0）をブラウザで表示できます</p>

      {/* --- 画像選択ボタン --- */}
      <button onClick={triggerFileSelect} style={{ marginBottom: 10 }}>
        📂 画像 / PDF を選択
      </button>

      <input
        type="file"
        id="fileInput"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={handleImageSelect}
      />

      {/* --- プレビュー --- */}
      {imagePreview && (
        <div style={{ marginTop: 20 }}>
          <img src={imagePreview} style={{ maxWidth: '100%', borderRadius: 6 }} />
        </div>
      )}

      {/* --- OCRボタン --- */}
      <div>
        <button
          onClick={processImage}
          disabled={!selectedFile || loading}
          style={{ marginTop: 20 }}
        >
          🔍 OCR 実行
        </button>
      </div>

      {/* --- ステータス --- */}
      {loading && <p style={{ marginTop: 10 }}>処理中です…</p>}
      {statusMessage && <p style={{ marginTop: 10 }}>{statusMessage}</p>}

      {/* --- ヘッダー行 JSON --- */}
      {headerJson && (
        <div
          style={{
            marginTop: 20,
            padding: 10,
            background: '#f1f1f1',
            borderRadius: 6,
          }}
        >
          <h3>🟦 ヘッダー行（rowIndex = 0）</h3>
          <pre>{headerJson}</pre>
        </div>
      )}

      {/* --- 全 tables JSON --- */}
      {tablesJson && (
        <div
          style={{
            marginTop: 20,
            padding: 10,
            background: '#fafafa',
            borderRadius: 6,
          }}
        >
          <h3>📘 全テーブル JSON（デバッグ用）</h3>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{tablesJson}</pre>
        </div>
      )}
    </div>
  );
}
