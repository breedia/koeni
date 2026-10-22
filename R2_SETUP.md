# KOESELL R2 移行手順 (v0.8)

## 移行状況
- GitHubコードとSupabaseスキーマはR2との新旧両対応に変更済み。
- 現状のSupabase音声保存オブジェクトは0件。過去データ移行は不要。
- CloudflareでのR2バケット作成・バインディング・秘密情報登録はアカウント保有者が行う必要がある。
- 設定完了まで旧Supabase Storageを使用。決済は無効のまま。

## 1. R2作成
1. https://dash.cloudflare.com/ へログイン。
2. Storage & databases → R2 → Overview へ進む。
3. R2初回利用時は利用開始と必要な支払い設定を確認。無料枠を超過すると従量課金。
4. Create bucket から「koesell-audio」を作成。Standardクラス。
5. Public Access / r2.dev Public Development URLを絶対に有効化しない。

## 2. Pagesバインディング
1. Workers & Pages → KOESSELLの既存Pagesプロジェクト（koeni）を開く。
2. Settings → Bindings → Add → R2 bucket。
3. Variable name は KOESELL_AUDIO。Bucket は koesell-audio。
4. Productionに設定し、再デプロイ。
公式: https://developers.cloudflare.com/pages/functions/bindings/

## 3. サーバー専用の秘密鍵
1. Supabase Dashboard → KOESELL project → API Keys。
2. 「Publishable and secret API keys」から sb_secret_ で始まる秘密鍵をコピー。高権限なのでチャットやGitHubへ送らない。
3. Cloudflare Pages → Settings → Variables and Secrets → Add。
4. 名前 SUPABASE_SECRET_KEY、値はコピーした sb_secret_ の秘密鍵。
5. Encrypted SecretとしてProductionへ保存して再デプロイ。
6. https://koeni.pages.dev/api/audio?op=status を開き、ready:trueなら切替可能。ready:falseなら旧保存先のまま。

## 4. 動作テスト
- 自作の音声を1件出品 → R2 previews/ に保存されるか。
- 未ログインのブラウザで音声を再生できるか。
- 既製音声の販売本編を1件登録 → R2 masters/ に非公開で保存されるか。
- 未購入者は本編を取得できないか。
- 出品削除でプレビューと未販売本編も削除されるか。
- 決済後の本編ダウンロードはStripe決済テスト完了後にのみ検証。

## 技術資料
- functions/api/audio.js：JWTの検証・R2アップロード・公開プレビュー・購入者限定DL・安全な削除。
- cloud.js／index.html：R2 readyの場合だけR2利用、設定前はSupabase Storage維持。
- sales.js：販売本編アップロードと注文先の保存バックエンド判別。
- voice_listings.preview_storage、voice_products.storage_backend、voice_orders.storage_backendで保存先を管理。
- 決済は現在 payments_enabled=false を維持。
- 追加のスパム防止・費用監視・全機能実機テストが正式公開前に必要。

※ 鍵をコピーする際は第三者に見せず、画面のスクリーンショットにも写さないこと。