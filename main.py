import os
import json
from datetime import datetime

from azure.ai.documentintelligence import DocumentIntelligenceClient
from azure.core.credentials import AzureKeyCredential


# ==============================
# 環境変数取得
# ==============================
ENDPOINT = os.getenv("DOCUMENT_INTELLIGENCE_ENDPOINT")
KEY = os.getenv("DOCUMENT_INTELLIGENCE_KEY")

if not ENDPOINT or not KEY:
    raise RuntimeError(
        "環境変数 DOCUMENT_INTELLIGENCE_ENDPOINT または DOCUMENT_INTELLIGENCE_KEY が設定されていません。"
    )


# ==============================
# クライアント生成
# ==============================
client = DocumentIntelligenceClient(
    endpoint=ENDPOINT,
    credential=AzureKeyCredential(KEY),
)


# ==============================
# 入力ファイル設定
# ==============================
INPUT_FILE_PATH = "sample.jpg"   # 解析したい PDF や画像ファイル
if not os.path.exists(INPUT_FILE_PATH):
    raise FileNotFoundError(f"入力ファイルが存在しません: {INPUT_FILE_PATH}")


# ==============================
# ログ出力設定
# ==============================
LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)

timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
LOG_FILE_PATH = os.path.join(LOG_DIR, f"analyze_result_{timestamp}.json")


# ==============================
# 解析実行
# ==============================
with open(INPUT_FILE_PATH, "rb") as f:
    poller = client.begin_analyze_document(
        model_id="prebuilt-layout",
        body=f,
    )

result = poller.result()


# ==============================
# 結果整理
# ==============================
result_dict = {
    "content": result.content,
    "pages": [],
}

for page in result.pages:
    page_data = {
        "page_number": page.page_number,
        "width": page.width,
        "height": page.height,
        "unit": page.unit,
        "lines": [],
    }

    if page.lines:
        for line in page.lines:
            page_data["lines"].append(
                {
                    "content": line.content,
                    "bounding_polygon": [
                        {"x": p.x, "y": p.y} for p in line.polygon
                    ],
                }
            )

    result_dict["pages"].append(page_data)


# ==============================
# ローカルログ出力
# ==============================
with open(LOG_FILE_PATH, "w", encoding="utf-8") as log_file:
    json.dump(result_dict, log_file, ensure_ascii=False, indent=2)


print(f"解析完了。ログ出力先: {LOG_FILE_PATH}")
