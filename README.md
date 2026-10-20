# KOESELL（コエセル）

**「あなたの声には価値がある。」** 声の出品・探索・オーダー収録を目指すマーケットプレイス。旧名称はKOENI。

## 公開と接続

- 新ホスト: https://koeni.pages.dev/ （Cloudflare Pages、ユーザーによる初回デプロイ成功報告）
- 旧ホスト: https://koeni.netlify.app/ （Netlifyクレジット不足で最新版に未追従）
- ソース: GitHub `breedia/koeni` の `main`、トップ階層の `index.html`
- データベース: 既存の専用Supabaseプロジェクト `tiyyxtbmaxtdsmmrdsjd`
- Cloudflareへの最新更新・実機動作の確認は必要
- `index.html` に音声アップロード・録音処理を内包。**`cloud.js` は同処理の開発用コピー**。機能更新時は両方の整合を確認すること。

## v0.4 実装済みの仕組み

- メール認証によるログイン・新規登録とプロフィールの自動作成。
- iPhone Safariでの録音・音声選択、最大10 MBの試聴用音声をSupabase StorageへアップロードするUI。
- **新規出品は審査待ち**。出品者は申請を確認・削除可能。審査前は公開一覧に表示されない。
- `voice_listings` のRLSとDB制約により、出品者自身で審査済み・公開中に変更することはできない。
- 公開バケットを**非公開**に変更。承認された出品のみ、短時間の署名付きURLによる試聴が可能。
- 公開出品に対するログインユーザーからの通報を `voice_reports` に保存。第三者が通報内容を閲覧できない権限設定。
- 審査、却下、非公開化、通報確認用のSQL運用手順: [supabase/moderation.md](supabase/moderation.md)
- 申請審査は**手動**であり、管理者用のWeb審査画面は未実装。

対応する適用済みマイグレーション: `supabase/migrations/20261020_moderation_private_previews.sql`。
認証・プロフィールは既存マイグレーション参照。

## 試作・未対応事項

- トップに並ぶ「架空の声（デモ）」は合成読み上げで、実際の売り手ではない。
- 購入・決済・納品・収録依頼・募集・お気に入りのサーバー同期は未実装（画面デモのみ）。
- 出品者の本人確認、音声の権利検証、AI合成判定、通報の自動通知・審査ダッシュボード、異議申し立て、レート制限、販売本編の安全な納品、規約・法務審査も未実装。
- したがって **まだ一般向けに本格的な出品募集を開始しないこと**。
- サンプルの公開後、悪意ある第三者の保存・音声クローンを完全に防ぐことはできない。
- 公開中止後も、発行済み署名付きURLは最大180秒残存し得る。

## 運用チェック

1. Cloudflare Pagesの最新デプロイがSuccessであることを確認。
2. Supabase Authentication → URL Configurationで、`https://koeni.pages.dev/` をSite URLとRedirect URLsに登録（旧Netlify URLも必要なら残す）。
3. ログインし自作テスト音声を提出 → マイページに **審査待ち（非公開）** と表示されるか。
4. 別ブラウザではその出品が表示されないか。
5. Supabase Dashboardの手順書に従い承認 → 一般一覧と署名付き試聴が機能するか。
6. 出品の「問題を通報」→ SQL Editorで通報を確認できるか。
7. 申請の削除・緊急非公開が反映されるか。

## メールとセキュリティ

- 標準Supabaseメールを当面利用。カスタムSMTPとKOESELLブランドのメールテンプレート適用は正式公開前に行う。
- HTMLに設置しているのは公開用publishable keyのみ。**service_roleなどの秘密鍵をGitHub・ブラウザコード・チャットへ貼らないこと。**
- Supabase Security Advisorは漏洩パスワード保護が未有効のWARNを表示している。正式公開前にAuth設定を確認。
- `koeni` が含まれるGitHubリポジトリ名・URL・DBバケット名は旧名の内部識別子として維持。名称変更だけのための破壊的移行はしない。
