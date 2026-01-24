使用技術:
Azure AI Document Intelligence/layoutモデル
Custom Vision:分類モデル
流れ:Azure AI Document Intelligenceで画像全体に対して識別を行ってから、記号のところだけ部分画像として切り取って、Custom Visionで分類する

全体方針:
* 投稿された画像から「氏名」「カット」「カラー」「パーマ」「ヘアーマニキュア」「顔そり」「シャンプー」「施術実施」列を動的に取得>>出力:ヘッダー(string[])とヘッダー列index(number[])
* "氏名"セルの行indexと列indexを特定する
* すべての氏名セルの行indexをまとめる>>出力:氏名行index(number[])
* ヘッダー列indexと氏名行indexに基づき、記号の部分画像を切り取る>>出力:filteredCellsGroupedByRow(result=null)
* 部分画像をCustom Visionで識別>>出力:filteredCellsGroupedByRow(resutl=分類識別結果)
* UI構築・表示

現状:
* できているところ:
(1)ヘッダー(「氏名」「カット」「カラー」...)の動的取得
(2)部分画像の切り取り
(3)Custom Vision識別結果のUI表示

* 未完成:
(1)編集可能なUI
(2)確定ボタンとダウンロード機能
(3)複数枚の画像対応できるようにする
(4)UIをクリックすると、色が変わる(今どの行を見ているのかを特定しやすいように)
(5)処理速度が遅い

* 重大な問題点
const displayRows = await buildDisplayRows(tables[0], imageUrl);
ここではtables[0]と指定しているが、tables[1]にしないと動作しないことも普通にある
理由:画像内に複数のtableが検出されることがあるため
