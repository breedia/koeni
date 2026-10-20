# KOESELL：即時公開・不正通報・BAN運用ガイド（v0.5）

適用済みのデータベース：Supabase project `tiyyxtbmaxtdsmmrdsjd`。
このファイルは運営者の管理用。一般ユーザーにBAN操作画面や秘密鍵を公開しないこと。

## 運用方針

- **出品は事前審査なしで即時公開**。利用者が操作した時点で公開される。
- 試聴サンプルは非公開バケットに保存した上で、許可された公開出品にだけ短期署名付きURL（180秒）を発行する。
- 出品後の権利侵害・AIなりすまし・詐欺は、通報またはチャット本文のキーワード検知で発見を補助する。
- **メッセージは当事者のみ閲覧可能**。運営者は管理者権限で不正調査のため確認できる。一般ユーザーが他人の会話を閲覧できないようRLSで制限。
- メッセージに関する警告と運営確認の可能性を送信画面で明示する。正式公開前にプライバシーポリシー、利用規約、保存期間、削除・異議申立て窓口を整備する。
- 現状の自動検知は単純な文字パターン判定。検知漏れ・誤検知があり、**自動BANは行わない**。通報・検知内容を人間が確認して判断。
- **BANはWebアプリ側の操作権限停止**。Supabase Auth自体のログイン停止ではない。出品が一覧から消え、新しい出品・新規相談・メッセージ送信ができなくなる。
- 既発行の試聴URLは最大180秒ほど有効な場合があり、既に複製された音声を回収することはできない。
- 購入・決済・納品は未実装。実際の金銭のやり取りを開始しないこと。

## 1. 不正リスクのあるメッセージを確認する

Supabase Dashboard → SQL Editor の管理権限で次を実行する。

```sql
select m.id, m.created_at, m.safety_flag, m.body,
       m.sender_id, t.buyer_id, t.seller_id, t.listing_id
from public.voice_messages m
join public.voice_threads t on t.id=m.thread_id
where m.flagged_at is not null
order by m.flagged_at desc
limit 100;
```

このクエリはフラグ付きのメッセージだけを抽出する。キーワード検出だけで違反確定とみなさない。

## 2. ユーザーからの通報を確認する

```sql
select r.created_at, r.reason, r.details, r.reporter_id,
       m.body, m.sender_id, m.thread_id
from public.voice_message_reports r
join public.voice_messages m on m.id=r.message_id
order by r.created_at desc limit 100;
```

```sql
select r.created_at, r.reason, r.details, r.reporter_id,
       r.listing_id, l.title, l.owner_id
from public.voice_reports r
join public.voice_listings l on l.id=r.listing_id
order by r.created_at desc limit 100;
```

現時点では自動通知も運営Webダッシュボードも未実装。担当者が定期的に確認する必要がある。

## 3. BAN（運営のみ）

事実確認後、対象ユーザーのUUIDを用い、管理者として実行する。

```sql
insert into public.account_bans(user_id,reason,banned_at,lifted_at)
values ('REPLACE_WITH_USER_UUID'::uuid,'調査で確認した違反理由',now(),null)
on conflict (user_id) do update set
 reason=excluded.reason, banned_at=now(), lifted_at=null;
```

即時に公開一覧から当該ユーザーの出品が除外され、新規出品とメッセージの送信が制限される。ユーザーに適切な説明と異議申し立て窓口を設けること。

## 4. BAN解除（運営のみ）

```sql
update public.account_bans set lifted_at=now()
where user_id='REPLACE_WITH_USER_UUID'::uuid and lifted_at is null;
```

BAN解除すると過去の公開出品が再び見える可能性がある。必要に応じて個別の出品も非公開にする。

## 5. 個別の出品を緊急非公開にする

```sql
update public.voice_listings
set review_status='rejected',is_published=false,reviewed_at=now()
where id='REPLACE_WITH_LISTING_UUID'::uuid
returning id,title,is_published;
```

`review_status` は以前の審査制から残る内部列。`approved` は現在「通常公開中」を意味し、事前に人が審査したという意味ではない。

## 公開前に残っている課題

本人確認・出品権利の検証、不正アカウントの再登録対策、継続的な通報チェック、レート制限強化、
違法投稿の削除申請窓口、利用規約・プライバシーポリシー、保存期間の設計、
通知・管理画面、端末をまたぐ実機テスト、法務レビューが必要。
