# KOESELL 独自ドメイン移行チェック（2026-10-24）

## 現在の状態
- サイト：Cloudflare Pages `koeni` / 暫定公開 `https://koeni.pages.dev/`
- 独自ドメイン：お名前.comで取得した `koesell.com`。
- 2026-10-24：レジストラ側のネームサーバーを `gigi.ns.cloudflare.com`, `newt.ns.cloudflare.com` に変更済み（ユーザー報告）。
- 2026-10-24：Cloudflare Pages > Custom domains に `koesell.com` 登録。現時点のスクリーンショットでは `Initializing` で、稼働確認は未完了。
- Cloudflare DNSのルート `@` はPagesの独自ドメイン追加操作で従来のAレコードから `koeni.pages.dev` へのCNAMEへ切り替える手続きを実行済み（Cloudflare UI上で確認）。
- `www.koesell.com` はまだPages Custom domainsへ登録した証拠がない。既存の `www` Aとお名前.comのNS委任レコードが残り得る。

## GitHub側で対応済み
- index.html は現在開いている許可済みホスト（`koesell.com` / `www.koesell.com`）をメール認証・パスワード再設定の戻り先に使用。`koeni.pages.dev` も利用可能。
- Supabase Edge Functions `koesell-checkout` と `koesell-delivery` は両方のホストをCORS許可。Checkoutのsuccess/cancelは申込時の許可済みホストへ戻す。
- R2本編実在確認の内部URLは従来の `koeni.pages.dev` を維持し、独自ドメイン準備中でも動くようにした。
- Stripe Connect出品者オンボーディング `koesell-connect` のAPI・DB限定RPC・マイページ「売上受取設定」を追加。Stripe側にAPIキーがない間は有効化しない。
- DB `commerce_settings.payments_enabled=false` / `platform_fee_bps=null` は変更しない。

## ユーザーによる操作が残ること

1. **Cloudflare → koeni → Custom domains** で `koesell.com` の状態が `Active`（有効）に変わることを確認し、iPhone SafariでHTTPS表示・ログインを実機確認する。Cloudflareの反映には時間が必要。
2. **Cloudflare PagesのCustom domains** から `www.koesell.com` を追加。DNSで旧 `www` Aレコードや同名のNS委任との競合があれば内容を確認してから整理。**40件のDNSを一括削除しない**。MX/TXTはメール認証・将来のメール設定に関係するので意味を確認する。
3. **Supabase Auth → URL Configuration** のSite URLを、独自ドメイン開通後に `https://koesell.com/` に変更。Redirect URLsには `https://koesell.com/`, `https://www.koesell.com/`（www公開後）, `https://koeni.pages.dev/` を登録（ワイルドカードで過剰に許可しない）。メールテンプレートの `{{ .RedirectTo }}` の扱いも検証する。
4. **Stripe** の本番事業者登録・本人確認とConnectのプラットフォーム有効化を完了。Stripeの秘密鍵・Webhook署名シークレットを**チャットには貼らず**、Supabase Edge Function Secretsにセット。まずテスト環境の `sk_test_` のみで試す。
5. Stripe Connectのテスト時は、マイページ→売上受取設定→Stripe登録の動作を確認。Webhookで購入済み注文になるか、購入者本人だけが音声を受け取れるか、返金で受取不可になるかまで検証する。
6. 販売手数料・特定商取引法表示・利用規約・プライバシーポリシー・ライセンス・返金ルール・運営責任を確定するまで有料決済を有効化しない。

## 技術的な注意
- `koeni.pages.dev` と新ドメインは別オリジンのため、ログイン状態は引き継がれず、新ドメインで再ログインが必要な場合がある。
- WebhookはSupabaseの独立したURLなので、ドメイン切り替えでStripe側のWebhook URLを変更する必要はない。
- `www` とルート間の301リダイレクトは両ホストが正常表示できるようになってからCloudflareのRedirect Ruleで設定する（リダイレクトループに注意）。
- SEOのcanonical URLや旧ホストからの301リダイレクトも新ドメイン正常稼働後に設定し、途中で既存ユーザーを遮断しない。
