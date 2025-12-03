import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import * as XLSX from 'xlsx';

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
    let bodyForFetch: Blob;

    // ---- PDF / TIFF / 画像処理 ----
    if (file.type === 'application/pdf' || file.type === 'image/tiff') {
      bodyForFetch = new Blob([arrayBuffer], { type: file.type });
    } else if (file.type.startsWith('image/')) {
      const buffer = Buffer.from(arrayBuffer);
      const compressedBuffer = await sharp(buffer)
        .jpeg({ quality: 60 })
        .toBuffer();
      bodyForFetch = new Blob([new Uint8Array(compressedBuffer)], { type: 'image/jpeg' });
    } else {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }

    // ⭐ ---- Azure Document Model（構造化データ）----
    const analyzeUrl =
      `${AZURE_ENDPOINT}/formrecognizer/documentModels/prebuilt-document:analyze?api-version=2023-07-31`;

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
        return NextResponse.json({ error: 'Layout analysis failed' }, { status: 500 });
      }
    }

    const analyzeResult = resultData?.analyzeResult;
    if (!analyzeResult) {
      return NextResponse.json({ error: 'No analyzeResult returned' }, { status: 500 });
    }

    // ⭐ ---- tables を Excel に変換 ----
    const tables = analyzeResult.tables || [];

    const wb = XLSX.utils.book_new();

    tables.forEach((table: any, idx: number) => {
      const rows: any[] = [];
      const maxCols = table.columnCount;

      for (let r = 0; r < table.rowCount; r++) {
        rows[r] = Array(maxCols).fill('');
      }

      table.cells.forEach((cell: any) => {
        rows[cell.rowIndex][cell.columnIndex] = cell.content;
      });

      const ws = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, `Table_${idx + 1}`);
    });

    // Excel を Base64 に変換
    const excelBase64 = XLSX.write(wb, {
      type: 'base64',
      bookType: 'xlsx',
    });

    return NextResponse.json({
      excel: excelBase64,     // ← Excelファイル Base64
      tables: tables,         // ← デバッグ用
    });

  } catch (error: any) {
    console.error('Server error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
};
