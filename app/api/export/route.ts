import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";

export async function POST(req: Request) {
  try {
    const payload: {
      counts: Record<string, number>;
      unitPrices?: Record<string, number>;
      facility?: string;
      reiwaYear?: string;
      month?: string;
      day?: string;
      weekday?: string;
    } = await req.json();

    console.log("📊 Excel export - Received payload:", JSON.stringify(payload, null, 2));

    const { counts, unitPrices = {}, facility, reiwaYear, month, day, weekday } = payload;

    const templatePath = path.join(process.cwd(), "public", "templates", "order.xlsx");
    if (!fs.existsSync(templatePath)) {
      return NextResponse.json({ error: "テンプレートファイルが存在しません" }, { status: 500 });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(templatePath);
    const sheet = workbook.worksheets[0];

    // (1) K4: 現在の日付 (令和〇年〇月〇日)
    const now = new Date();
    const currentReiwa = now.getFullYear() - 2018;
    sheet.getCell("K4").value = `令和${currentReiwa}年${now.getMonth() + 1}月${now.getDate()}日`;

    // (2) B8: 御請求書(令和〇年〇月度)
    // フロントから渡された reiwaYear は "令和X年" なので、数字だけ抽出するか、そのまま使うか調整
    // ここでは単純に文字列結合します
    if (reiwaYear && month) {
      // reiwaYearが "令和7年" などの形式の場合
      sheet.getCell("B8").value = `御請求書(${reiwaYear}${month}月度)`;
    }

    // (3) B11: 施設名
    if (facility) {
      sheet.getCell("B11").value = facility;
    }

    // (4) B23, C23, D23: 月, 日, 曜日
    if (month) sheet.getCell("B23").value = month;
    if (day) sheet.getCell("C23").value = day;
    if (weekday) sheet.getCell("D23").value = weekday;

    // (5) メニュー配置
    // E20-J20: メニュー名
    // E22-J22: 単価
    // E23-J23: そのメニューの合計金額 (単価 × 人数)

    const activeMenus = Object.entries(counts).filter(([name, count]) => {
      const price = unitPrices[name] ?? 0;
      return count > 0 && price > 0;
    });
    let totalAmount = 0;
    const summaryList: string[] = [];

    // 列のマッピング (E, F, G, H, I, J) -> インデックス (5, 6, 7, 8, 9, 10) ※1-based
    const COL_E = 5;

    for (let i = 0; i < activeMenus.length; i++) {
      const [menuName, count] = activeMenus[i];
      const price = unitPrices[menuName] ?? 0;
      const subTotal = price * count;
      totalAmount += subTotal;

      // リスト用文字列作成 (7)用
      // 料金が0円の場合はリストに出力しない
      if (price > 0) {
        summaryList.push(`${menuName}:${count}人`);
      }

      // グリッド配置
      // 基本ブロック: Name=20, Unit=22, Total=23
      // 2段目ブロック: Name=27, Unit=29, Total=30 (推定: +7オフセット)
      let nameRow, unitRow, totalRow, startCol;

      if (i < 6) {
        // 1段目
        nameRow = 20;
        unitRow = 22;
        totalRow = 23;
        startCol = COL_E + i;
      } else if (i < 12) {
        // 2段目
        nameRow = 27;
        unitRow = 29;
        totalRow = 30;
        startCol = COL_E + (i - 6);
      } else {
        console.warn("メニュー数が12を超えています。Excelに入りきりません:", menuName);
        continue;
      }

      // 1. メニュー名
      const nameCell = sheet.getCell(nameRow, startCol);
      nameCell.value = menuName;
      nameCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

      // 2. 単価 (円マーク付き)
      const unitCell = sheet.getCell(unitRow, startCol);
      unitCell.value = price;
      unitCell.numFmt = '"￥"#,##0';
      unitCell.alignment = { horizontal: 'center', vertical: 'middle' };

      // 3. 合計金額 (単価 × 人数)
      const totalCell = sheet.getCell(totalRow, startCol);
      totalCell.value = subTotal;
      totalCell.numFmt = '"￥"#,##0';
      totalCell.alignment = { horizontal: 'center', vertical: 'middle' };
    }


    // (6) 合計金額: K33とD16
    const totalCellK33 = sheet.getCell("K33");
    totalCellK33.value = totalAmount;
    totalCellK33.numFmt = '"￥"#,##0';

    const totalCellD16 = sheet.getCell("D16");
    totalCellD16.value = totalAmount;
    totalCellD16.numFmt = '"￥"#,##0';


    // (7) 集計情報リスト: M23 (縦に並べる)
    // "カット:10人\nカラー:7人"
    const summaryText = summaryList.join("\n");
    const summaryCell = sheet.getCell("M23");
    summaryCell.value = summaryText;
    summaryCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="order.xlsx"`,
      },
    });
  } catch (err: any) {
    console.error("Export error:", err);
    return NextResponse.json({ error: "Excel export failed", details: err.message }, { status: 500 });
  }
}