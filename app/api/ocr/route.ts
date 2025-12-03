import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

// ======================
// ✓／判定ロジック
// ======================
async function detectCheckMark(imageBuffer: Buffer) {
  // 二値化（白黒化）
  const bw = await sharp(imageBuffer)
    .resize(80, 80, { fit: 'fill' }) // 小さくリサイズして計算を軽くする
    .threshold(150)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = bw;

  let diagonalLines = 0;

  // 斜め方向の黒ピクセル連続性をチェック
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

  // 簡易判定
  if (diagonalLines > 40) return "checked";   // ✓
  if (diagonalLines > 10) return "slash";     // ／
  return "empty";                             // 何もなし
}

// ======================
// メインの OCR 処理
// ======================
export const POST = async (req: NextRequest) => {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const AZURE_ENDPOINT = process.env.AZURE_ENDPOINT!;
    const AZURE_API_KEY = process.env.AZURE_API_KEY!;

    // === 元画像 Buffer の確保 ===
    const arrayBuffer = await file.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);

    let bodyForFetch: Blob;

    // ---- PDF / TIFF / 画像処理 ----
    if (file.type === 'application/pdf' || file.type === 'image/tiff') {
      bodyForFetch = new Blob([arrayBuffer], { type: file.type });
    } else if (file.type.startsWith('image/')) {
      const compressedBuffer = await sharp(originalBuffer)
        .jpeg({ quality: 60 })
        .toBuffer();
      bodyForFetch = new Blob([compressedBuffer], { type: 'image/jpeg' });
    } else {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }

    // ---- Azure Layout API ----
    const analyzeUrl = `${AZURE_ENDPOINT}/formrecognizer/documentModels/prebuilt-document:analyze?api-version=2023-07-31`;

    const analyzeResponse = await fetch(analyzeUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_API_KEY,
        'Content-Type': 'application/octet-stream',
      },
      body: bodyForFetch,
    });

    if (!analyzeResponse.ok) {
      const errorText = await analyzeResponse.text();
      return NextResponse.json({ error: errorText }, { status: analyzeResponse.status });
    }

    const operationLocation = analyzeResponse.headers.get('Operation-Location');
    if (!operationLocation) {
      return NextResponse.json({ error: 'No Operation-Location header' }, { status: 500 });
    }

    // ---- Polling ----
    let resultData: any = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));

      const pollResponse = await fetch(operationLocation, {
        headers: { 'Ocp-Apim-Subscription-Key': AZURE_API_KEY },
      });

      const json = await pollResponse.json();
      if (json.status === 'succeeded') {
        resultData = json;
        break;
      }
      if (json.status === 'failed') {
        return NextResponse.json({ error: 'analysis failed' }, { status: 500 });
      }
    }

    const analyzeResult = resultData?.analyzeResult;
    if (!analyzeResult) {
      return NextResponse.json({ error: 'No analyzeResult returned' }, { status: 500 });
    }

    // ======================
    // チェック欄の判定
    // columnIndex = 14 が施術実施 有無
    // ======================
    const tables = analyzeResult.tables;
    let checkResults: any[] = [];

    if (tables.length > 1) {
      const mainTable = tables[1]; // データ本体が入っている方

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

        const crop = await sharp(originalBuffer)
          .extract({
            left,
            top,
            width: right - left,
            height: bottom - top,
          })
          .toBuffer();

        const checkType = await detectCheckMark(crop);

        checkResults.push({
          rowIndex: cell.rowIndex,
          checkType,
        });
      }
    }

    // ======================
    // 結果返却
    // ======================
    return NextResponse.json({
      tables,
      checkResults, // ← チェック結果をフロントで確認可能
    });

  } catch (error: any) {
    console.error('Server error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
};
