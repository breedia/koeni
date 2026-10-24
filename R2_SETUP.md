# KOESELL Cloudflare R2 接続と動作テスト（v0.9）

## 設定済み
- Cloudflare Pages `koeni` → R2 Binding `KOESELL_AUDIO` → 非公開バケット `koesell-audio`。
- 公開アクセスOFF、Standard。
- 2026-10-23：iPhoneから試聴音声をR2へアップロードし、公開再生できることをユーザーが実機確認。

## v0.9：秘密鍵コピーは不要
- Cloudflare Pages Function `functions/api/audio.js` は、Supabaseの公開キーとユーザー本人のログインJWTを使う。
- Supabase RLSが出品者本人・BANでないこと・公開中の既製音声出品をチェックし、販売本編の登録を許可。
- サーバーは本人所有の出品を検証してR2へアップロードしたあと、同じJWTで `voice_products` を登録。登録が失敗したらR2側のファイルを削除。
- Cloudflareに追加した誤った `SUPABASE_SECRET_KEY` は**このR2 APIでは使用しない**。正しい高権限キーをコピーする必要はない。後日、変数を削除して設定を整理できる。
- バケットは非公開。本編は購入者の支払い済み注文だけに配信。
- 認証ユーザーが架空のR2商品パスをDBへ登録できても請求が起きないよう、Stripe Checkoutは実R2オブジェクトの存在を検証してから決済を開始する。
- `payments_enabled=false` を維持。本番取引は未開始。

## iPhoneで次にやること
1. Cloudflare Pagesの最新Productionデプロイが成功したことを確認。
2. https://koeni.pages.dev/api/audio?op=status を開く。
3. `{"ready":true,"masterReady":true,"storage":"r2","authorization":"user-jwt-rls"}` が表示されたら、秘密鍵なしの新実装が反映されている。
4. KOESELL → マイページ → 自分の出品 → `test` → 「販売本編を登録」。
5. 自分が権利を持つ短い音声（25MB以下）を登録。
6. R2 `koesell-audio/masters/` に保存され、マイページで登録済みと確認できるか。
7. R2本編が未購入者へ直接公開されないことはサーバー側でも再テストする。

## 未完了
- R2本編の実機アップロード・アクセス禁止テスト。
- Stripeのテスト決済・返金・売上分配、出品者本人確認。
- 決済停止フラグを解除する前の全機能テストと規約整備。
