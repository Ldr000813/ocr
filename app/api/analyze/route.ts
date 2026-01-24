import { NextResponse } from "next/server"

const endpoint = process.env.AZURE_DI_ENDPOINT!
const apiKey = process.env.AZURE_DI_KEY!

export async function POST(req: Request) {
  const formData = await req.formData()
  const file = formData.get("file") as File

  if (!file) {
    return NextResponse.json(
      { error: "file not found" },
      { status: 400 }
    )
  }

  const arrayBuffer = await file.arrayBuffer()

  // ① Analyze リクエスト送信
  const analyzeRes = await fetch(
    `${endpoint}/formrecognizer/documentModels/prebuilt-layout:analyze?api-version=2023-07-31`,
    {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        "Ocp-Apim-Subscription-Key": apiKey,
      },
      body: arrayBuffer,
    }
  )

  if (!analyzeRes.ok) {
    const text = await analyzeRes.text()
    return NextResponse.json(
      { error: text },
      { status: 500 }
    )
  }

  // ② Operation-Location 取得
  const operationLocation = analyzeRes.headers.get("operation-location")
  if (!operationLocation) {
    return NextResponse.json(
      { error: "operation-location not found" },
      { status: 500 }
    )
  }

  // ③ 結果ポーリング
  let result
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1000))

    const pollRes = await fetch(operationLocation, {
      headers: {
        "Ocp-Apim-Subscription-Key": apiKey,
      },
    })

    const json = await pollRes.json()

    if (json.status === "succeeded") {
      result = json
      break
    }

    if (json.status === "failed") {
      return NextResponse.json(
        { error: "analysis failed" },
        { status: 500 }
      )
    }
  }

  return NextResponse.json(result)
}
