# KOESELL v0.6 運営ダッシュボード

管理画面: https://koeni.pages.dev/admin.html （GitHub main デプロイ後）

ページの公開URLを知るだけではメッセージ・通報・BAN情報を取得できません。サーバー側でログインユーザーの権限を検証します。

## 1. 最初の管理者登録（一度だけ）

2026-10-21に管理者アカウント1件を登録済み。通常は次のSQLを再実行する必要はない。追加登録が必要な場合だけ用いる。


Supabase Dashboard > SQL Editor で、本人がKOESELLへログインしているメールアドレスに置き換えて実行する。

    insert into koesell_private.operators (user_id)
    select id from auth.users
    where email = 'REPLACE_WITH_YOUR_KOESELL_LOGIN_EMAIL'
      and email_confirmed_at is not null
    on conflict(user_id) do nothing
    returning user_id;

結果に1行UUIDが返れば成功。0行ならメールアドレスが一致しないか確認メールが未完了。誤ったアカウントを管理者に設定しない。管理者のメール・パスワードをソースコードに書かない。

管理者権限を剥奪する場合：

    delete from koesell_private.operators
    where user_id='REPLACE_WITH_OPERATOR_USER_UUID'::uuid;

## 2. 運用手順

1. KOESELLへ通常どおりログインし、/admin.html を開く。
2. チャットの通報、自動フラグ、出品の通報、BAN中のアカウントを確認。
3. 内容・前後の事情を調べてから、必要ならBAN・出品非公開・BAN解除を行う。
4. 不審なメッセージの閲覧・保存・共有は、運営上の必要最小限に限定する。

フラグはAIによる犯罪判定ではなくキーワードに基づく簡易検知。誤検知があるため自動BANはしない。

## 3. 権限と残る課題

- 管理者リストはAPIに露出しない koesell_private.operators に保管。
- サーバー側のすべての管理操作で auth.uid() に基づく管理者権限を再確認。
- 通常ユーザーが他人のメッセージ・通報・不正フラグを閲覧できないようRLSと列権限を設定。
- 管理HTML/JSは公開用publishable keyのみを使用。秘密鍵やservice_roleは禁止。
- 正式公開前に、運営によるチャット確認の範囲、保存期間、申立て・削除窓口を利用規約・プライバシーポリシーに記載。
- 対応済み・未対応を区別する処理、担当割当、自動通知、監査履歴は未実装。
- BANはアプリ内の新規投稿・送信の停止であり、Supabase Authアカウント自体を無効化するものではない。
- 公開済みサンプルは既にコピーされている可能性があり回収不能。

旧SQLベース運用ガイド： abuse-moderation-v05.md
