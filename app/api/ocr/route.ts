import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import ExcelJS from 'exceljs';

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

    // ポーリング処理（最大30回まで試行）
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

    const selectionMarks = analyzeResult.selectionMarks ?? []; // チェックボックスや選択マークのデータ
    const boundingBoxes: any[] = []; // すべての長方形領域をリストに追加

    /* ==========================================================
       selectionMarks のすべての長方形領域をリストに追加
       ========================================================== */
    selectionMarks.forEach((mark: any) => {
      boundingBoxes.push({
        rowIndex: mark.rowIndex,
        columnIndex: mark.columnIndex,
        boundingBox: mark.boundingBox, // 選択マークの領域情報（長方形）
      });
    });

    // 長方形領域リストをログに出力
    console.log("選択マークの長方形領域リスト:", boundingBoxes);

    /* ==========================================================
       結果をExcelに書き込む
       ========================================================== */
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("OCR結果");

    // 1行目にヘッダーを書き込む
    sheet.addRow(["No.", "部屋番号", "氏名", "メニュー/料金", "合計料金", "施術開始時間の希望", "施術実施 有無", "追加メニュー 可否", "オーダーメイド", "備考", "選択マークの領域"]);

    // Excelに選択マークの情報を追加
    boundingBoxes.forEach((box, index) => {
      const row = sheet.getRow(index + 2);
      row.getCell(11).value = `Row: ${box.rowIndex}, Column: ${box.columnIndex}, BoundingBox: ${JSON.stringify(box.boundingBox)}`;
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
    console.error("Server Error", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
};
