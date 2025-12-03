import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

/* ==========================================================
   ✓／判定ロジック
   ========================================================== */
async function detectCheckMark(imageBuffer: Buffer) {
  // グレースケール → 二値化 → 80x80 に縮小（軽量化）
  const { data, info } = await sharp(imageBuffer)
    .resize(80, 80, { fit: 'fill' })
    .threshold(150)
    .raw()
    .toBuffer({ resolveWithObject: true });

  let diagonalLines = 0;

  // 斜め方向の黒連続ピクセルをカウント
  for (let y = 0; y < info.height - 3; y++) {
    for (let x = 0; x < info.width - 3; x++) {
      const p1 = data[y * info.width + x];
      const p2 = data[(y + 1) * info.width + (x + 1)];
      const p3 = data[(y + 2) * info.width + (x + 2)];

      if (p1 === 0 && p2 === 0 && p3 === 0) {
        diagonalLines++;
      }
    }
  }

  // 超簡易判定（※はみ出し×は今回無視）
  if (diagonalLines > 40) return "checked"; // ✓
  if (diagonalLines > 10) return "slash";   // ／
  return "empty";                           // 空白
}

/* ==========================================================
   メイン OCR（Azure prebuilt-document）
   ========================================================== */
export const POST = async (req: NextRequest) => {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const AZURE_ENDPOINT = process.env.AZURE_ENDPOINT!;
    const AZURE_API_KEY = process.env.AZURE_API_KEY!;

    const arrayBuffer = await file.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);

    let requestBuffer: Buffer;

    // === 拡張子ごとに送信バッファを選択 ===
    if (file.type === "application/pdf" || file.type === "image/tiff") {
      requestBuffer = originalBuffer;
    } else if (file.type.startsWith("image/")) {
      requestBuffer = await sharp(originalBuffer)
        .jpeg({ quality: 60 })
        .toBuffer();
    } else {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }

    /* ==========================================================
       Azure API 呼び出し（Buffer → Uint8Array に変換して送信）
       ========================================================== */
    const analyzeUrl = `${AZURE_ENDPOINT}/formrecognizer/documentModels/prebuilt-document:analyze?api-version=2023-07-31`;

    const analyzeResponse = await fetch(analyzeUrl, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": AZURE_API_KEY,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(requestBuffer), // ← ★ Next.js で正しく動く
    });

    if (!analyzeResponse.ok) {
      const errorText = await analyzeResponse.text();
      return NextResponse.json({ error: errorText }, { status: analyzeResponse.status });
    }

    /* ==========================================================
       Polling（結果が出るまで最大30秒）
       ========================================================== */
    const operationLocation = analyzeResponse.headers.get("Operation-Location");
    if (!operationLocation) {
      return NextResponse.json({ error: "No Operation-Location header" }, { status: 500 });
    }

    let resultData = null;

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));

      const pollRes = await fetch(operationLocation, {
        headers: { "Ocp-Apim-Subscription-Key": AZURE_API_KEY },
      });

      const json = await pollRes.json();

      if (json.status === "succeeded") {
        resultData = json;
        break;
      }
      if (json.status === "failed") {
        return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
      }
    }

    const analyzeResult = resultData?.analyzeResult;
    if (!analyzeResult) {
      return NextResponse.json({ error: "No analyzeResult returned" }, { status: 500 });
    }

    const tables = analyzeResult.tables ?? [];

    /* ==========================================================
       チェック欄（columnIndex = 14）の ✓／判定
       ========================================================== */
    let checkResults: any[] = [];

    if (tables.length > 1) {
      const mainTable = tables[1];

      // 施術実施 有無（columnIndex=14）
      const checkCells = mainTable.cells.filter(
        (c: any) => c.columnIndex === 14 && c.rowIndex > 0
      );

      for (const cell of checkCells) {
        const poly = cell.boundingRegions?.[0]?.polygon;
        if (!poly) continue;

        const xs = [poly[0], poly[2], poly[4], poly[6]];
        const ys = [poly[1], poly[3], poly[5], poly[7]];

        const left = Math.min(...xs);
        const right = Math.max(...xs);
        const top = Math.min(...ys);
        const bottom = Math.max(...ys);

        // polygon の領域を切り出す
        const cropped = await sharp(originalBuffer)
          .extract({
            left,
            top,
            width: right - left,
            height: bottom - top,
          })
          .toBuffer();

        // ✓／判定
        const checkType = await detectCheckMark(cropped);

        checkResults.push({
          rowIndex: cell.rowIndex,
          checkType,
        });
      }
    }

    /* ==========================================================
       フロントへ返却
       ========================================================== */
    return NextResponse.json({
      tables,
      checkResults, // ← フロントで表示して確認可能
    });

  } catch (err: any) {
    console.error("Server Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
};
