"use client";

import { useState, useMemo } from "react";

// --- Types ---
type TableCell = {
  rowIndex: number;
  columnIndex: number;
  content?: string;
  boundingRegions?: { polygon: number[] }[];
};

type Table = {
  cells: TableCell[];
};

type DisplayRow = {
  rowIndex: number;
  columns: string[];
  results: (string | null)[];
};

type DocInfo = {
  facilityName: string;
  year: string;
  month: string;
  day: string;
  dayOfWeek: string;
};
// --- Constants ---
const TARGET_COLUMNS = [
  "氏名",
  "カット",
  "カラー",
  "パーマ",
  "ヘアーマニキュア",
  "顔そり",
  "シャンプー",
  "施術実施",
];

// --- Constants (環境変数から取得) ---
// --- Constants (NEXT_PUBLIC_ を付けて参照) ---
const CUSTOM_VISION_API_KEY = process.env.NEXT_PUBLIC_CUSTOM_VISION_KEY || "";
const CUSTOM_VISION_ENDPOINT = process.env.NEXT_PUBLIC_CUSTOM_VISION_ENDPOINT || "";
const PROJECT_ID = process.env.NEXT_PUBLIC_CUSTOM_VISION_PROJECT_ID || "";
const ITERATION_ID = process.env.NEXT_PUBLIC_CUSTOM_VISION_ITERATION_ID || "";

// --- Logic Variables (Outside to persist as per original) ---
const rowMap: Record<number, Record<number, string>> = {};
const targetColumnIndices: number[] = [];
const columnHeaders: string[] = [];
let nameRowIndex = 0;
let nameColumnIndex: number | undefined;
let tempColumnName: string | undefined = undefined;
let tempColumnIndex: number | undefined = undefined;

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string>();
  const [rows, setRows] = useState<DisplayRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [markdown, setMarkdown] = useState<string>("");
  const [menuCounts, setMenuCounts] = useState<Record<string, number>>({});
  // 追加: 施設情報・日付のステート
  const [docInfo, setDocInfo] = useState<DocInfo | null>(null);

  const onSubmit = async () => {
    if (!file || !imageUrl) return;

    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      // 1. Azure Analyze APIの呼び出し
      const res = await fetch("/api/analyze", { method: "POST", body: formData });
      const data = await res.json();

      const extractedMarkdown = data.analyzeResult.content;
      console.log(extractedMarkdown);
      setMarkdown(extractedMarkdown);

      // 2. 追加: Gemini APIへMarkdownを送信して情報を特定
      const geminiRes = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: extractedMarkdown }),
      });
      
      if (geminiRes.ok) {
        const info = await geminiRes.json();
        setDocInfo(info);
      }

      // 3. テーブル解析処理 (既存ロジック)
      const tables: Table[] = data?.analyzeResult?.tables ?? [];
      if (!tables.length) {
        setRows([]);
        setLoading(false);
        return;
      }

      const displayRows = await buildDisplayRows(tables[0], imageUrl);
      setRows(displayRows);
    } catch (error) {
      console.error("Error during analysis:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleResult = (rowIndex: number, colIndex: number) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.rowIndex !== rowIndex) return row;
        const nextResults = [...row.results];
        const current = nextResults[colIndex];
        if (current === null) nextResults[colIndex] = "〇";
        else if (current === "〇") nextResults[colIndex] = "×";
        else nextResults[colIndex] = null;
        return { ...row, results: nextResults };
      })
    );
  };

  const toggleRowSelection = (rowIndex: number) => {
    setSelectedRows((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(rowIndex)) newSet.delete(rowIndex);
      else newSet.add(rowIndex);
      return newSet;
    });
  };

  const countMenuResults = () => {
    const columnNames = targetColumnIndices.map((_, i) => columnHeaders[i]);
    const menuResultIndices = columnNames
      .map((name, resultIndex) => ({ name, resultIndex }))
      .filter((x) => x.name !== "氏名" && x.name !== "施術実施");

    const counts: Record<string, number> = {};
    menuResultIndices.forEach(({ name }) => {
      counts[name] = 0;
    });

    rows.forEach((row) => {
      const shijitsuResultIndex = row.results.length - 1;
      const shijitsuResult = row.results[shijitsuResultIndex];
      if (shijitsuResult !== "〇") return;

      menuResultIndices.forEach(({ name, resultIndex }) => {
        if (row.results[resultIndex] === "〇") {
          counts[name]++;
        }
      });
    });

    console.log("メニュー別カウント結果", counts);
    setMenuCounts(counts);
  };

const onExportExcel = async () => {
    if (!markdown) {
      alert("まだMarkdownが取得されていません");
      return;
    }
    
    setLoading(true);
    try {
      // 令和の年数を計算 (2026年は令和8年)
      let reiwaYearStr = "";
      if (docInfo?.year) {
        const yearNum = parseInt(docInfo.year);
        if (!isNaN(yearNum)) {
          reiwaYearStr = `令和${yearNum - 2018}年`;
        }
      }

      // APIへのペイロードを作成
      const payload = { 
        counts: menuCounts,
        facility: docInfo?.facilityName || "",
        reiwaYear: reiwaYearStr,
        month: docInfo?.month || "",
        day: docInfo?.day || "",
        weekday: docInfo?.dayOfWeek || ""
      };

      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        alert("Excel出力に失敗しました");
        setLoading(false);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      
      // ファイル名に施設名を含めると管理しやすくなります
      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = docInfo?.facilityName 
        ? `${docInfo.facilityName}_${dateStr}.xlsx` 
        : `order_${dateStr}.xlsx`;

      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("処理中にエラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px", fontFamily: "sans-serif", backgroundColor: "#f9fafb", minHeight: "100vh" }}>
      <div style={{ backgroundColor: "white", padding: "24px", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "20px", color: "#111827" }}>顧客 × メニュー 判定システム</h1>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center", marginBottom: "24px" }}>
          <input
            type="file"
            accept="image/*"
            style={{ padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px", flex: "1", minWidth: "200px" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFile(f);
                setImageUrl(URL.createObjectURL(f));
              }
            }}
          />
          <button 
            onClick={onSubmit} 
            disabled={loading}
            style={{ padding: "10px 20px", backgroundColor: loading ? "#9ca3af" : "#2563eb", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "600" }}
          >
            {loading ? "解析中..." : "アップロード & 解析"}
          </button>
          <button 
            onClick={countMenuResults}
            style={{ padding: "10px 20px", backgroundColor: "#059669", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "600" }}
          >
            集計確定
          </button>
          <button 
            onClick={onExportExcel}
            style={{ padding: "10px 20px", backgroundColor: "#4b5563", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "600" }}
          >
            Excel出力
          </button>
        </div>

        {/* 追加：Geminiの解析結果表示エリア */}
        {docInfo && (
          <div style={{ marginBottom: "24px", padding: "16px", backgroundColor: "#f0fdf4", borderRadius: "8px", border: "1px solid #bbf7d0", display: "flex", gap: "24px", color: "#166534" }}>
            <div><strong>施設名:</strong> {docInfo.facilityName}</div>
            <div><strong>施術日:</strong> {docInfo.year}年{docInfo.month}月{docInfo.day}日 ({docInfo.dayOfWeek})</div>
          </div>
        )}

        {/* 集計結果の表示 */}
        {Object.keys(menuCounts).length > 0 && (
          <div style={{ marginBottom: "24px", padding: "16px", backgroundColor: "#eff6ff", borderRadius: "8px", border: "1px solid #bfdbfe" }}>
            <h2 style={{ fontSize: "16px", fontWeight: "bold", marginBottom: "12px", color: "#1e40af" }}>【メニュー別集計 (施術実施のみ)】</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: "12px" }}>
              {Object.entries(menuCounts).map(([name, count]) => (
                <div key={name} style={{ backgroundColor: "white", padding: "8px", borderRadius: "6px", textAlign: "center", border: "1px solid #dbeafe" }}>
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>{name}</div>
                  <div style={{ fontSize: "20px", fontWeight: "bold", color: "#111827" }}>{count} <span style={{ fontSize: "12px" }}>名</span></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* テーブル表示エリア */}
        <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: "8px" }}>
          {rows.map((row) => (
            <RowView
              key={row.rowIndex}
              row={row}
              onToggle={toggleResult}
              onRowClick={toggleRowSelection}
              isSelected={selectedRows.has(row.rowIndex)}
            />
          ))}
        </div>
      </div>

      {/* 画像プレビューエリア */}
      {imageUrl && (
        <div style={{ backgroundColor: "white", padding: "24px", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}>
          <h2 style={{ fontSize: "18px", fontWeight: "bold", marginBottom: "16px" }}>元画像プレビュー</h2>
          <img src={imageUrl} alt="preview" style={{ maxWidth: "100%", height: "auto", borderRadius: "8px", border: "1px solid #e5e7eb" }} />
        </div>
      )}
    </main>
  );
}
// --- Logic functions (Copied exactly) ---
async function buildDisplayRows(table: Table, imageUrl: string): Promise<DisplayRow[]> {
  const filteredCellsGroupedByRow: Record<number, { rowIndex: number; columnIndex: number; polygon: number[]; result: string | null }[]> = {};

  for (const cell of table.cells) {
    const content = cell.content?.trim();
    if (!content) continue;
    const match = TARGET_COLUMNS.find((t) => content.includes(t));
    if (!match) continue;
    if (match === "氏名" && nameColumnIndex === undefined) {
      nameColumnIndex = cell.columnIndex;
      nameRowIndex = cell.rowIndex;
    }
    if (match.includes("施術実施")) {
      tempColumnName = match;
      tempColumnIndex = cell.columnIndex;
    } else {
      if (!columnHeaders.includes(match)) {
        columnHeaders.push(match);
        targetColumnIndices.push(cell.columnIndex);
      }
    }
  }
  if (tempColumnName && tempColumnIndex !== undefined) {
    columnHeaders.push(tempColumnName);
    targetColumnIndices.push(tempColumnIndex);
  }

  const targetRowIndices = table.cells
    .filter((c) => c.columnIndex === nameColumnIndex && c.rowIndex > nameRowIndex + 3 && c.content)
    .map((c) => c.rowIndex);

  for (const cell of table.cells) {
    if (targetRowIndices.includes(cell.rowIndex) && targetColumnIndices.slice(1).includes(cell.columnIndex) && cell.content) {
      if (!filteredCellsGroupedByRow[cell.rowIndex]) {
        filteredCellsGroupedByRow[cell.rowIndex] = [];
      }
      filteredCellsGroupedByRow[cell.rowIndex].push({
        rowIndex: cell.rowIndex,
        columnIndex: cell.columnIndex,
        polygon: cell.boundingRegions?.[0]?.polygon ?? [],
        result: null,
      });
    }
  }

  const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(img);
      img.src = src;
    });

  const baseImage = await loadImage(imageUrl);
  const MAX_CONCURRENT = 4;
  let running = 0;
  const queue: (() => Promise<void>)[] = [];

  const enqueue = (task: () => Promise<void>) =>
    new Promise<void>((resolve) => {
      queue.push(async () => {
        running++;
        try { await task(); } finally { running--; resolve(); }
      });
    });

  const runQueue = async () => {
    while (queue.length || running) {
      while (running < MAX_CONCURRENT && queue.length) {
        const job = queue.shift();
        job && job();
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  };

  for (const cells of Object.values(filteredCellsGroupedByRow)) {
    for (const cell of cells) {
      enqueue(async () => {
        const [x1, y1, x2, , , y3] = cell.polygon;
        const w = Math.abs(x2 - x1);
        const h = Math.abs(y3 - y1);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = w; canvas.height = h;
        ctx.drawImage(baseImage, x1, y1, w, h, 0, 0, w, h);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
        if (!blob) return;
        const fd = new FormData();
        fd.append("image", blob);
        const res = await fetch(`${CUSTOM_VISION_ENDPOINT}customvision/v3.0/Prediction/${PROJECT_ID}/classify/iterations/${ITERATION_ID}/image`, {
          method: "POST", headers: { "Prediction-Key": CUSTOM_VISION_API_KEY }, body: fd,
        });
        if (res.ok) {
          const json = await res.json();
          cell.result = json.predictions?.[0]?.tagName ?? null;
        }
      });
    }
  }
  await runQueue();

  for (const cell of table.cells) {
    if (cell.rowIndex >= nameRowIndex && cell.rowIndex < (nameRowIndex + targetRowIndices.length + 4) && targetColumnIndices.includes(cell.columnIndex)) {
      if (!rowMap[cell.rowIndex]) rowMap[cell.rowIndex] = {};
      rowMap[cell.rowIndex][cell.columnIndex] = cell.content ?? "";
    }
  }

  let yamadaRowIndex: number | null = null;
  let yamadaColumnIndex: number | null = null;
  for (const [r, cols] of Object.entries(rowMap)) {
    for (const [c, value] of Object.entries(cols)) {
      if (value === "山田 太郎") {
        yamadaRowIndex = Number(r);
        yamadaColumnIndex = Number(c);
        break;
      }
    }
    if (yamadaRowIndex !== null) break;
  }

  return Object.keys(rowMap)
    .map((r) => {
      const rowIndex = Number(r);
      const columns = targetColumnIndices.map((c) => rowMap[rowIndex]?.[c] ?? "");
      const results = targetColumnIndices.map((c) => {
        const visionCell = filteredCellsGroupedByRow[rowIndex]?.find((x) => x.columnIndex === c);
        const result = visionCell?.result;
        const content = rowMap[rowIndex]?.[c] ?? "";
        if (yamadaRowIndex === null || yamadaColumnIndex === null || rowIndex <= yamadaRowIndex || c <= yamadaColumnIndex) {
          return null;
        }
        if (result === "Circle" || result === "Check") return "〇";
        if (result === "Cross" || result === "Slash" || content === "") return "×";
        return null;
      });
      return { rowIndex, columns, results };
    })
    .sort((a, b) => a.rowIndex - b.rowIndex);
}

// --- UI Components ---
function RowView({ row, onToggle, onRowClick, isSelected }: { row: DisplayRow; onToggle: (rowIndex: number, colIndex: number) => void; onRowClick: (rowIndex: number) => void; isSelected: boolean; }) {
  const isHeaderRow = row.results.every((r) => r === null);

  return (
    <div
      style={{
        display: "flex",
        minWidth: "max-content",
        borderBottom: "1px solid #e5e7eb",
        backgroundColor: isHeaderRow ? "#f9fafb" : isSelected ? "#f3f4f6" : "transparent",
        transition: "background-color 0.2s",
        cursor: !isHeaderRow ? "pointer" : "default",
      }}
      onClick={() => { if (!isHeaderRow) onRowClick(row.rowIndex); }}
    >
      {row.columns.map((c, i) => {
        const result = row.results[i];
        const isName = i === 0;
        
        return (
          <div
            key={i}
            style={{
              width: 120,
              padding: "12px 8px",
              textAlign: "center",
              fontSize: isHeaderRow ? "13px" : "14px",
              fontWeight: isHeaderRow ? "600" : "normal",
              color: isHeaderRow ? "#4b5563" : "#111827",
              borderRight: "1px solid #f3f4f6",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (!isHeaderRow && !isName) onToggle(row.rowIndex, i);
            }}
          >
            {isHeaderRow ? c : (
              isName ? c : (
                <span style={{ 
                  fontSize: "18px", 
                  fontWeight: "bold",
                  color: result === "〇" ? "#ef4444" : result === "×" ? "#9ca3af" : "inherit"
                }}>
                  {result ?? ""}
                </span>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}