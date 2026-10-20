# KOESELL（コエセル）

※ 旧ブランド名: KOENI。GitHubリポジトリ名、Cloudflareプロジェクト名、Supabase識別子は移行中のため旧名を維持。ブランド表示のみ新名称。


声を売る・声を買う音声マーケットプレイス。総合型として設計し、当面はショート動画制作者への訴求から始める。

- 現在の公開先（Cloudflare Pages）: https://koeni.pages.dev/ （公開成功はユーザー報告、ページ自体の実機確認はこれから）
- 旧公開先（Netlify）: https://koeni.netlify.app/ （従来のデプロイクレジット不足のため旧版のまま）
- GitHub main → 既存Netlifyプロジェクトに自動デプロイ
- 専用Supabase: `tiyyxtbmaxtdsmmrdsjd`（東京リージョン）

## v0.3：声の公開サンプル
- ログイン済みの出品者が**最大10MBの試聴用音声**をアップロードし、メタ情報付きで一般公開できる。
- `public.voice_listings` に商品情報、Supabase Storageの公開バケット `koeni-previews` に音声サンプルを保存。
- 未ログインの閲覧者も一覧・試聴可能。出品者本人だけが登録・削除できる（RLS・Storage policy）。
- 自分の公開出品はマイページから削除可能。
- `index.html` + `cloud.js`。既存の架空デモ商品は「架空の声（デモ）」と区別して表示。
- `supabase/migrations/20261019_voice_listing_previews.sql` は再現用。**KOESELL本番プロジェクトへのMigration適用は完了済み**。

**注意：** Storage `koeni-previews` は公開バケット。試聴用サンプルは非ログインユーザーからもアクセスできるので、購入者限定の本編・個人情報・権利を保有しない音声をアップロードしないこと。削除直後もキャッシュで一時的に残る場合がある。

## v0.2：認証
- Supabase Authでメール/パスワードによる登録・ログイン・ログアウトと再設定。
- `public.profiles` は本人のみアクセス、登録時に自動生成。
- `index.html` に公開用URLとpublishable keyのみ。**秘密鍵・service_roleは絶対にフロントエンドに置かないこと。**
- 標準のSupabaseメールを当面使用。独自ドメイン・SMTP・ブランドメールは公開準備段階で導入。

## 現時点で未実装
- 有料音声の本編ファイルを購入者だけに配布する仕組み
- 購入・決済・返金・売上支払い
- オーダーメイドの依頼送信・出品者との取引
- 募集・お気に入りのサーバー同期
- 音声の権利確認、通報・管理者承認、年齢/利用規約への同意など本番向け運用

## テスト方法
1. Netlify DeploysでGitHub `main` の最新commitが`Published`か確認。
2. KOESELLでログインして「声を出品する」を選び、自作の短い音声サンプルを登録する。
3. シークレットブラウザ/別端末で `https://koeni.pages.dev/` を開き、公開サンプルが一覧に表示され、試聴できるか確認。
4. ログインしてマイページから該当の公開出品を削除し、再読み込みで消えているか確認。

メールの件名を変えるためのテンプレートは `supabase/email-templates/` に保管（現在未適用）。

## 名称変更（2026-10-20）
ブランド名を **KOESELL（コエセル）** に変更。ログイン機能・API接続・GitHub自動デプロイを保つため旧 `koeni` 名のURL・Supabase内部識別子・ローカルデータキーはそのまま維持。正式公開前に商標・同名サービス・ドメイン・Supabase Auth URL Configurationを確認する。
