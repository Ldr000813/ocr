import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

/* ==========================================================
   ✓／判定ロジック（方向＋密度で判定する改良版）
   ========================================================== */
async function detectCheckMark(imageBuffer: Buffer) {
  const TARGET_SIZE = 64;

  // 1. グレースケール → 2値化 → 小さめにリサイズ
  const { data, info } = await sharp(imageBuffer)
    .resize(TARGET_SIZE, TARGET_SIZE, { fit: 'fill' })
    .greyscale()
    .threshold(180)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;

  // 2. 黒ピクセルマップと黒ピクセル総数
  const isBlack = new Uint8Array(width * height);
  let blackCount = 0;

  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0) {
      isBlack[i] = 1;
      blackCount++;
    }
  }

  const area = width * height;
  const blackRatio = blackCount / area;

  // 黒がほとんど無い → empty 判定
  if (blackRatio < 0.01) {
    return 'empty';
  }

  // 3. 枠線・ノイズの影響を減らすため「中心 80%」だけを見る
  const marginX = Math.floor(width * 0.1);
  const marginY = Math.floor(height * 0.1);

  let slashScore = 0;      // ／ 方向（左下→右上）のスコア
  let backslashScore = 0;  // ＼ 方向（左上→右下・✓の一画）スコア

  for (let y = marginY; y < height - marginY - 1; y++) {
    for (let x = marginX; x < width - marginX - 1; x++) {
      const idx = y * width + x;
      if (!isBlack[idx]) continue;

      // ／ 方向： (x, y) と (x+1, y-1)
      if (y > marginY) {
        const idxSlash = (y - 1) * width + (x + 1);
        if (isBlack[idxSlash]) slashScore++;
      }

      // ＼ 方向： (x, y) と (x+1, y+1)
      if (y < height - marginY - 1) {
        const idxBackslash = (y + 1) * width + (x + 1);
        if (isBlack[idxBackslash]) backslashScore++;
      }
    }
  }

  // 黒はあるけど斜め方向の線がほぼ無い → ノイズ扱いで empty
  if (slashScore + backslashScore < 5) {
    return 'empty';
  }

  // 4. 方向比率で「／」か「✓」かをざっくり判定
  //  slash が backslash の 1.5倍以上 → ほぼ「／」
  //  backslash が slash の 1.5倍以上 → ほぼ「✓」
  //  それ以外（両方そこそこ）→ ✓ とみなす（2本線を想定）
  if (slashScore > backslashScore * 1.5) {
    return 'slash';
  }
  if (backslashScore > slashScore * 1.5) {
    return 'checked';
  }

  // あいまいなケースは「チェックあり」とみなす
  return 'checked';
}

/* ==========================================================
   メイン OCR（Azure prebuilt-document）
   ========================================================== */
export const POST = async (req: NextRequest) => {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const AZURE_ENDPOINT = process.env.AZURE_ENDPOINT!;
    const AZURE_API_KEY = process.env.AZURE_API_KEY!;

    const arrayBuffer = await file.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);

    let requestBuffer: Buffer;

    // === 拡張子ごとに送信バッファを選択 ===
    if (file.type === 'application/pdf' || file.type === 'image/tiff') {
      requestBuffer = originalBuffer;
    } else if (file.type.startsWith('image/')) {
      requestBuffer = await sharp(originalBuffer)
        .jpeg({ quality: 60 })
        .toBuffer();
    } else {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }

    /* ==========================================================
       Azure API 呼び出し（Buffer → Uint8Array に変換して送信）
       ========================================================== */
    const analyzeUrl =
      `${AZURE_ENDPOINT}/formrecognizer/documentModels/prebuilt-document:analyze?api-version=2023-07-31`;

    const analyzeResponse = await fetch(analyzeUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_API_KEY,
        'Content-Type': 'application/octet-stream',
      },
      body: new Uint8Array(requestBuffer),
    });

    if (!analyzeResponse.ok) {
      const errorText = await analyzeResponse.text();
      return NextResponse.json(
        { error: errorText },
        { status: analyzeResponse.status },
      );
    }

    /* ==========================================================
       Polling（結果が出るまで最大30秒）
       ========================================================== */
    const operationLocation = analyzeResponse.headers.get('Operation-Location');
    if (!operationLocation) {
      return NextResponse.json(
        { error: 'No Operation-Location header' },
        { status: 500 },
      );
    }

    let resultData: any = null;

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));

      const pollRes = await fetch(operationLocation, {
        headers: { 'Ocp-Apim-Subscription-Key': AZURE_API_KEY },
      });

      const json = await pollRes.json();

      if (json.status === 'succeeded') {
        resultData = json;
        break;
      }
      if (json.status === 'failed') {
        return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
      }
    }

    const analyzeResult = resultData?.analyzeResult;
    if (!analyzeResult) {
      return NextResponse.json(
        { error: 'No analyzeResult returned' },
        { status: 500 },
      );
    }

    const tables = analyzeResult.tables ?? [];

    /* ==========================================================
       チェック欄（columnIndex = 14）の ✓／判定
       ========================================================== */
    const checkResults: any[] = [];

    if (tables.length > 1) {
      const mainTable = tables[1];

      const checkCells = mainTable.cells.filter(
        (c: any) => c.columnIndex === 14 && c.rowIndex > 0,
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

        // 必要なら「少し内側」だけを見ることで上下のはみ出しの影響を減らす
        const width = right - left;
        const height = bottom - top;
        const innerMarginX = Math.floor(width * 0.05);
        const innerMarginY = Math.floor(height * 0.05);

        const cropLeft = left + innerMarginX;
        const cropTop = top + innerMarginY;
        const cropWidth = Math.max(1, width - innerMarginX * 2);
        const cropHeight = Math.max(1, height - innerMarginY * 2);

        const cropped = await sharp(originalBuffer)
          .extract({
            left: cropLeft,
            top: cropTop,
            width: cropWidth,
            height: cropHeight,
          })
          .toBuffer();

        const checkType = await detectCheckMark(cropped);

        checkResults.push({
          rowIndex: cell.rowIndex,
          checkType,
        });
      }
    }

    /* ==========================================================
       いったん JSON で返す（動作確認用）
       ========================================================== */
    return NextResponse.json({
      tables,
      checkResults,
    });
  } catch (err: any) {
    console.error('Server Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
};
