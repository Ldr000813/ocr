import { NextResponse } from "next/server"

const endpoint = process.env.AZURE_DI_ENDPOINT
const apiKey = process.env.AZURE_DI_KEY

export async function POST(req: Request) {
  try {
    // 環境変数のチェック
    if (!endpoint || !apiKey) {
      console.error("Missing environment variables:", { 
        hasEndpoint: !!endpoint, 
        hasApiKey: !!apiKey 
      })
      return NextResponse.json(
        { error: "サーバー設定が不完全です。環境変数を確認してください。" },
        { status: 500 }
      )
    }

    const formData = await req.formData()
    const file = formData.get("file") as File

    if (!file) {
      return NextResponse.json(
        { error: "ファイルが指定されていません" },
        { status: 400 }
      )
    }

    const arrayBuffer = await file.arrayBuffer()

    // エンドポイントURLの正規化（末尾のスラッシュを削除）
    const normalizedEndpoint = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint

    // ① Analyze リクエスト送信
    // OCR精度を向上させるため、安定版のAPIバージョンを使用
    const analyzeUrl = `${normalizedEndpoint}/formrecognizer/documentModels/prebuilt-layout:analyze?api-version=2023-07-31`
    console.log("Sending analyze request to:", analyzeUrl)

    const analyzeRes = await fetch(analyzeUrl, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "Ocp-Apim-Subscription-Key": apiKey,
      },
      body: arrayBuffer,
    })

    if (!analyzeRes.ok) {
      const errorText = await analyzeRes.text()
      console.error("Analyze request failed:", {
        status: analyzeRes.status,
        statusText: analyzeRes.statusText,
        error: errorText
      })
      return NextResponse.json(
        { 
          error: `Azure Document Intelligence API エラー: ${analyzeRes.status} ${analyzeRes.statusText}`,
          details: errorText 
        },
        { status: analyzeRes.status }
      )
    }

    // ② Operation-Location 取得
    const operationLocation = analyzeRes.headers.get("operation-location")
    if (!operationLocation) {
      console.error("operation-location header not found")
      return NextResponse.json(
        { error: "operation-location ヘッダーが見つかりません" },
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

      if (!pollRes.ok) {
        const errorText = await pollRes.text()
        console.error("Polling request failed:", {
          status: pollRes.status,
          statusText: pollRes.statusText,
          error: errorText
        })
        return NextResponse.json(
          { 
            error: `ポーリングエラー: ${pollRes.status} ${pollRes.statusText}`,
            details: errorText 
          },
          { status: pollRes.status }
        )
      }

      const json = await pollRes.json()

      if (json.status === "succeeded") {
        result = json
        break
      }

      if (json.status === "failed") {
        console.error("Analysis failed:", json)
        return NextResponse.json(
          { 
            error: "解析が失敗しました",
            details: json.error || json 
          },
          { status: 500 }
        )
      }
    }

    if (!result) {
      return NextResponse.json(
        { error: "解析がタイムアウトしました（10回のポーリングで完了しませんでした）" },
        { status: 500 }
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error("Unexpected error in analyze route:", error)
    return NextResponse.json(
      { 
        error: "予期しないエラーが発生しました",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}
