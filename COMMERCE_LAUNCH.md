# KOESELL — 有料正式公開へ向けた実装状況 (2026-10-21)

## 方針

- 無料先行公開ではなく、**有料音声の購入・納品・出品者への売上分配が利用できる状態**を完成させてから正式公開する。
- 第1段階は **既製音声の単品購入**、次に **台本指定のオーダー収録**。
- 最初はテスト決済で検証し、実際の課金は法務・決済審査・障害時対応まで完了した後にのみ解禁。

## 実装済み（v0.7）

- **非公開バケット** `koesell-masters` を新設。試聴音声の `koeni-previews` とは分離。
- 出品者のマイページから既製商品の販売本編（最大25MB）をアップロード。
- `voice_products`：販売本編ファイルの所在と出品者情報を保持。本人だけが登録でき、実際にアップロードしたファイルの存在をDBトリガーで検証。
- `voice_orders`：決済金額・手数料・権利許諾・決済状態・ファイル位置のスナップショットを記録。購入者と出品者だけが参照し、誰もブラウザから「購入済み」に更新できない。
- マイページの購入・販売履歴（現在は実取引0件）。
- **koesell-delivery** Edge Function：注文者本人で、status=paidの場合のみ、販売本編を60秒間だけアクセスできる署名付きURLを発行。返金・異議申立中はダウンロード不可。
- **koesell-checkout** Edge Function：出品状況・出品者のStripeアカウント・本人ログイン・価格・決済手数料をサーバーで検証し、許可時だけStripe Checkoutを生成。発行元をStripeドメインに限定。
- **koesell-stripe-webhook** Edge Function：生データの署名とタイムスタンプを確認。Stripeの成功通知と金額・注文ID・Checkout Session IDを突合して購入済みに変更。返金・チャージバックも反映する処理を用意。
- スパム保護：ログインの必須化、注文作成を1時間12件までに制限、サーバーでの権限チェック。
- 本編音声の公開URLは使わず、Stripe秘密鍵もフロントエンドには埋め込まない。

## 決済は現在、意図的に無効

DB `koesell_private.commerce_settings`：
- `payments_enabled=false`（決済を開始できない）
- `platform_fee_bps=null`（運営手数料が未確定）
- `koesell_private.seller_connect` は未連携（出品者への支払い登録を未実装）

**これらが解消されても、すべての購入〜返金〜納品テストが通るまで本番の有効化はしない。**

## 外部で必要な設定（運営者のみ）

1. Stripeアカウントを作り、Stripe Connectのプラットフォーム利用設定を完了する。日本で運営する事業者情報・本人確認等はStripeの画面で実施。
2. コネクタでStripeアカウントを接続できるなら接続する。Stripeのテストデータや設定を会話から扱いやすくなるが、**実際のサービス実装にはStripeダッシュボードの設定が必要**。
3. **Stripeの秘密鍵やWebhook署名シークレットはチャット・GitHubに貼らない。** Supabase DashboardのEdge Function Secretsへ `STRIPE_SECRET_KEY` と `STRIPE_WEBHOOK_SECRET` を登録する。
4. StripeのWebhookエンドポイントは `https://tiyyxtbmaxtdsmmrdsjd.supabase.co/functions/v1/koesell-stripe-webhook`。event typesの候補は `checkout.session.completed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`（テスト時のイベント定義に合わせて確定）。
5. **運営手数料率**・最低販売価格・売上振込基準を決定する。Connectはカード決済手数料や入金に伴う費用が生じる可能性がある。小額の500円商品の経済性を確認してから決める。

参考: https://stripe.com/jp/connect/pricing
Supabase secrets: https://supabase.com/docs/guides/functions/secrets

## 次に実装すること（優先順）

1. Stripe Connectの出品者オンボーディング（Stripe-hosted KYC）。アカウントの対応状況・支払先登録を同期する。
2. Stripeテストモードの全イベント検証：購入→Webhook→DL→返金／異議申立→DL停止。再送・重複も。
3. 決済失敗・返金・チャージバック時の売上分配取り消し／プラットフォーム手数料処理を検証。Stripe Connectの責任分担を確認。
4. マイページに購入者・出品者別の注文一覧・売上・返金対応UIを整える。
5. オーダー収録（依頼、見積・受注、支払い、期日、納品、検収、キャンセル・紛争）。
6. 利用規約・プライバシーポリシー・特商法表記・決済/返品条件・デジタル音声のライセンスを確定。DM閲覧・不正検知と電気通信事業法も確認。
7. 退会・データ削除・問い合わせ・通報通知・障害監視・ログの保存方針。
8. 試作の架空商品を整理し、本物の出品でiPhone/PCから全動作をテスト。
9. 商標・ドメイン・ブランド・導入説明を整えて正式公開。

## 大事な制限

- Stripeと接続し、Webhookイベントの本物のテストが終わるまでは **本番取引はできない**。
- 「匿名ユーザーにファイルのパスが見えること」と「ダウンロードできること」は別問題だが、公開済み本編のメタデータも厳格に制限している。
- 購入後に出品者がBANされた場合でも、既存の有料購入権利の扱いは法務・返金ルールと一緒に検討する。
- 退会と購入済み音声の保持は決済記録の保管義務に配慮して実装が必要。
- 決済プロバイダからの返金・不正異議申立に伴う支払い取消しや売上分配の責任設計は未検証。

## v1.0 Stripe Connect出品者登録の土台（2026-10-24）

- `koesell-connect` Edge Function を新規デプロイ。本人のJWT・BAN状態を検証し、Stripe Connect Expressアカウントをユーザーごとに一度だけ作成する処理を実装。
- Stripe-hosted Account Linkによる本人確認・振込先登録・再開の導線を実装。サイト内に銀行口座・本人確認書類は保存しない。
- `koesell_private.seller_connect` はprivate schema + RLSで保護。`koesell_connect_get/set` RPCはservice_roleのみ実行可能。アカウントID差し替え不可。
- マイページ「¥ 売上受取設定」は登録状況を取得。Stripeからの帰還時には再照会し、単に戻っただけでは完了判定をしない。
- 本番アカウント自動作成は `KOESELL_ALLOW_LIVE_CONNECT=yes` がないと停止。テスト/本番アカウントを混ぜない。
- **未確認/ブロッカー**：運営のStripe本番登録・Connect有効化、`STRIPE_SECRET_KEY` のテスト鍵設定、端末でのConnect実動作検証。
- 手数料設定と支払開始スイッチは未変更。
- 新独自ドメインとの両立は [DOMAIN_MIGRATION.md](DOMAIN_MIGRATION.md) を参照。

### Stripeテスト/本番アカウントを分離（v1.0b）

- テスト用Stripe Connectアカウントは `koesell_private.seller_connect_test` に記録。
- 本番用Stripe Connectアカウントは既存 `koesell_private.seller_connect` に記録（Checkoutが参照するのは本番だけ）。
- モード別RPC `koesell_connect_get_mode` / `koesell_connect_set_mode` はservice_role以外から実行できない。
- Stripeテスト環境が準備できても `payments_enabled` は自動で有効化しない。テスト決済フローは別途安全な限定環境で検証する。

## Stripe Connect Accounts v2 移行記録（2026-10-28）

- 実機テストで新規連結アカウント作成時に旧 `POST /v1/accounts` が Stripe HTTP 400 を返した。Supabase `function_logs` でも確認。
- 新しい `koesell-connect`（Supabase Edge Function v6）は `POST /v2/core/accounts` に移行。日本の受取専用 `recipient`、`stripe_transfers`、`dashboard: express` を使う。
- 送金先の状態確認は v2 `configuration.recipient.capabilities.stripe_balance.stripe_transfers/payouts.status` を参照。本人確認の入力はStripe-hosted onboarding（`/v2/core/account_links`）を利用する。
- テスト環境の Account 作成成功をDB `seller_connect_test` にて1件確認。認証済みユーザーが Stripe にオンボードする途中のため、受取準備完了フラグはまだ `false`。
- Stripeが400/409で拒否する場合、秘密情報なしで `stripeCode` を返し画面に安全な診断コードを表示する。
- データベース `payments_enabled=false` は変更していない。テスト用アカウントを本番には使わない。
- v2 の `dashboard: express` および `losses_collector: application` にはプラットフォーム側で負残高を負担する責任がある。**本番稼働前に損失・返金・チャージバック・出品者審査の運用を確定すること**。
- Stripeの仕様変更により Accounts v2 のアカウント作成に移行。APIは `2026-07-29.dahlia` でピン留めし、以後バージョン更新時はテスト環境で検証する。
