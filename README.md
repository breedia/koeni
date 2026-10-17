# KOENI（コエニ）

声を売る・声を買うマーケットプレイスのプロトタイプ。総合型を目指し、初期はショート動画向けの声から集客する。

## 公開先
- Web: https://koeni.netlify.app/
- デプロイ: GitHub `main` → Netlify（接続済み。公開完了はNetlify Deploysで確認）
- 現状: 声の出品・募集・試聴・購入画面は**デモ**。ユーザー間の売買、課金、音声共有は未実装。

## 会員登録（v0.2）
- 認証: Supabase Auth / メールアドレスとパスワード
- KOENI専用Supabaseプロジェクト: `tiyyxtbmaxtdsmmrdsjd`（東京）
- プロフィール: `public.profiles`（認証ユーザー本人のみ読み書き可。登録時に自動作成）
- ブラウザの `index.html` にSupabaseの公開用URL・publishable keyを設定。**service_role / secret keyを置かないこと。**
- 確認メール、パスワード再設定、ログアウト確認のUIあり。

### 管理画面で設定が必要な項目
1. Supabase Dashboard → KOENI → Authentication → URL Configuration
   - Site URL = `https://koeni.netlify.app/`
   - Redirect URLs = `https://koeni.netlify.app/`（正確なURLを許可）
2. メール認証の本番利用には**カスタムSMTP**が必要。Supabase標準の送信は組織に属するメールのみで、低レート制限がある。
3. 自分の登録・メール確認・ログイン・再設定・ログアウトを手動で通してから、一般公開。

## 注意
- 現在の声出品・募集・お気に入りは端末のローカルデモデータ。会員アカウントとは同期しない。
- 決済、商用ライセンス、通報、権利確認、取引メッセージなどは今後実装。
- Supabase Databaseの変更はSupabaseに適用済み。詳細は対応するSQLマイグレーションを参照。
