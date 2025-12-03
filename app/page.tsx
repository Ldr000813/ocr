'use client'; 

import { useState } from 'react';

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tablesJson, setTablesJson] = useState<string | null>(null);
  const [headerJson, setHeaderJson] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [checkboxResults, setCheckboxResults] = useState<any[]>([]); // チェックボックス結果を格納するためのstate

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
    setTablesJson(null);
    setHeaderJson(null);
    setCheckboxResults([]); // チェックボックス結果を初期化

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch("/api/ocr", {
        method: "POST",
        body: formData
      });

      // レスポンスのContent-Typeをチェック
      const contentType = res.headers.get("Content-Type") || "";

      /* ==========================================================
         Excel が返ってきた場合（Content-Type が xlsx）
         ========================================================== */
      if (contentType.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) {
        const blob = await res.blob();

        // ダウンロード開始フィードバック
        setStatusMessage("Excel のダウンロードが開始されました...");

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "ocr_result.xlsx";
        a.click();
        window.URL.revokeObjectURL(url);

        setStatusMessage("Excel をダウンロードしました");
        return;
      }

      /* ==========================================================
         JSON が返ってきた場合（デバッグ表示用）
         ========================================================== */
      const text = await res.text();

      try {
        const data = JSON.parse(text);

        if (data.error) {
          setStatusMessage("エラー: " + data.error);
          return;
        }

        setTablesJson(JSON.stringify(data.tables, null, 2));

        // チェック結果を抽出する処理
        const checkboxes: any[] = [];
        data.tables.forEach((table: any) => {
          table.cells.forEach((cell: any) => {
            if (cell.columnIndex === 10 && cell.content?.toLowerCase().includes("✓")) { // 「チェック結果」列を想定
              checkboxes.push({
                rowIndex: cell.rowIndex,
                content: cell.content,
              });
            }
          });
        });

        setCheckboxResults(checkboxes); // チェックボックス結果を保存

        if (data.tables?.length > 0) {
          const headerCells = data.tables[0].cells.filter(
            (c: any) => c.rowIndex === 0
          );
          setHeaderJson(JSON.stringify(headerCells, null, 2));
        }

        setStatusMessage("OCR（デバッグ JSON）を表示しました");

      } catch (err) {
        setStatusMessage("エラー: 無効なJSONが返されました");
      }

    } catch (err: any) {
      setStatusMessage("エラー: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>📄 Azure OCR デバッグ & Excel 出力ビューア</h1>

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

      {headerJson && (
        <div
          style={{
            marginTop: 30,
            padding: 10,
            background: "#eef7ff",
            borderRadius: 6,
          }}
        >
          <h3>🟦 ヘッダー行（rowIndex = 0）</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{headerJson}</pre>
        </div>
      )}

      {tablesJson && (
        <div
          style={{
            marginTop: 30,
            padding: 10,
            background: "#f8f8f8",
            borderRadius: 6,
          }}
        >
          <h3>📘 全テーブル JSON（デバッグ）</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{tablesJson}</pre>
        </div>
      )}

      {checkboxResults.length > 0 && (
        <div
          style={{
            marginTop: 30,
            padding: 10,
            background: "#fff5e6",
            borderRadius: 6,
          }}
        >
          <h3>✅ チェック結果</h3>
          <ul>
            {checkboxResults.map((result, index) => (
              <li key={index}>
                Row {result.rowIndex}: {result.content}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
