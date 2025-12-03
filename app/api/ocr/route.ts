import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import ExcelJS from 'exceljs';

/* ==========================================================
   ✓／判定ロジック（方向＋密度で判定する改良版）
   ========================================================== */
async function detectCheckMark(imageBuffer: Buffer) {
  const TARGET_SIZE = 64;

  const { data, info } = await sharp(imageBuffer)
    .resize(TARGET_SIZE, TARGET_SIZE, { fit: 'fill' })
    .greyscale()
    .threshold(180)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;

  // 黒ピクセルのカウント
  const isBlack = new Uint8Array(width * height);
  let blackCount = 0;

  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0) {
      isBlack[i] = 1;
      blackCount++;
    }
  }

  const blackRatio = blackCount / (width * height);
  if (blackRatio < 0.01) return "empty";

  // 斜め方向のスコアリング
  const mx = Math.floor(width * 0.1);
  const my = Math.floor(height * 0.1);

  let slashScore = 0;      // ／方向
  let backslashScore = 0;  // ＼方向（✓の主成分）

  for (let y = my; y < height - my - 1; y++) {
    for (let x = mx; x < width - mx - 1; x++) {
      const idx = y * width + x;
      if (!isBlack[idx]) continue;

      // ／方向
      if (y > my) {
        const idx2 = (y - 1) * width + (x + 1);
        if (isBlack[idx2]) slashScore++;
      }

      // ＼方向
      if (y < height - my - 1) {
        const idx3 = (y + 1) * width + (x + 1);
        if (isBlack[idx3]) backslashScore++;
      }
    }
  }

  // 判定基準を強化
  if (slashScore + backslashScore < 5) return "empty";
  if (slashScore > backslashScore * 1.5) return "slash"; // ／
  if (backslashScore > slashScore * 1.5) return "checked"; // ✓
  
  // 両方向が弱ければチェックありとして判定
  if (backslashScore > slashScore * 1.2) return "checked";

  return "empty";
}

/* ==========================================================
   メイン OCR（Azure）
   ========================================================== */
export const POST = async (req: NextRequest) => {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const AZURE_ENDPOINT = process.env.AZURE_ENDPOINT!;
    const AZURE_API_KEY = process.env.AZURE_API_KEY!;

    const arrayBuffer = await file.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);

    let requestBuffer: Buffer = originalBuffer;

    if (file.type.startsWith("image/")) {
      requestBuffer = await sharp(originalBuffer).jpeg({ quality: 70 }).toBuffer();
    }

    const analyzeUrl =
      `${AZURE_ENDPOINT}/formrecognizer/documentModels/prebuilt-document:analyze?api-version=2023-07-31`;

    const analyzeRes = await fetch(analyzeUrl, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": AZURE_API_KEY,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(requestBuffer),
    });

    if (!analyzeRes.ok) {
      return NextResponse.json({ error: await analyzeRes.text() }, { status: analyzeRes.status });
    }

    const op = analyzeRes.headers.get("Operation-Location");
    if (!op) return NextResponse.json({ error: "No Operation-Location" });

    let resultData: any = null;

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));

      const poll = await fetch(op, {
        headers: { "Ocp-Apim-Subscription-Key": AZURE_API_KEY },
      });

      const json = await poll.json();
      if (json.status === "succeeded") {
        resultData = json;
        break;
      }
    }

    const analyzeResult = resultData?.analyzeResult;
    if (!analyzeResult) return NextResponse.json({ error: "No analyzeResult" });

    const tables = analyzeResult.tables ?? [];
    const mainTable = tables[1];

    /* ==========================================================
       行数の不一致問題（最大行数の自動推定）
       ========================================================== */
    const validRows = mainTable.cells
      .filter((c: any) => c.columnIndex === 3 && c.content?.trim().length > 0)
      .map((c: any) => c.rowIndex);

    const maxRow = Math.max(...validRows);

    const checkResults: any[] = [];

    if (mainTable) {
      const cells = mainTable.cells.filter(
        (c: any) => c.columnIndex === 14 && c.rowIndex > 0 && c.rowIndex <= maxRow
      );

      for (const cell of cells) {
        const poly = cell.boundingRegions?.[0]?.polygon;
        if (!poly) continue;

        const xs = [poly[0], poly[2], poly[4], poly[6]];
        const ys = [poly[1], poly[3], poly[5], poly[7]];
        const left = Math.min(...xs);
        const right = Math.max(...xs);
        const top = Math.min(...ys);
        const bottom = Math.max(...ys);

        const w = right - left;
        const h = bottom - top;

        const marginX = Math.floor(w * 0.05);
        const marginY = Math.floor(h * 0.05);

        const cropLeft = left + marginX;
        const cropTop = top + marginY;
        const cropWidth = Math.max(1, w - marginX * 2);
        const cropHeight = Math.max(1, h - marginY * 2);

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
       Excel 作成
       ========================================================== */
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("OCR結果");

    // 1行目にヘッダーを書き込む
    sheet.addRow(["No.", "部屋番号", "氏名", "メニュー/料金", "合計料金", "施術開始時間の希望", "施術実施 有無", "追加メニュー 可否", "オーダーメイド", "備考", "チェック結果"]);

    // OCR結果のすべての行と列を出力
    mainTable.cells.forEach((cell: any) => {
      const row = sheet.getRow(cell.rowIndex + 2); // Excelの行番号は1から始まるため、1行目はヘッダー
      row.getCell(cell.columnIndex + 1).value = cell.content; // セルの内容を設定
    });

    // チェック欄の判定結果を追加
    checkResults.forEach((r) => {
      const row = sheet.getRow(r.rowIndex + 2); // Excelの行番号は1から始まるため、2行目からデータ
      row.getCell(11).value = r.checkType; // チェック結果列に判定結果を追加
    });

    const excelBuffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(excelBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="ocr_result.xlsx"`,
      },
    });
  } catch (err: any) {
    console.error("Server Error", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
};
