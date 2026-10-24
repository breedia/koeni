# KOESELL（コエセル）

**「あなたの声には価値がある。」** 声の出品・探索・オーダー収録を目指すマーケットプレイス。旧名称はKOENI。

## 公開と接続

- 新ホスト: https://koeni.pages.dev/ （Cloudflare Pages、ユーザーによる初回デプロイ成功報告）
- 旧ホスト: https://koeni.netlify.app/ （Netlifyクレジット不足で最新版に未追従）
- ソース: GitHub `breedia/koeni` の `main`、トップ階層の `index.html`
- データベース: 既存の専用Supabaseプロジェクト `tiyyxtbmaxtdsmmrdsjd`
- Cloudflareへの最新更新・実機動作の確認は必要
- `index.html` に音声アップロード・録音処理を内包。**`cloud.js` は同処理の開発用コピー**。機能更新時は両方の整合を確認すること。

## v0.5 即時公開・メッセージ・通報

- 出品は**事前審査なしで即時公開**。以前の `review_status=approved` はDB内部では公開中を示す（有人審査を意味しない）。
- 悪用・権利侵害のリスクを明示し、出品者本人が権利を持つ音声のみを登録。
- 音声ファイルは非公開Storageのまま。公開中の出品に対してのみ180秒の署名付きURLで試聴（誰でも公開済みの音声を保存できる可能性はある）。
- `public.account_bans` に管理者がBAN情報を記録。BAN対象ユーザーの出品は公開一覧から消え、新規出品・相談・メッセージ送信は禁止される。利用停止はSupabase Authのログイン自体を無効化するものではない。
- 実際のテキスト相談：`public.voice_threads` と `public.voice_messages` をSupabaseに保存。当事者以外はRLSで閲覧不可。出品詳細の「出品者に相談」から送信し、マイページの「メッセージ」から確認。
- サーバー側のトリガーで、不審な金銭要求・なりすまし・外部連絡先誘導等をキーワードでフラグ付け。**自動BANはせず、運営による判断が必要**。ユーザーはメッセージを通報できる。
- 運営は管理者権限のSQL Editorでフラグや通報を確認してBAN・解除できる。ガイドは [supabase/abuse-moderation-v05.md](supabase/abuse-moderation-v05.md)。
- 公開済みの実出品のお気に入りはアカウントに同期。架空デモ商品は端末内のみ。
- `index.html` に出品・録音機能を埋め込み、`messages.js` でチャット機能を提供。`cloud.js` は出品ロジックの開発用コピー。

## v0.6 運営専用ダッシュボード

- https://koeni.pages.dev/admin.html を追加。管理者だけがチャットの不審フラグ、メッセージ・出品通報、BAN中アカウントを閲覧。
- BAN・解除・出品の緊急非公開をブラウザから実行可能（サーバー側の権限チェック必須）。
- 通報・検知結果には「確認済み」操作を設け、未対応一覧から外せる。対応記録は内部テーブルに残る。
- 管理者は非公開スキーマ `koesell_private.operators` に登録済み（2026-10-21時点で1アカウント、サーバー権限チェック済み）。
- セットアップ・権限付与・運用手順: [supabase/admin-dashboard-v06.md](supabase/admin-dashboard-v06.md)。
- DB: [supabase/migrations/20261021_operator_dashboard_v06.sql](supabase/migrations/20261021_operator_dashboard_v06.sql)（既に本番DB適用済み）。

## v0.7 有料販売の土台（決済は無効）

- [COMMERCE_LAUNCH.md](COMMERCE_LAUNCH.md) を参照。無料先行公開ではなく、有料の正式公開を目指す。
- `voice_products`、`voice_orders`、非公開Storage `koesell-masters` を追加。
- マイページの「販売本編を登録」「購入・販売履歴」を追加。
- Stripe Checkout準備、署名付きWebhook、購入者だけの有料本編ダウンロードをSupabase Edge Functionsにデプロイ。
- `payments_enabled=false`、`platform_fee_bps=null` で本番決済は完全に無効。Stripe Connect・KYC・手数料・返金運用が整うまで変更しない。
- 現在の実際の注文数は0件。決済／Webhook／ダウンロードの一連の実機テストは未完了。

## v0.8 音声ストレージをCloudflare R2へ段階移行

- [R2_SETUP.md](R2_SETUP.md) にCloudflareの操作手順を記載。
- R2の非公開バケットをPages Functionsに接続するコードを追加。R2の公開URLや直接ダウンロードリンクは利用しない。
- 新しい音声の保存先はR2接続後に自動選択。未接続時は既存のSupabase Storageで動作し続ける。
- 購入本編は購入者のログインと支払済み注文を検証したときだけR2から配信。
- チェックアウト時にSupabaseまたはR2の保存先を固定。決済は無効のまま。
- 2026-10-23にR2バケット・Pagesバインディング・プレビュー音声のiPhone保存／再生を確認。CloudflareのSupabase秘密鍵はv0.9では不要。販売本編は実機未確認。
- 既存の音声ファイルは0件なのでデータコピー不要。

## v0.9 R2本編登録で秘密鍵コピー不要（2026-10-24）

- iPhoneからのR2試聴用音声アップロード・再生は実機確認済み。
- 販売本編はCloudflare Pages FunctionがユーザーのログインJWTを検証し、Supabase RLSで本人所有を確認してR2へ非公開保存。Cloudflareに`sb_secret_`を登録する必要はない。
- Stripe Checkoutは決済前にR2本編の実在を非公開バケットで確認し、存在しなければ支払いを開始しない。
- 最新の設定と次の実機テストは [R2_SETUP.md](R2_SETUP.md) を参照。決済は引き続き無効。

## 試作・未対応事項

- トップに並ぶ「架空の声（デモ）」は合成読み上げで、実際の売り手ではない。
- 既製音声の決済・本編納品はサーバー処理を構築したが**Stripe未接続・売上分配未設定のため利用停止中**。オーダー収録の受注・納品と募集はまだデモのみ。
- 出品者本人確認、音声の権利検証、AI合成判定、通報の自動通知・運営画面の未対応案件通知、異議申し立て、より強いレート制限、販売本編の安全な納品、規約・法務審査は未実装。
- **即時公開は稼働状態でも、規約・個人情報保護・運営監視体制が整うまで本格募集は開始しないこと**。
- サンプルの公開後、悪意ある第三者の保存・音声クローンを完全に防ぐことはできない。
- 公開中止後も、発行済み署名付きURLは最大180秒残存し得る。

## 運用チェック

1. Cloudflare Pagesの最新デプロイがSuccessであることを確認。
2. Supabase Authentication → URL Configurationで、`https://koeni.pages.dev/` をSite URLとRedirect URLsに登録（旧Netlify URLも必要なら残す）。
3. ログインし自作テスト音声を投稿 → マイページに **公開中** と表示されるか。
4. 別ブラウザではその出品が表示され、署名付きURLで試聴できるか。
5. 別アカウントから出品者へメッセージを送信し、受信側から返信できるか。
6. 出品・メッセージの「通報」→ SQL Editorで内容を確認できるか。
7. 管理者がBANした場合、対象アカウントの出品非表示・新規送信禁止が効くか（テストアカウントで実施）。

## メールとセキュリティ

- 標準Supabaseメールを当面利用。カスタムSMTPとKOESELLブランドのメールテンプレート適用は正式公開前に行う。
- HTMLに設置しているのは公開用publishable keyのみ。**service_roleなどの秘密鍵をGitHub・ブラウザコード・チャットへ貼らないこと。**
- Supabase Security Advisorは漏洩パスワード保護が未有効のWARNを表示している。正式公開前にAuth設定を確認。
- `koeni` が含まれるGitHubリポジトリ名・URL・DBバケット名は旧名の内部識別子として維持。名称変更だけのための破壊的移行はしない。

## 認証メールのリダイレクト（2026-10-21 ユーザー設定完了の報告あり）

- 登録確認とパスワード再設定は `https://koeni.pages.dev/` を `emailRedirectTo`/`redirectTo` として明示する。
- Supabase Auth → URL ConfigurationのSite URLとRedirect URLsは、ユーザーが更新完了を報告済み。新規に発行するメールのリンクで実動作を確認する必要がある。
- 必須: Site URL `https://koeni.pages.dev/`、Redirect URLsにも `https://koeni.pages.dev/` を登録。旧Netlifyは必要に応じて維持。
- 管理者のときだけマイページとアカウント画面に運営管理リンクを出す。権限チェックは `admin-access.js` → RPC `koesell_admin_access`（サーバー側で保護）。

## 安全ガイド
- 公開ページ: [safety.html](safety.html)。音声の無断複製や詐欺の防止、メッセージの自動検知と運営確認、通報方法を案内する。
- トップページのフッターからリンク済み。これは運用ガイドであり、正式な利用規約・プライバシーポリシーの代替ではない。

## v1.0 独自ドメイン・売上受取の準備（2026-10-24）

- お名前.com取得ドメイン `koesell.com` をCloudflare Pages（`koeni`）に登録申請済み。ネームサーバーも変更済み。現時点ではCloudflareの表示が `Initializing`、HTTPSでの本番閲覧は未検証。
- 新旧ドメインに対し、Supabaseメール認証の戻り先URLと決済/納品CORSを対応（Edge Functionsは新バージョンをデプロイ）。
- 出品者がStripeで本人確認・振込先登録を進める「¥ 売上受取設定」をマイページに追加。実際のStripe APIキー未接続の場合は操作無効の案内を表示。
- API `koesell-connect`、限定RPC `koesell_connect_get/set`、DB migration `20261024_seller_connect_onboarding_v10.sql` 追加。
- `commerce_settings.payments_enabled=false` と `platform_fee_bps=null` を維持。実際の決済・出品者への送金は未開始。
- 詳細・ユーザー操作は [DOMAIN_MIGRATION.md](DOMAIN_MIGRATION.md) および [COMMERCE_LAUNCH.md](COMMERCE_LAUNCH.md) を参照。
