'use client';

import { useState } from 'react';

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tablesJson, setTablesJson] = useState<string | null>(null);
  const [headerJson, setHeaderJson] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // ファイル選択処理
  const triggerFileSelect = () => {
    document.getElementById('fileInput')?.click();
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);

      const reader = new FileReader();
      reader.onload = (ev) => setImagePreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  // OCR 処理
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

      // ---- 全テーブル JSON を画面に表示 ----
      setTablesJson(JSON.stringify(data.tables, null, 2));

      // ---- rowIndex = 0（ヘッダー行）のセルだけ抽出 ----
      if (data.tables && data.tables.length > 0) {
        const headerCells = data.tables[0].cells.filter(
          (cell: any) => cell.rowIndex === 0
        );

        setHeaderJson(JSON.stringify(headerCells, null, 2));
      }

      setStatusMessage("OCRが完了しました（ヘッダー行を表示）");

    } catch (err: any) {
      setStatusMessage("エラー: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>📄 Azure OCR デバッグビューア</h1>
      <p>ヘッダー情報（rowIndex = 0）をブラウザで確認できます</p>

      {/* ファイル選択 */}
      <button onClick={triggerFileSelect} style={{ marginBottom: 10 }}>
        📂 画像 / PDF を選択
      </button>

      <input
        id="fileInput"
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={handleImageSelect}
      />

      {/* プレビュー */}
      {imagePreview && (
        <div style={{ marginTop: 20 }}>
          <img
            src={imagePreview}
            style={{ maxWidth: '100%', borderRadius: 8 }}
          />
        </div>
      )}

      {/* OCR ボタン */}
      <button
        onClick={processImage}
        disabled={!selectedFile || loading}
        style={{ marginTop: 20 }}
      >
        🔍 OCR 実行
      </button>

      {/* ステータスメッセージ */}
      {statusMessage && <p style={{ marginTop: 10 }}>{statusMessage}</p>}
      {loading && <p style={{ marginTop: 10 }}>処理中です…</p>}

      {/* ---- ヘッダー行の JSON ---- */}
      {headerJson && (
        <div
          style={{
            marginTop: 30,
            padding: 10,
            background: '#eef7ff',
            borderRadius: 6,
          }}
        >
          <h3>🟦 ヘッダー行（rowIndex = 0）</h3>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{headerJson}</pre>
        </div>
      )}

      {/* ---- 全テーブル JSON ---- */}
      {tablesJson && (
        <div
          style={{
            marginTop: 30,
            padding: 10,
            background: '#f8f8f8',
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
