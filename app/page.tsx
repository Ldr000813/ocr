'use client'; 

import { useState } from 'react';

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [boundingBoxes, setBoundingBoxes] = useState<any[]>([]); // 長方形領域データを格納するstate
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const triggerFileSelect = () => {
    document.getElementById("fileInput")?.click();
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

  /* ==========================================================
     OCR 実行 → Excel or JSON を自動判別して処理
     ========================================================== */
  const processImage = async () => {
    if (!selectedFile) {
      setStatusMessage("画像を選択してください");
      return;
    }

    setLoading(true);
    setStatusMessage(null);
    setBoundingBoxes([]); // 長方形領域を初期化

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch("/api/ocr", {
        method: "POST",
        body: formData
      });

      const data = await res.json();

      if (data.error) {
        setStatusMessage("エラー: " + data.error);
        return;
      }

      setBoundingBoxes(data.boundingBoxes); // バックエンドから受け取った長方形領域データをセット

      setStatusMessage("OCR処理が完了しました。");

    } catch (err: any) {
      setStatusMessage("エラー: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>📄 Azure OCR デバッグ & 長方形領域表示</h1>

      <button onClick={triggerFileSelect} style={{ marginBottom: 10 }}>
        📂 画像 / PDF を選択
      </button>

      <input
        id="fileInput"
        type="file"
        accept="image/*,application/pdf"
        style={{ display: "none" }}
        onChange={handleImageSelect}
      />

      {imagePreview && (
        <div style={{ marginTop: 20 }}>
          <img src={imagePreview} style={{ maxWidth: "100%", borderRadius: 8 }} />
        </div>
      )}

      <button
        onClick={processImage}
        disabled={!selectedFile || loading}
        style={{ marginTop: 20 }}
      >
        🔍 OCR 実行
      </button>

      {statusMessage && <p style={{ marginTop: 10 }}>{statusMessage}</p>}
      {loading && <p style={{ marginTop: 10 }}>処理中です…</p>}

      {boundingBoxes.length > 0 && (
        <div
          style={{
            marginTop: 30,
            padding: 10,
            background: "#f8f8f8",
            borderRadius: 6,
          }}
        >
          <h3>📦 選択マークの長方形領域</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(boundingBoxes, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
