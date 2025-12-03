'use client'; 

import { useState, useRef, useEffect } from 'react';

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [boundingBoxes, setBoundingBoxes] = useState<any[]>([]); // 長方形領域データを格納するstate
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  
  // 画像表示とキャンバスで長方形を描画するためのref
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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

  // 画像と長方形領域を描画する処理
  useEffect(() => {
    if (imageRef.current && canvasRef.current && boundingBoxes.length > 0) {
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (context) {
        // キャンバスのサイズを画像に合わせる
        canvas.width = imageRef.current.width;
        canvas.height = imageRef.current.height;

        // 長方形領域を描画
        boundingBoxes.forEach((box) => {
          context.strokeStyle = "red"; // 赤色で描画
          context.lineWidth = 2;

          // boundingBoxは[左上x, 左上y, 幅, 高さ]の形式であることを想定
          const [x, y, width, height] = box.boundingBox;
          context.strokeRect(x, y, width, height); // 長方形を描画
        });
      }
    }
  }, [boundingBoxes]);

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
        <div style={{ marginTop: 20, position: "relative" }}>
          <img
            ref={imageRef}
            src={imagePreview}
            alt="Preview"
            style={{ maxWidth: "100%", borderRadius: 8 }}
          />
          {/* キャンバスを画像の上に重ねる */}
          <canvas
            ref={canvasRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              pointerEvents: "none", // 画像の上でキャンバスがクリックされないようにする
            }}
          />
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
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(boundingBoxes, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
