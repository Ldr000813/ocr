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

    // ログ出力：Azureからのレスポンス構造確認
    console.log("Azure Analyze Result Keys:", Object.keys(analyzeResult));
    if (analyzeResult.pages) {
      console.log("Number of pages:", analyzeResult.pages.length);
      analyzeResult.pages.forEach((p: any, i: number) => {
        console.log(`Page ${i} selectionMarks count:`, p.selectionMarks?.length);
      });
    }

    let selectionMarks = analyzeResult.selectionMarks;

    // トップレベルにない場合、pagesの中から探す
    if (!selectionMarks || selectionMarks.length === 0) {
      if (analyzeResult.pages) {
        selectionMarks = analyzeResult.pages.flatMap((p: any) => p.selectionMarks || []);
      }
    }

    selectionMarks = selectionMarks ?? []; // 最終的に配列にする
    const boundingBoxes: any[] = []; // すべての長方形領域をリストに追加

    /* ==========================================================
       selectionMarks のすべての長方形領域をリストに追加
       ========================================================== */
    selectionMarks.forEach((mark: any) => {
      // state: "selected" | "unselected"
      // チェックされているものだけ抽出したい場合はここでフィルタリングできますが、
      // 今回は「チェックボックス領域」すべてを描画するため全件取得します。
      boundingBoxes.push({
        rowIndex: mark.rowIndex, // ※ Layoutモデルの場合 rowIndex/columnIndex は存在しない場合があります
        columnIndex: mark.columnIndex,
        boundingBox: mark.polygon || mark.boundingBox, // 選択マークの領域情報（polygonが一般的）
        state: mark.state // 参考：selected or unselected
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

    // レスポンスとしてExcelファイルのデータを返すだけでなく、boundingBoxesのデータもJSONとして返す
    return NextResponse.json({
      boundingBoxes,
      excelBuffer,
    }, {
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
