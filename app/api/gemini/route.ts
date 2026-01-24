import { GoogleGenerativeAI, SchemaType, Schema } from "@google/generative-ai";
import { NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// 'as const' を追加するか、型を明示的に指定します
const schema: Schema = {
  description: "Extract facility and date information",
  type: SchemaType.OBJECT,
  properties: {
    facilityName: { 
      type: SchemaType.STRING, 
      description: "施設名 (e.g. ココファン大分横尾)" 
    },
    year: { 
      type: SchemaType.STRING, 
      description: "年 (e.g. 2026)" 
    },
    month: { 
      type: SchemaType.STRING, 
      description: "月 (e.g. 10)" 
    },
    day: { 
      type: SchemaType.STRING, 
      description: "日 (e.g. 22)" 
    },
    dayOfWeek: { 
      type: SchemaType.STRING, 
      description: "曜日 (e.g. 火)" 
    },
  },
  required: ["facilityName", "year", "month", "day", "dayOfWeek"],
};

export async function POST(req: Request) {
  try {
    const { text } = await req.json();

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });

    const prompt = `
      以下のテキストから「施設名」「年」「月」「日」「曜日」を抽出し、JSON形式で回答してください。

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

    const result = await model.generateContent(prompt);
    return NextResponse.json(JSON.parse(result.response.text()));
  } catch (error) {
    console.error("Gemini Error:", error);
    return NextResponse.json({ error: "解析に失敗しました" }, { status: 500 });
  }
}