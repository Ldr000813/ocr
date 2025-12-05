'use client';

import { useState, useRef, useEffect } from 'react';

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [boundingBoxes, setBoundingBoxes] = useState<any[]>([]); // 長方形領域データを格納するstate
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const triggerFileSelect = () => {
    document.getElementById("fileInput")?.click();
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setBoundingBoxes([]); // Reset bounding boxes on new image
      const reader = new FileReader();
      reader.onload = (ev) => {
        const src = ev.target?.result as string;
        setImagePreview(src);
      };
      reader.readAsDataURL(file);
    }
  };

  // Draw image and boxes on canvas whenever imagePreview or boundingBoxes change
  useEffect(() => {
    if (!imagePreview || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.src = imagePreview;
    img.onload = () => {
      // Set canvas dimensions to match image
      canvas.width = img.width;
      canvas.height = img.height;

      // Draw original image
      ctx.drawImage(img, 0, 0);

      // Draw bounding boxes if they exist
      if (boundingBoxes.length > 0) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = "red";
        ctx.fillStyle = "rgba(255, 0, 0, 0.2)";

        boundingBoxes.forEach((item) => {
          const box = item.boundingBox; // Array of 8 numbers [x1, y1, x2, y2, x3, y3, x4, y4]
          if (box && box.length === 8) {
            ctx.beginPath();
            ctx.moveTo(box[0], box[1]);
            ctx.lineTo(box[2], box[3]);
            ctx.lineTo(box[4], box[5]);
            ctx.lineTo(box[6], box[7]);
            ctx.closePath();
            ctx.stroke();
            // Optional: fill the box slightly
            // ctx.fill();
          }
        });
      }
    };
  }, [imagePreview, boundingBoxes]);

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

  const downloadImage = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = 'checked_image.png';
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
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

      {/* Canvas for drawing image and boxes */}
      <div style={{ marginTop: 20, overflow: 'auto' }}>
        <canvas ref={canvasRef} style={{ maxWidth: "100%", height: "auto", borderRadius: 8, display: imagePreview ? 'block' : 'none' }} />
      </div>

      <div style={{ marginTop: 20, display: 'flex', gap: '10px' }}>
        <button
          onClick={processImage}
          disabled={!selectedFile || loading}
        >
          🔍 OCR 実行
        </button>

        {boundingBoxes.length > 0 && (
          <button onClick={downloadImage}>
            ⬇️ 画像をダウンロード
          </button>
        )}
      </div>

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
