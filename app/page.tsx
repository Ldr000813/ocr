"use client";

import { useState, useEffect, useRef } from "react";

// --- Types ---
type TableCell = {
  rowIndex: number;
  columnIndex: number;
  content?: string;
  boundingRegions?: { polygon: number[] }[];
};

interface BoundingRegion {
  pageNumber: number;
  polygon: number[];
}

interface Table {
  rowCount: number;
  columnCount: number;
  cells: TableCell[];
  boundingRegions?: BoundingRegion[];
}

type DisplayRow = {
  rowIndex: number;
  columns: string[];
  results: (string | null)[];
  sourceImageIndex?: number;
  sourceImageName?: string;
  groupId?: number;
};

type DocInfo = {
  facilityName: string;
  year: string;
  month: string;
  day: string;
  dayOfWeek: string;
};

type PageImage = {
  blob: Blob;
  imageUrl: string;
  pageNumber: number;
  width: number;
  height: number;
  rotation: number; // 0, 90, 180, 270
  fileName: string;
};

// --- Constants ---
const TARGET_COLUMNS = [
  "氏名",
  "カット",
  "カラー",
  "パーマ",
  "ヘアーマニキュア",
  "ベットカット",
  "ペットカット",
  "顔そり",
  "シャンプー",
  "施術実施",
];

const CUSTOM_VISION_API_KEY = process.env.NEXT_PUBLIC_CUSTOM_VISION_KEY || "";
const CUSTOM_VISION_ENDPOINT = process.env.NEXT_PUBLIC_CUSTOM_VISION_ENDPOINT || "";
const PROJECT_ID = process.env.NEXT_PUBLIC_CUSTOM_VISION_PROJECT_ID || "";
const ITERATION_ID = process.env.NEXT_PUBLIC_CUSTOM_VISION_ITERATION_ID || "";

// --- ヘルパー関数: 複数テーブルの解析結果を連結 ---
function mergeDisplayResults(results: { displayRows: DisplayRow[], indices: number[], headers: string[] }[]) {
  console.log(`  📊 mergeDisplayResults: ${results.length}個の結果を処理`);
  if (results.length === 0) return null;
  if (results.length === 1) return results[0];

  // 1つ目の結果をディープコピーしてベースにする
  const base = JSON.parse(JSON.stringify(results[0]));
  console.log(`    結果[0]: ${base.displayRows.length}行 (ベース)`);
  console.log(`    結果[0]の内訳:`, base.displayRows.map((r: DisplayRow, idx: number) => ({
    index: idx,
    name: r.columns[0],
    isHeader: r.results.every((res: string | null) => res === null)
  })));

  for (let i = 1; i < results.length; i++) {
    const current = results[i];
    console.log(`    結果[${i}]: ${current.displayRows.length}行 (処理前)`);
    console.log(`    結果[${i}]の内訳:`, current.displayRows.map((r, idx) => ({
      index: idx,
      name: r.columns[0],
      isHeader: r.results.every(res => res === null)
    })));

    // ヘッダー行（results がすべて null の行）を検出してスキップ
    // 「山田 太郎」行もスキップ（サンプル行のため）
    const dataRows = current.displayRows.filter(row => {
      const isHeaderRow = row.results.every(r => r === null);
      const isYamadaRow = row.columns[0] === "山田 太郎";
      const shouldSkip = isHeaderRow || isYamadaRow;

      if (shouldSkip) {
        console.log(`      スキップ: ${row.columns[0]} (ヘッダー=${isHeaderRow}, 山田=${isYamadaRow})`);
      }

      return !shouldSkip;
    });

    console.log(`    → ${dataRows.length}行を追加 (フィルタ後)`);

    // ベースの配列に結合
    base.displayRows = [...base.displayRows, ...dataRows];
  }

  console.log(`  ✅ マージ後の合計: ${base.displayRows.length}行`);
  return base;
}

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<DisplayRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [markdown, setMarkdown] = useState<string>("");
  const [menuCounts, setMenuCounts] = useState<Record<string, number>>({});
  const [docInfo, setDocInfo] = useState<DocInfo | null>(null);

  const [targetColumnIndices, setTargetColumnIndices] = useState<number[]>([]);
  const [columnHeaders, setColumnHeaders] = useState<string[]>([]);
  const [previewImages, setPreviewImages] = useState<PageImage[]>([]);
  const [processingProgress, setProcessingProgress] = useState<{ current: number, total: number }>();
  const [tableZoomLevel, setTableZoomLevel] = useState(100);
  const [zoomedImageIndex, setZoomedImageIndex] = useState<number | null>(null);
  const [debugMode, setDebugMode] = useState<boolean>(false);

  // 一括編集モーダル用state
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkTargetColIndex, setBulkTargetColIndex] = useState<number | null>(null);
  const [bulkScope, setBulkScope] = useState<"all" | "image" | "page">("all");
  const [bulkTargetImageIndex, setBulkTargetImageIndex] = useState<number>(0);
  const [bulkTargetPage, setBulkTargetPage] = useState<number>(1);

  const tableScrollRef = useRef<HTMLDivElement>(null);

  // メモリクリーンアップ: コンポーネントアンマウント時のみobject URLを解放
  useEffect(() => {
    return () => {
      previewImages.forEach(page => URL.revokeObjectURL(page.imageUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 空の依存配列: アンマウント時のみクリーンアップ

  // テーブルが更新されたときにスクロール位置を左端にリセット
  useEffect(() => {
    if (rows.length > 0 && tableScrollRef.current) {
      const resetScroll = () => {
        if (tableScrollRef.current) {
          tableScrollRef.current.scrollLeft = 0;
        }
      };
      resetScroll();
      setTimeout(resetScroll, 50);
      setTimeout(resetScroll, 100);
    }
  }, [rows]);

  // --- メニュー列の動的追加 ---
  const addNewMenuColumn = () => {
    const menuName = prompt("追加するメニュー名を入力してください");
    if (!menuName) return;

    setColumnHeaders((prev) => {
      const next = [...prev];
      next.splice(next.length - 1, 0, menuName);
      return next;
    });

    setRows((prev) =>
      prev.map((row) => {
        const isHeader = row.results.every((r) => r === null);
        const nextResults = [...row.results];
        const nextColumns = [...row.columns];
        const insertIdx = nextResults.length - 1;
        nextResults.splice(insertIdx, 0, isHeader ? null : "×");
        nextColumns.splice(insertIdx, 0, isHeader ? menuName : "");
        return { ...row, results: nextResults, columns: nextColumns };
      })
    );
  };

  // --- メニュー列の削除 ---
  const removeMenuColumn = (colIndex: number) => {
    const menuName = columnHeaders[colIndex];
    if (menuName === "氏名" || menuName === "施術実施") {
      alert("この列は削除できません");
      return;
    }
    if (!confirm(`メニュー「${menuName}」を削除しますか？`)) return;

    setColumnHeaders((prev) => prev.filter((_, i) => i !== colIndex));
    setRows((prev) =>
      prev.map((row) => ({
        ...row,
        results: row.results.filter((_, i) => i !== colIndex),
        columns: row.columns.filter((_, i) => i !== colIndex),
      }))
    );
  };

  // --- 人の追加 ---
  const addNewPersonRow = () => {
    const personName = prompt("追加する氏名を入力してください");
    if (!personName) return;

    setRows((prev) => {
      const maxIdx = prev.length > 0 ? Math.max(...prev.map(r => r.rowIndex)) : 0;
      const newRow: DisplayRow = {
        rowIndex: maxIdx + 1,
        columns: columnHeaders.map((h, i) => i === 0 ? personName : ""),
        results: columnHeaders.map((h, i) => i === 0 ? null : "×")
      };
      return [...prev, newRow];
    });
  };

  // --- 人の削除 ---
  const removePersonRow = (rowIndex: number) => {
    const row = rows.find(r => r.rowIndex === rowIndex);
    if (!row) return;
    if (!confirm(`「${row.columns[0]}」さんの行を削除しますか？`)) return;
    setRows((prev) => prev.filter(r => r.rowIndex !== rowIndex));
  };

  // --- 画像回転 ---
  const rotateImage = (index: number) => {
    setPreviewImages((prev) => {
      const newImages = [...prev];
      newImages[index] = {
        ...newImages[index],
        rotation: (newImages[index].rotation + 90) % 360
      };
      return newImages;
    });
  };

  // --- 回転を反映した画像を生成 ---
  const createRotatedImage = async (pageImage: PageImage): Promise<Blob> => {
    if (pageImage.rotation === 0) {
      return pageImage.blob;
    }

    // 画像を読み込む
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = pageImage.imageUrl;
    });

    // Canvasを作成
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context not available');

    // 回転角度に応じてcanvasのサイズを設定
    const rotation = pageImage.rotation;
    if (rotation === 90 || rotation === 270) {
      canvas.width = img.height;
      canvas.height = img.width;
    } else {
      canvas.width = img.width;
      canvas.height = img.height;
    }

    // 回転を適用
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);

    // Blobに変換
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Blob creation failed')),
        'image/png',
        0.95
      );
    });
  };

  // --- 解析実行 ---
  const onSubmit = async () => {
    if (previewImages.length === 0) {
      alert('画像を選択してください。');
      return;
    }

    setLoading(true);

    try {
      let allResults: any[] = [];
      let firstPageMarkdown = '';
      const totalPages = previewImages.length;

      setProcessingProgress({ current: 0, total: totalPages });
      let globalImageIndex = 0;
      let globalGroupId = 0;

      console.log(`\n📦 ${previewImages.length}枚の画像を処理開始`);

      // 各プレビュー画像を処理
      for (let i = 0; i < previewImages.length; i++) {
        const pageImage = previewImages[i];
        console.log(`\n📄 画像 ${i + 1}/${previewImages.length}: ${pageImage.fileName} (回転: ${pageImage.rotation}°)`);

        // 回転を反映した画像を生成
        const rotatedBlob = await createRotatedImage(pageImage);

        const formData = new FormData();
        formData.append('file', rotatedBlob, `${pageImage.fileName}.png`);

        console.log(`  🌐 API呼び出し中...`);

        // リトライ機能付きAPI呼び出し
        let res;
        let data;
        let retryCount = 0;
        const maxRetries = 5;

        while (retryCount <= maxRetries) {
          try {
            res = await fetch('/api/analyze', { method: 'POST', body: formData });

            if (res.status === 403 || res.status === 429) {
              if (retryCount < maxRetries) {
                const waitTime = (5 + retryCount * 2) * 1000;
                const errorType = res.status === 403 ? "アクセス権限/クォータエラー (403)" : "レート制限 (429)";
                console.warn(`  ⚠️ ${errorType}。${waitTime / 1000}秒待機後にリトライ... (${retryCount + 1}/${maxRetries})`);

                if (res.status === 403) {
                  await new Promise(r => setTimeout(r, waitTime + 2000));
                } else {
                  await new Promise(r => setTimeout(r, waitTime));
                }
                retryCount++;
                continue;
              } else {
                console.error(`  ❌ 最大リトライ回数に達しました`);
                if (res.status === 403) {
                  throw new Error(`APIアクセスが拒否されました (403)。\nAzure Document IntelligenceのFree Tier (F0) のクォータ制限(月間制限または同時アクセス制限)を超過した可能性があります。\n時間を空けて試すか、リソースの価格レベルを確認してください。`);
                }
                throw new Error(`API呼び出しが失敗しました: ${res.status} ${res.statusText}`);
              }
            }

            if (!res.ok) {
              throw new Error(`API呼び出しが失敗しました: ${res.status} ${res.statusText}`);
            }

            data = await res.json();
            break;
          } catch (error) {
            if (retryCount >= maxRetries) {
              throw error;
            }
            retryCount++;
            await new Promise(r => setTimeout(r, 2000));
          }
        }

        // 最初の画像のMarkdownを保存（Gemini用）
        if (i === 0) {
          firstPageMarkdown = data.analyzeResult?.content || '';
          setMarkdown(firstPageMarkdown);
          console.log(`  📝 Markdown抽出完了: ${firstPageMarkdown.length}文字`);
        }

        const tables: Table[] = data?.analyzeResult?.tables ?? [];
        console.log(`  📊 検出されたテーブル数: ${tables.length}`);

        const validTables = tables.filter(t => (t.rowCount + t.columnCount) > 10);
        console.log(`  ✓ 有効なテーブル数 (row+col > 10): ${validTables.length}`);

        for (const table of validTables) {
          // セルソート
          table.cells.sort((a, b) => {
            const a_y = Math.min(a.boundingRegions?.[0]?.polygon[1] ?? 0,
              a.boundingRegions?.[0]?.polygon[3] ?? 0);
            const b_y = Math.min(b.boundingRegions?.[0]?.polygon[1] ?? 0,
              b.boundingRegions?.[0]?.polygon[3] ?? 0);
            if (a_y !== b_y) return a_y - b_y;
            const a_x = Math.min(a.boundingRegions?.[0]?.polygon[0] ?? 0,
              a.boundingRegions?.[0]?.polygon[6] ?? 0);
            const b_x = Math.min(b.boundingRegions?.[0]?.polygon[0] ?? 0,
              b.boundingRegions?.[0]?.polygon[6] ?? 0);
            return a_x - b_x;
          });

          console.log(`  🔧 buildDisplayRows実行中... (${table.rowCount}行 x ${table.columnCount}列)`);
          const buildResult = await buildDisplayRows(table, pageImage.imageUrl, globalImageIndex, pageImage.fileName, globalGroupId, rotatedBlob, debugMode);
          console.log(`  ✅ buildDisplayRows完了: ${buildResult.displayRows.length}行のデータ`);
          allResults.push(buildResult);
          globalGroupId++;
        }

        globalImageIndex++;
        setProcessingProgress({ current: i + 1, total: totalPages });

        // レート制限（1000ms待機）
        if (i < previewImages.length - 1) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      console.log(`\n📦 全画像処理完了。allResults配列: ${allResults.length}個のテーブル結果`);

      // Gemini APIで文書情報を抽出（最初のMarkdownから）
      if (firstPageMarkdown) {
        console.log('🤖 Gemini APIで文書情報を抽出中...');
        try {
          const geminiRes = await fetch('/api/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: firstPageMarkdown }),
          });
          if (geminiRes.ok) {
            const info = await geminiRes.json();
            setDocInfo(info);
            console.log('✅ 文書情報取得完了:', info);
          } else {
            console.warn('⚠️ Gemini API呼び出し失敗:', await geminiRes.text());
          }
        } catch (geminiError) {
          console.warn('⚠️ Gemini APIエラー:', geminiError);
        }
      }

      // ===== 共通マージ処理 =====
      console.log(`\n🔗 マージ処理開始: ${allResults.length}個の結果を結合`);
      const merged = mergeDisplayResults(allResults);

      if (merged) {
        console.log(`✅ マージ完了: 最終的に${merged.displayRows.length}行のデータ`);
        const finalRows = merged.displayRows.map((row: DisplayRow, idx: number) => ({
          ...row,
          rowIndex: idx
        }));

        setRows(finalRows);
        setTargetColumnIndices(merged.indices);
        setColumnHeaders(merged.headers);
      } else {
        console.warn('⚠️ マージ結果がnullです');
      }

    } catch (error) {
      console.error('❌ 解析エラー:', error);

      let errorMessage = '解析中にエラーが発生しました。';
      if (error instanceof Error) {
        errorMessage += `\n\nエラー詳細: ${error.message}`;

        // レート制限エラーの場合
        if (error.message.includes('403') || error.message.includes('429')) {
          errorMessage += '\n\n⚠️ Azure APIのレート制限に達した可能性があります。';
          errorMessage += '\n数分待ってから再度お試しください。';
          errorMessage += '\nまたは、一度に処理するファイル数を減らしてください。';
        }
      }

      alert(errorMessage);
    } finally {
      setLoading(false);
      setProcessingProgress(undefined);
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

  const toggleColumnResult = (colIndex: number) => {
    // 施術実施列の場合は一括編集モーダルを開く
    const headerName = columnHeaders[colIndex];
    if (headerName === "施術実施") {
      setBulkTargetColIndex(colIndex);
      setBulkModalOpen(true);
      return;
    }

    // 他の列は従来のトグル動作
    setRows((prev) => {
      const firstDataRow = prev.find((r) => r.results.some((val) => val !== null));
      if (!firstDataRow) return prev;
      const currentVal = firstDataRow.results[colIndex];
      let nextVal: string | null = (currentVal === null || currentVal === "×") ? "〇" : (currentVal === "〇" ? "×" : null);

      return prev.map((row) => {
        if (row.results.every((r) => r === null)) return row;
        const nextResults = [...row.results];
        nextResults[colIndex] = nextVal;
        return { ...row, results: nextResults };
      });
    });
  };

  // 一括更新ロジック
  const executeBulkUpdate = (action: "ok" | "ng" | "toggle") => {
    if (bulkTargetColIndex === null) return;

    setRows(prev => prev.map(row => {
      // ヘッダー行はスキップ
      if (row.results.every(r => r === null)) return row;

      // 対象判定
      let isTarget = false;
      if (bulkScope === "all") {
        isTarget = true;
      } else if (bulkScope === "image") {
        if (row.sourceImageIndex === bulkTargetImageIndex) isTarget = true;
      } else if (bulkScope === "page") {
        // sourceImageNameからページ番号を推測するか、
        // PageImageのpageNumberを使うにはrowに紐づけが必要。
        // 簡易的に previewImages[row.sourceImageIndex].pageNumber を参照
        if (row.sourceImageIndex !== undefined) {
          const imgInfo = previewImages[row.sourceImageIndex];
          if (imgInfo && imgInfo.pageNumber === bulkTargetPage) isTarget = true;
        }
      }

      if (!isTarget) return row;

      const nextResults = [...row.results];
      const currentVal = nextResults[bulkTargetColIndex];

      let nextVal = currentVal;
      if (action === "ok") nextVal = "〇";
      if (action === "ng") nextVal = "×";
      if (action === "toggle") {
        nextVal = (currentVal === "〇") ? "×" : "〇";
      }

      nextResults[bulkTargetColIndex] = nextVal;
      return { ...row, results: nextResults };
    }));
    setBulkModalOpen(false);
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
    console.log("🔍 集計開始 - columnHeaders:", columnHeaders);

    const menuResultIndices = columnHeaders
      .map((name, index) => ({ name, index }))
      .filter((x) => x.name !== "氏名" && x.name !== "施術実施");

    console.log("🔍 メニュー項目:", menuResultIndices.map(x => x.name));

    const counts: Record<string, number> = {};
    menuResultIndices.forEach(({ name }) => { counts[name] = 0; });

    rows.forEach((row) => {
      const shijitsuResult = row.results[row.results.length - 1];
      if (shijitsuResult !== "〇") return;
      menuResultIndices.forEach(({ name, index }) => {
        if (row.results[index] === "〇") counts[name]++;
      });
    });

    console.log("🔍 集計結果 - counts:", counts);
    setMenuCounts(counts);
  };

  const onExportExcel = async () => {
    if (!markdown) return alert("まだMarkdownが取得されていません");
    setLoading(true);
    try {
      // メニュー名と単価の分離処理
      // headersには "カット ¥2,000" のような文字列が入っている可能性がある
      const sentCounts: Record<string, number> = {};
      const sentUnitPrices: Record<string, number> = {};

      Object.entries(menuCounts).forEach(([rawName, count]) => {
        // 全角半角の￥記号や金額を抽出
        const match = rawName.match(/^(.*?)([\s\u3000]*[¥￥]\s*([\d,]+))?$/);
        if (match) {
          const name = match[1].trim();
          const priceStr = match[3] ? match[3].replace(/,/g, '') : "0";
          const price = parseInt(priceStr, 10);

          // 名前が空になってしまった場合はrawNameを使う（普通はないはず）
          const finalName = name || rawName;
          sentCounts[finalName] = count;
          sentUnitPrices[finalName] = price;
        } else {
          sentCounts[rawName] = count;
          sentUnitPrices[rawName] = 0;
        }
      });

      // コンソール確認用
      console.log("📋 Export Payload Preview:", { sentCounts, sentUnitPrices });

      const grandTotal = Object.entries(sentCounts).reduce((sum, [name, count]) => {
        const unitPrice = sentUnitPrices[name] ?? 0;
        return sum + (unitPrice * count);
      }, 0);

      // (ログ出力省略)

      let reiwaYearStr = "";
      if (docInfo?.year) {
        const yearNum = parseInt(docInfo.year);
        if (!isNaN(yearNum)) reiwaYearStr = `令和${yearNum - 2018}年`;
      }
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counts: sentCounts,
          unitPrices: sentUnitPrices,
          facility: docInfo?.facilityName || "",
          reiwaYear: reiwaYearStr,
          month: docInfo?.month || "",
          day: docInfo?.day || "",
          weekday: docInfo?.dayOfWeek || ""
        }),
      });
      if (!res.ok) {
        const errorText = await res.text();
        console.error("Excel export failed:", errorText);
        throw new Error(`Export failed: ${errorText}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${docInfo?.facilityName || 'order'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
    } catch (err) {
      alert("処理中にエラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ width: "100%", maxWidth: "100vw", margin: "0", padding: "24px", fontFamily: "sans-serif", backgroundColor: "#f9fafb", minHeight: "100vh", overflowX: "auto", boxSizing: "border-box" }}>
      <div style={{ backgroundColor: "white", padding: "24px", borderRadius: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "20px", color: "#111827" }}>顧客 × メニュー 判定システム</h1>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center", marginBottom: "24px" }}>

          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px", fontWeight: "600", color: "#4b5563", backgroundColor: "#f3f4f6", padding: "8px 12px", borderRadius: "6px", cursor: "pointer", border: "1px solid #d1d5db" }}>
            <input
              type="checkbox"
              checked={debugMode}
              onChange={(e) => setDebugMode(e.target.checked)}
            />
            🛠️ デバッグモード
          </label>

          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            style={{ padding: "8px", border: "1px solid #d1d5db", borderRadius: "6px", flex: "1", minWidth: "200px" }}
            onChange={async (e) => {
              const fileList = e.target.files;
              if (fileList && fileList.length > 0) {
                const filesArray = Array.from(fileList);
                setFiles(filesArray);
                setLoading(true);

                try {
                  // 古いblob URLをクリーンアップ
                  setPreviewImages(prev => {
                    prev.forEach(page => URL.revokeObjectURL(page.imageUrl));
                    return prev;
                  });

                  const allImages: PageImage[] = [];

                  for (const file of filesArray) {
                    if (file.type === 'application/pdf') {
                      // PDFを画像に変換
                      const pageImgs = await convertPdfToImages(file);
                      // ファイル名を更新
                      pageImgs.forEach(img => {
                        img.fileName = `${file.name} - ページ ${img.pageNumber}`;
                      });
                      allImages.push(...pageImgs);
                    } else {
                      // 画像ファイル
                      const imageUrl = URL.createObjectURL(file);
                      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                        const image = new Image();
                        image.onload = () => resolve(image);
                        image.onerror = reject;
                        image.src = imageUrl;
                      });

                      allImages.push({
                        blob: file,
                        imageUrl: imageUrl,
                        pageNumber: 1,
                        width: img.width,
                        height: img.height,
                        rotation: 0,
                        fileName: file.name
                      });
                    }
                  }

                  setPreviewImages(allImages);
                } catch (error) {
                  console.error('プレビュー生成エラー:', error);
                  alert('プレビューの生成中にエラーが発生しました。');
                } finally {
                  setLoading(false);
                }
              }
            }}
          />
          <button onClick={onSubmit} disabled={loading} style={{ padding: "10px 20px", backgroundColor: loading ? "#9ca3af" : "#2563eb", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "600" }}>
            {loading ? "解析中..." : "アップロード & 解析"}
          </button>
          <button onClick={addNewMenuColumn} disabled={rows.length === 0} style={{ padding: "10px 20px", backgroundColor: "#8b5cf6", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "600" }}>メニュー追加</button>
          <button onClick={addNewPersonRow} disabled={rows.length === 0} style={{ padding: "10px 20px", backgroundColor: "#ec4899", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "600" }}>人を追加</button>
          <button onClick={countMenuResults} style={{ padding: "10px 20px", backgroundColor: "#059669", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "600" }}>集計確定</button>
          <button onClick={onExportExcel} style={{ padding: "10px 20px", backgroundColor: "#4b5563", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "600" }}>Excel出力</button>
        </div>

        {processingProgress && (
          <div style={{
            padding: '8px 16px',
            backgroundColor: '#eff6ff',
            borderRadius: '6px',
            fontSize: '14px',
            color: '#1e40af',
            marginBottom: '16px'
          }}>
            処理中: {processingProgress.current} / {processingProgress.total} ページ
          </div>
        )}

        {docInfo && (
          <div style={{ marginBottom: "24px", padding: "16px", backgroundColor: "#f0fdf4", borderRadius: "8px", border: "1px solid #bbf7d0", display: "flex", gap: "24px", color: "#166534" }}>
            <div><strong>施設名:</strong> {docInfo.facilityName}</div>
            <div><strong>施術日:</strong> {docInfo.year}年{docInfo.month}月{docInfo.day}日 ({docInfo.dayOfWeek})</div>
          </div>
        )}

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
      </div>

      <div
        style={{
          display: "flex",
          gap: "24px",
          overflowX: "auto",
          overflowY: "visible",
          scrollSnapType: "none",
          scrollBehavior: "smooth",
          marginBottom: "24px",
          WebkitOverflowScrolling: "touch",
          paddingBottom: "8px",
          width: "100%",
          minWidth: 0,
          alignItems: "flex-start"
        }}
      >
        {/* 左側: OCR結果テーブル */}
        {rows.length > 0 && (
          <div
            style={{
              flex: "0 0 auto",
              minWidth: "400px",
              maxWidth: "calc(50% - 12px)",
              backgroundColor: "white",
              padding: "24px",
              borderRadius: "12px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              direction: "ltr",
              width: "auto"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexShrink: 0 }}>
              <h2 style={{ fontSize: "18px", fontWeight: "bold", margin: 0 }}>OCR結果テーブル</h2>
              <div style={{ display: "flex", gap: "8px" }}>
                {/* 拡大縮小ボタン */}
                <button
                  onClick={() => setTableZoomLevel(prev => Math.max(50, prev - 10))}
                  style={{
                    padding: "4px 12px",
                    backgroundColor: "#f3f4f6",
                    color: "#374151",
                    border: "1px solid #d1d5db",
                    borderRadius: "4px",
                    fontSize: "14px",
                    cursor: "pointer",
                    fontWeight: "bold"
                  }}
                  title="縮小"
                >
                  −
                </button>
                <span style={{
                  padding: "4px 12px",
                  backgroundColor: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: "4px",
                  fontSize: "12px",
                  minWidth: "50px",
                  textAlign: "center",
                  display: "inline-block"
                }}>
                  {tableZoomLevel}%
                </span>
                <button
                  onClick={() => setTableZoomLevel(prev => Math.min(200, prev + 10))}
                  style={{
                    padding: "4px 12px",
                    backgroundColor: "#f3f4f6",
                    color: "#374151",
                    border: "1px solid #d1d5db",
                    borderRadius: "4px",
                    fontSize: "14px",
                    cursor: "pointer",
                    fontWeight: "bold"
                  }}
                  title="拡大"
                >
                  ＋
                </button>
              </div>
            </div>
            <div
              ref={tableScrollRef}
              style={{
                overflowX: "auto",
                overflowY: "auto",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                flex: "1",
                maxHeight: "600px",
                width: "100%",
                WebkitOverflowScrolling: "touch",
                position: "relative",
                direction: "ltr",
                textAlign: "left"
              }}
            >
              <div style={{
                display: "flex",
                flexDirection: "column",
                width: "max-content",
                minWidth: "100%",
                marginLeft: 0,
                paddingLeft: 0,
                transform: `scale(${tableZoomLevel / 100})`,
                transformOrigin: "top left",
                transition: "transform 0.2s ease"
              }}>
                {(() => {
                  // groupIdごとにグループ化
                  const groupedByGroupId: Record<number, DisplayRow[]> = {};
                  rows.forEach(row => {
                    const gId = row.groupId ?? 0;
                    if (!groupedByGroupId[gId]) {
                      groupedByGroupId[gId] = [];
                    }
                    groupedByGroupId[gId].push(row);
                  });

                  const groupIds = Object.keys(groupedByGroupId).map(Number).sort((a, b) => a - b);
                  let globalIndex = 0;

                  return groupIds.map((gId) => {
                    const groupRows = groupedByGroupId[gId];
                    const imageName = groupRows[0]?.sourceImageName || `グループ ${gId + 1}`;

                    return (
                      <div
                        key={gId}
                        style={{
                          border: "2px solid #3b82f6",
                          borderRadius: "8px",
                          marginBottom: "16px",
                          overflow: "hidden"
                        }}
                      >
                        {/* 画像名ヘッダー */}
                        <div style={{
                          backgroundColor: "#3b82f6",
                          color: "white",
                          padding: "8px 16px",
                          fontSize: "13px",
                          fontWeight: "600"
                        }}>
                          📄 {imageName}
                        </div>
                        {/* 行データ */}
                        <div>
                          {groupRows.map((row) => {
                            const isFirstRowInGroup = globalIndex === 0;
                            globalIndex++;
                            return (
                              <RowView
                                key={row.rowIndex}
                                row={row}
                                onToggle={toggleResult}
                                onHeaderToggle={toggleColumnResult}
                                onHeaderDelete={removeMenuColumn}
                                onRowDelete={removePersonRow}
                                onRowClick={toggleRowSelection}
                                isSelected={selectedRows.has(row.rowIndex)}
                                isFirstRow={isFirstRowInGroup}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        )}

        {/* 右側: 画像プレビュー */}
        <div
          style={{
            flex: "0 0 auto",
            minWidth: "600px",
            maxWidth: "calc(50% - 12px)",
            backgroundColor: "white",
            padding: "24px",
            borderRadius: "12px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0
          }}
        >
          <h2 style={{ fontSize: "18px", fontWeight: "bold", marginBottom: "16px", flexShrink: 0 }}>
            画像プレビュー {previewImages.length > 0 ? `(${previewImages.length}枚)` : ""}
          </h2>
          <div
            style={{
              flex: "1",
              overflowX: "auto",
              overflowY: "auto",
              minHeight: 0,
              width: "100%",
              maxHeight: "800px",
              WebkitOverflowScrolling: "touch"
            }}
          >
            {previewImages.length > 0 ? (
              <div style={{ display: "flex", gap: "16px", paddingBottom: "8px" }}>
                {previewImages.map((page, index) => (
                  <div
                    key={index}
                    style={{
                      flex: "0 0 auto",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                      overflow: "hidden",
                      transition: "box-shadow 0.2s",
                      position: "relative"
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.boxShadow = "0 4px 8px rgba(0,0,0,0.2)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    {/* 回転ボタン */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        rotateImage(index);
                      }}
                      style={{
                        position: "absolute",
                        top: "8px",
                        right: "8px",
                        backgroundColor: "rgba(255, 255, 255, 0.9)",
                        border: "1px solid #d1d5db",
                        borderRadius: "4px",
                        padding: "6px 12px",
                        fontSize: "12px",
                        cursor: "pointer",
                        fontWeight: "600",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                        zIndex: 10
                      }}
                      title="90度回転"
                    >
                      🔄 回転
                    </button>

                    <div
                      onClick={() => setZoomedImageIndex(index)}
                      style={{ cursor: "zoom-in" }}
                    >
                      <img
                        src={page.imageUrl}
                        alt={`Image ${index + 1}`}
                        style={{
                          height: "600px",
                          width: "auto",
                          display: "block",
                          objectFit: "contain",
                          transform: `rotate(${page.rotation}deg)`,
                          transition: "transform 0.3s ease"
                        }}
                      />
                    </div>

                    <div style={{
                      padding: "8px",
                      backgroundColor: "#f3f4f6",
                      textAlign: "center",
                      fontSize: "11px"
                    }}>
                      <div style={{ fontWeight: "600", marginBottom: "4px" }}>
                        {page.fileName}
                      </div>
                      <div style={{ color: "#6b7280", fontSize: "10px" }}>
                        回転: {page.rotation}°
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "#9ca3af",
                fontSize: "14px"
              }}>
                画像を選択してください
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 画像拡大モーダル */}
      {zoomedImageIndex !== null && previewImages[zoomedImageIndex] && (
        <div
          onClick={() => setZoomedImageIndex(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.9)",
            zIndex: 1000,
            cursor: "zoom-out",
            overflow: "auto",
            WebkitOverflowScrolling: "touch"
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              display: "inline-block",
              padding: "20px",
              minWidth: "100%",
              minHeight: "100%"
            }}
          >
            <img
              src={previewImages[zoomedImageIndex].imageUrl}
              alt="preview zoomed"
              style={{
                width: "auto",
                height: "auto",
                maxWidth: "200%",
                maxHeight: "none",
                display: "block",
                borderRadius: "8px",
                boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
                cursor: "default"
              }}
            />
            <button
              onClick={() => setZoomedImageIndex(null)}
              style={{
                position: "fixed",
                top: "20px",
                right: "20px",
                backgroundColor: "rgba(255, 255, 255, 0.9)",
                border: "none",
                borderRadius: "50%",
                width: "40px",
                height: "40px",
                fontSize: "24px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                zIndex: 1001
              }}
            >
              ×
            </button>
            <div style={{
              position: "fixed",
              bottom: "20px",
              left: "50%",
              transform: "translateX(-50%)",
              backgroundColor: "rgba(255, 255, 255, 0.9)",
              padding: "8px 16px",
              borderRadius: "20px",
              fontSize: "14px",
              color: "#111827",
              boxShadow: "0 2px 8px rgba(0,0,0,0.3)"
            }}>
              画像 {zoomedImageIndex + 1} / {previewImages.length}
            </div>
          </div>
        </div>
      )}

      {/* 一括編集モーダル */}
      {bulkModalOpen && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "rgba(0,0,0,0.5)", zIndex: 2000,
          display: "flex", alignItems: "center", justifyContent: "center"
        }} onClick={() => setBulkModalOpen(false)}>
          <div style={{
            backgroundColor: "white", padding: "24px", borderRadius: "12px",
            width: "400px", maxWidth: "90%", boxShadow: "0 4px 12px rgba(0,0,0,0.2)"
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: "18px", fontWeight: "bold", marginBottom: "16px" }}>施術実施列の一括編集</h3>

            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontWeight: "600", marginBottom: "8px" }}>適用範囲:</div>
              <label style={{ display: "block", marginBottom: "6px" }}>
                <input type="radio" checked={bulkScope === "all"} onChange={() => setBulkScope("all")} /> 全て
              </label>
              <label style={{ display: "block", marginBottom: "6px" }}>
                <input type="radio" checked={bulkScope === "image"} onChange={() => setBulkScope("image")} /> 画像を選択
              </label>
              {bulkScope === "image" && (
                <select
                  style={{ marginLeft: "20px", width: "calc(100% - 20px)", padding: "4px", marginBottom: "6px" }}
                  value={bulkTargetImageIndex}
                  onChange={(e) => setBulkTargetImageIndex(Number(e.target.value))}
                >
                  {previewImages.map((img, idx) => (
                    <option key={idx} value={idx}>{img.fileName} (Image {idx + 1})</option>
                  ))}
                </select>
              )}
              <label style={{ display: "block", marginBottom: "6px" }}>
                <input type="radio" checked={bulkScope === "page"} onChange={() => setBulkScope("page")} /> ページ番号を指定
              </label>
              {bulkScope === "page" && (
                <input
                  type="number" min={1}
                  style={{ marginLeft: "20px", padding: "4px", width: "80px" }}
                  value={bulkTargetPage}
                  onChange={(e) => setBulkTargetPage(Number(e.target.value))}
                />
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <button
                style={{ padding: "10px", backgroundColor: "#3b82f6", color: "white", border: "none", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" }}
                onClick={() => executeBulkUpdate("ok")}
              >
                全て「〇」にする
              </button>
              <button
                style={{ padding: "10px", backgroundColor: "#ef4444", color: "white", border: "none", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" }}
                onClick={() => executeBulkUpdate("ng")}
              >
                全て「×」にする
              </button>
              <button
                style={{ padding: "10px", backgroundColor: "#e5e7eb", color: "#374151", border: "none", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" }}
                onClick={() => setBulkModalOpen(false)}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// --- PDF to Images Conversion ---
async function convertPdfToImages(file: File): Promise<PageImage[]> {
  // Dynamic import to avoid SSR issues
  const pdfjsLib = await import('pdfjs-dist');

  // Configure worker (CRITICAL for pdf.js 5.x)
  // Use unpkg CDN which is more reliable
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

  // Load PDF
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pageImages: PageImage[] = [];
  const numPages = pdf.numPages;

  // Process each page
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);

    // Set scale for high quality (2x = 144 DPI)
    const scale = 2.0;
    const viewport = page.getViewport({ scale });

    // Create canvas
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas context unavailable');

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Render page to canvas
    await page.render({
      canvasContext: context,
      viewport: viewport,
      canvas: canvas
    }).promise;

    // Convert canvas to blob (PNG for quality)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => b ? resolve(b) : reject(new Error('Blob creation failed')),
        'image/png',
        0.95
      );
    });

    // Create object URL for cell cropping
    const imageUrl = URL.createObjectURL(blob);

    pageImages.push({
      blob,
      imageUrl,
      pageNumber: pageNum,
      width: viewport.width,
      height: viewport.height,
      rotation: 0,
      fileName: `page-${pageNum}`
    });

    // Clean up
    page.cleanup();
  }

  return pageImages;
}

// --- Logic functions (変更なし) ---
async function buildDisplayRows(
  table: Table,
  imageUrl: string,
  imageIndex: number = 0,
  imageName: string = "",
  groupId: number = 0,
  rotatedBlob?: Blob,
  debugMode: boolean = false
): Promise<{ displayRows: DisplayRow[], indices: number[], headers: string[] }> {
  // 元のbuildDisplayRows関数（変更なし）
  const rowMap: Record<number, Record<number, string>> = {};

  const filteredCellsGroupedByRow: Record<number, { rowIndex: number; columnIndex: number; polygon: number[]; result: string | null }[]> = {};

  // 1. ヘッダー行と「氏名」列、「合計」列を探す
  let nameRowIndex = -1;
  let nameColumnIndex = -1;
  let totalColumnIndex = -1;
  let shijitsuColumnIndex = -1;

  // まず「氏名」を探す
  for (const cell of table.cells) {
    const content = cell.content?.trim() || "";
    if (content === "氏名") {
      nameRowIndex = cell.rowIndex;
      nameColumnIndex = cell.columnIndex;
      break;
    }
  }

  if (nameRowIndex === -1 || nameColumnIndex === -1) {
    console.error("氏名列が見つかりませんでした");
    return { displayRows: [], indices: [], headers: [] };
  }

  // 同じ行で「合計」などを探す
  for (const cell of table.cells) {
    if (cell.rowIndex !== nameRowIndex) continue;
    const content = cell.content?.trim() || "";

    if (content.includes("合計") || content.includes("小計") || content.includes("金額")) {
      totalColumnIndex = cell.columnIndex;
    }
    if (content.includes("施術実施")) {
      shijitsuColumnIndex = cell.columnIndex;
    }
  }

  // もし「合計」が見つからない場合、テーブルの最終列などを目安にするか
  const maxCol = Math.max(...table.cells.map(c => c.columnIndex));
  const searchEndCol = totalColumnIndex !== -1 ? totalColumnIndex : maxCol + 1;

  const targetColumnIndices: number[] = [];
  const columnHeaders: string[] = [];

  // 2. カラム定義の構築 (氏名 -> [メニュー...] -> 施術実施)

  // (A) 氏名列
  targetColumnIndices.push(nameColumnIndex);
  columnHeaders.push("氏名");

  // (B) メニュー列 (氏名 と 合計/右端 の間の列)
  // 単純な行フィルタではなく、列インデックスベースでスキャンする（列の欠落を防ぐため）
  for (let c = nameColumnIndex + 1; c < searchEndCol; c++) {
    if (c === shijitsuColumnIndex) continue;

    // nameRowIndexの周辺（±1行）にあるセルを全て取得（結合ヘッダー対策）
    const candidates = table.cells.filter(
      (cell) =>
        cell.columnIndex === c &&
        Math.abs(cell.rowIndex - nameRowIndex) <= 1 &&
        cell.content?.trim()
    );

    if (candidates.length === 0) continue;

    // 除外ワード: ユーザー要望により「性別」「メニュー/料金」などを除外
    const excludeWords = ["備考", "性別", "メニュー/料金", "メニュー／料金"];

    // 候補の中から除外ワードを含まないものをフィルタリング
    // かつ、nameRowIndexに最も近いものを優先
    const validCandidates = candidates
      .filter(cell => {
        const text = cell.content?.trim() || "";
        return !excludeWords.includes(text);
      })
      .sort((a, b) => Math.abs(a.rowIndex - nameRowIndex) - Math.abs(b.rowIndex - nameRowIndex));

    if (validCandidates.length === 0) continue;

    const bestCell = validCandidates[0];
    const content = bestCell.content?.trim() || "";

    targetColumnIndices.push(c);
    columnHeaders.push(content);
  }

  // (C) 施術実施列
  if (shijitsuColumnIndex !== -1) {
    targetColumnIndices.push(shijitsuColumnIndex);
    columnHeaders.push("施術実施");
  }

  // ログ出力
  console.log(`Detected Columns: Name=${nameColumnIndex}, Total=${totalColumnIndex}, Shijitsu=${shijitsuColumnIndex}`);
  console.log(`Headers:`, columnHeaders);

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

  // 画像読み込みヘルパー
  const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  let baseImage: HTMLImageElement;
  let objectUrlToRevoke: string | null = null;

  try {
    if (rotatedBlob) {
      objectUrlToRevoke = URL.createObjectURL(rotatedBlob);
      baseImage = await loadImage(objectUrlToRevoke);
    } else {
      baseImage = await loadImage(imageUrl);
    }
  } catch (e) {
    console.error("画像読み込みエラー:", e);
    return { displayRows: [], indices: [], headers: [] };
  }

  const MAX_CONCURRENT = 1;
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
      await new Promise((r) => setTimeout(r, 200));
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

        if (debugMode) {
          const debugUrl = URL.createObjectURL(blob);
          console.log(`🛠️ Debug Crop [Row:${cell.rowIndex}, Col:${cell.columnIndex}]: ${debugUrl}`);
        }

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

  if (objectUrlToRevoke) {
    URL.revokeObjectURL(objectUrlToRevoke);
  }

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

  const displayRows = Object.keys(rowMap)
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
      return {
        rowIndex,
        columns,
        results,
        sourceImageIndex: imageIndex,
        sourceImageName: imageName,
        groupId: groupId
      };
    })
    .sort((a, b) => a.rowIndex - b.rowIndex);

  return {
    displayRows,
    indices: targetColumnIndices,
    headers: columnHeaders
  };
}

// --- UI Components ---
function RowView({
  row,
  onToggle,
  onHeaderToggle,
  onHeaderDelete,
  onRowDelete,
  onRowClick,
  isSelected,
  isFirstRow
}: {
  row: DisplayRow;
  onToggle: (rowIndex: number, colIndex: number) => void;
  onHeaderToggle: (colIndex: number) => void;
  onHeaderDelete: (colIndex: number) => void;
  onRowDelete: (rowIndex: number) => void;
  onRowClick: (rowIndex: number) => void;
  isSelected: boolean;
  isFirstRow: boolean;
}) {
  const isHeaderRow = row.results.every((r) => r === null);

  return (
    <div
      style={{
        display: "flex",
        minWidth: "max-content",
        borderBottom: "1px solid #e5e7eb",
        backgroundColor: isHeaderRow ? "#f3f4f6" : isSelected ? "#e5e7eb" : "transparent",
        transition: "background-color 0.2s",
        cursor: !isHeaderRow ? "pointer" : "default",
      }}
      onClick={() => { if (!isHeaderRow) onRowClick(row.rowIndex); }}
    >
      {row.columns.map((c, i) => {
        const result = row.results[i];
        const isName = i === 0;
        const isActionableHeader = isFirstRow && !isName && c !== "施術実施";

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
              borderRight: "1px solid #e5e7eb",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              cursor: isActionableHeader ? "pointer" : "inherit",
              backgroundColor: isActionableHeader ? "#eff6ff" : "inherit",
              position: "relative",
            }}
            onClick={(e) => {
              if (isFirstRow && !isName) {
                e.stopPropagation();
                onHeaderToggle(i);
              } else if (!isHeaderRow && !isName) {
                e.stopPropagation();
                onToggle(row.rowIndex, i);
              }
              // 名前セルの場合は何もせず、イベントを親の行ハンドラーにバブリングさせる
            }}
          >
            {isHeaderRow ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  {c}
                  {c === "施術実施" && (
                    <span style={{ fontSize: "12px", cursor: "pointer", opacity: 0.7 }} title="一括編集">⚙️</span>
                  )}
                </div>
                {isActionableHeader && c !== "施術実施" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onHeaderDelete(i);
                    }}
                    style={{
                      position: "absolute", top: "2px", right: "2px", backgroundColor: "#fee2e2",
                      color: "#ef4444", border: "none", borderRadius: "50%", width: "16px", height: "16px",
                      fontSize: "10px", cursor: "pointer", display: "flex", alignItems: "center",
                      justifyContent: "center", padding: 0
                    }}
                    title="列を削除"
                  >
                    ×
                  </button>
                )}
                {isFirstRow && !isName && (
                  <div style={{ fontSize: "10px", color: "#3b82f6", marginTop: "2px", fontWeight: "normal" }}>[一括切替]</div>
                )}
              </>
            ) : (
              isName ? (
                <div style={{ position: "relative", width: "100%" }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRowDelete(row.rowIndex);
                    }}
                    style={{
                      position: "absolute", left: "-6px", top: "-6px", backgroundColor: "#fecaca",
                      color: "#dc2626", border: "none", borderRadius: "50%", width: "16px", height: "16px",
                      fontSize: "10px", cursor: "pointer", display: "flex", alignItems: "center",
                      justifyContent: "center", padding: 0, zIndex: 10
                    }}
                    title="この人を削除"
                  >
                    ×
                  </button>
                  {c}
                </div>
              ) : (
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
