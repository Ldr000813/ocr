import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import ExcelJS from 'exceljs';

/* ==========================================================
   メニュー選択の判定ロジック（AzureのOCR結果を使用）
   ========================================================== */
async function detectMenuSelection(cellContent: string) {
  // AzureのOCR結果に基づいて、〇があれば 'selected' を返し、それ以外は何も返さない
  if (cellContent.includes('〇')) {
    return "selected";  // 〇が含まれている場合
  }

  return "empty"; // 〇が含まれていない場合は何も表示しない
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
      // 変更: 五つのメニュー列に対して判定を行う
      const cells = mainTable.cells.filter(
        (c: any) => c.columnIndex >= 4 && c.columnIndex <= 8 && c.rowIndex > 0 && c.rowIndex <= maxRow
      );

      for (const cell of cells) {
        const cellContent = cell.content?.trim(); // セルの内容（例えば「〇」）を取得

        const checkType = await detectMenuSelection(cellContent);

        checkResults.push({
          rowIndex: cell.rowIndex,
          columnIndex: cell.columnIndex,
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
      if (r.checkType === "empty") return; // 〇がない場合は何も表示しない
      row.getCell(r.columnIndex + 1).value = r.checkType; // メニュー列に判定結果を追加
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
