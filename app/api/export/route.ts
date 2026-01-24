import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";

export async function POST(req: Request) {
  try {
    const payload: {
      counts: Record<string, number>;
      facility?: string;
      reiwaYear?: string;
      month?: string;
      day?: string;
      weekday?: string;
    } = await req.json();

    const { counts, facility, reiwaYear, month, day, weekday } = payload;

    // Excel テンプレート読み込み
    const templatePath = path.join(process.cwd(), "public", "templates", "order.xlsx");
    if (!fs.existsSync(templatePath)) {
      return NextResponse.json(
        { error: "テンプレートファイルが存在しません" },
        { status: 500 }
      );
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const sheet = workbook.worksheets[0];

    // --- K4に実行時点の令和日付を挿入 ---
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();
    const currentReiwa = currentYear - 2018;
    sheet.getCell("K4").value = `令和${currentReiwa}年${currentMonth}月${currentDay}日`;

    // --- 追加: M23にメニュー別カウントの文字列を挿入 ---
    // 指定された形式 "カット: 4, カラー: 0, パーマ: 0, 顔そり: 3, シャンプー: 0" を作成
    // payloadに「ヘアーマニキュア」が含まれていても、指示された項目のみを抽出して作成します
    const menuSummary = [
      `カット: ${counts["カット"] ?? 0}`,
      `カラー: ${counts["カラー"] ?? 0}`,
      `パーマ: ${counts["パーマ"] ?? 0}`,
      `顔そり: ${counts["顔そり"] ?? 0}`,
      `シャンプー: ${counts["シャンプー"] ?? 0}`
    ].join(", ");
    
    sheet.getCell("M23").value = menuSummary;
    // ----------------------------------------------

    // 施設名 → B11
    if (facility) sheet.getCell("B11").value = facility;

    // 請求書タイトル → B8
    if (reiwaYear && month) {
      sheet.getCell("B8").value = `御請求書（${reiwaYear} ${month}月度）`;
    }

    // 月 → B23, 日 → C23, 曜日 → D23
    if (month) sheet.getCell("B23").value = month;
    if (day) sheet.getCell("C23").value = day;
    if (weekday) sheet.getCell("D23").value = weekday;

    // メニュー別個別セルへの入力 (既存)
    const MENU_CELL_MAP: Record<string, string> = {
      カット: "E25",
      カラー: "F25",
      パーマ: "G25",
      ヘアーマニキュア: "H25",
      顔そり: "I25",
      シャンプー: "J25",
    };

    for (const [menu, cellAddress] of Object.entries(MENU_CELL_MAP)) {
      sheet.getCell(cellAddress).value = counts[menu] ?? 0;
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const today = now.toISOString().slice(0, 10);
    const fileName = `order_${today}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          fileName
        )}`,
      },
    });
  } catch (err: any) {
    console.error("Excel export failed:", err);
    return NextResponse.json(
      { error: "Excel export failed", details: err.message },
      { status: 500 }
    );
  }
}