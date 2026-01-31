import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { text } = await req.json();

    const apiKey = process.env.GEMINI_API_KEY || "";
    const modelName = process.env.GEMINI_MODEL_NAME || "gemini-2.5-flash";
    
    // エンドポイントが設定されていない場合は、デフォルトのGoogle Gemini APIエンドポイントを使用（v1betaを使用）
    const endpoint = process.env.GEMINI_ENDPOINT || `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

    if (!apiKey) {
      return NextResponse.json({ error: "APIキーが設定されていません" }, { status: 500 });
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12

    const prompt = `
      以下のテキストから「施設名」「年」「月」「日」「曜日」を抽出し、以下のJSON形式で回答してください。JSON以外の文字は含めないでください。

      {
        "facilityName": "施設名",
        "year": "年",
        "month": "月",
        "day": "日",
        "dayOfWeek": "曜日"
      }

      【日付・曜日特定に関する厳格なルール】
      1. 年の判定:
         - テキストに年の記載がない場合、現在は ${currentYear}年${currentMonth}月 です。
         - テキストの月が ${currentMonth} より大きい場合は ${currentYear - 1}年、それ以外は ${currentYear}年 としてください。
      2. 曜日の判定（重要）:
         - テキストに曜日の記載（例：「（水）」や「火曜日」）があれば、その漢字1文字を抽出してください。
         - テキストに曜日の記載がない場合、または「不明」となる場合は、必ず特定した「年・月・日」からカレンダー上の正しい曜日を計算して回答してください。
         - 回答は必ず「月」「火」「水」「木」「金」「土」「日」のいずれか1文字にしてください。

      テキスト:
      ${text}
    `;

    // エンドポイントが設定されている場合はそのまま使用、なければモデル名から構築
    let requestUrl = endpoint;
    if (!process.env.GEMINI_ENDPOINT && !endpoint.includes(modelName)) {
      // エンドポイントが設定されていない場合、モデル名から構築（v1betaを使用）
      requestUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
    } else if (process.env.GEMINI_ENDPOINT && !endpoint.includes(modelName) && endpoint.includes(":generateContent")) {
      // エンドポイントが設定されているがモデル名が含まれていない場合、モデル名を挿入
      requestUrl = endpoint.replace(/\/models\/[^:]+/, `/models/${modelName}`);
    }

    console.log(`API呼び出し: ${requestUrl}, モデル: ${modelName}`);

    // リクエストボディを構築（APIプロバイダーに応じて形式を変更可能）
    const requestBody: any = {
      contents: [{
        parts: [{
          text: prompt
        }]
      }]
    };

    // v1betaエンドポイントの場合はresponseMimeTypeとresponseSchemaを使用
    if (requestUrl.includes("/v1beta/")) {
      requestBody.generationConfig = {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            facilityName: { type: "string", description: "施設名 (e.g. ココファン大分横尾)" },
            year: { type: "string", description: "年 (e.g. 2026)" },
            month: { type: "string", description: "月 (e.g. 10)" },
            day: { type: "string", description: "日 (e.g. 22)" },
            dayOfWeek: { type: "string", description: "曜日 (e.g. 火)" },
          },
          required: ["facilityName", "year", "month", "day", "dayOfWeek"],
        },
      };
    } else {
      // v1エンドポイントやその他のAPIの場合は、プロンプトでJSON形式を指定
      requestBody.generationConfig = {
        temperature: 0.1,
      };
    }

    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API Error:", response.status, errorText);
      return NextResponse.json({ error: `API呼び出しに失敗しました: ${response.status}` }, { status: response.status });
    }

    const result = await response.json();
    
    // レスポンスの形式に応じてデータを抽出
    let extractedData;
    if (result.candidates && result.candidates[0] && result.candidates[0].content) {
      const content = result.candidates[0].content.parts[0].text;
      extractedData = JSON.parse(content);
    } else if (result.text) {
      extractedData = JSON.parse(result.text);
    } else {
      extractedData = result;
    }

    return NextResponse.json(extractedData);
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json({ error: "解析に失敗しました", details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}