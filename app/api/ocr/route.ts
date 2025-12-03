import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import ExcelJS from 'exceljs';

/* ==========================================================
   ✓／判定ロジック
   ========================================================== */
async function detectCheckMark(imageBuffer: Buffer) {
  const { data, info } = await sharp(imageBuffer)
    .resize(80, 80, { fit: 'fill' })
    .threshold(150)
    .raw()
    .toBuffer({ resolveWithObject: true });

  let diagonalLines = 0;

  for (let y = 0; y < info.height - 3; y++) {
    for (let x = 0; x < info.width - 3; x++) {
      const p1 = data[y * info.width + x];
      const p2 = data[(y + 1) * info.width + (x + 1)];
      const p3 = data[(y + 2) * info.width + (x + 2)];

      if (p1 === 0 && p2 === 0 && p3 === 0) diagonalLines++;
    }
  }

  if (diagonalLines > 40) return "checked";
  if (diagonalLines > 10) return "slash";
  return "empty";
}

/* ==========================================================
   メイン OCR（Azure prebuilt-document）
   ========================================================== */
export const POST = async (req: NextRequest) => {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    const AZURE_ENDPOINT = process.env.AZURE_ENDPOINT!;
    const AZURE_API_KEY = process.env.AZURE_API_KEY!;

    const arrayBuffer = await file.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);

    let requestBuffer: Buffer;
    if (file.type === "application/pdf" || file.type === "image/tiff") {
      requestBuffer = originalBuffer;
    } else if (file.type.startsWith("image/")) {
      requestBuffer = await sharp(originalBuffer)
        .jpeg({ quality: 60 })
        .toBuffer();
    } else {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }

    const analyzeUrl =
      `${AZURE_ENDPOINT}/formrecognizer/documentModels/prebuilt-document:analyze?api-version=2023-07-31`;

    const analyzeResponse = await fetch(analyzeUrl, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": AZURE_API_KEY,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(requestBuffer),
    });

    if (!analyzeResponse.ok) {
      return NextResponse.json({ error: await analyzeResponse.text() }, { status: analyzeResponse.status });
    }

    const operationLocation = analyzeResponse.headers.get("Operation-Location");
    if (!operationLocation) {
      return NextResponse.json({ error: "No Operation-Location returned" });
    }

    let resultData = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));

      const poll = await fetch(operationLocation, {
        headers: { "Ocp-Apim-Subscription-Key": AZURE_API_KEY }
      });

      const json = await poll.json();

      if (json.status === "succeeded") {
        resultData = json;
        break;
      }
      if (json.status === "failed") {
        return NextResponse.json({ error: "Analysis failed" });
      }
    }

    const analyzeResult = resultData?.analyzeResult;
    if (!analyzeResult) {
      return NextResponse.json({ error: "No analyzeResult in response" });
    }

    const tables = analyzeResult.tables ?? [];
    const mainTable = tables[1];

    /* ==========================================================
       チェック欄（columnIndex = 14）の ✓／判定
       ========================================================== */
    const checkResults: any[] = [];
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

      const cropped = await sharp(originalBuffer)
        .extract({
          left,
          top,
          width: right - left,
          height: bottom - top,
        })
        .toBuffer();

      const checkType = await detectCheckMark(cropped);

      checkResults.push({
        rowIndex: cell.rowIndex,
        checkType,
      });
    }

    /* ==========================================================
       Excel を生成
       ========================================================== */
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("OCR結果");

    sheet.addRow(["行", "施術実施", "判定"]);
    checkResults.forEach(r => {
      sheet.addRow([
        r.rowIndex,
        r.checkType === "checked" ? "✓" : (r.checkType === "slash" ? "/" : ""),
        r.checkType
      ]);
    });

    const excelBuffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(excelBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="ocr_result.xlsx"`,
      },
    });

  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message });
  }
};
