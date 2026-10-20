-- KOESELL v0.5 consolidated upgrade from v0.4.
-- Already applied to the production Supabase project on 2026-10-21.
-- Do not re-run on production; use for recreating a fresh copy from prior migrations.

create table public.account_bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null check(char_length(reason) between 3 and 500),
  banned_at timestamptz not null default now(),
  lifted_at timestamptz
);
alter table public.account_bans enable row level security;
revoke all on public.account_bans from anon,authenticated;

create schema if not exists koesell_private;
revoke all on schema koesell_private from public,anon,authenticated;
grant usage on schema koesell_private to anon,authenticated;
create function koesell_private.is_banned(target_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(select 1 from public.account_bans b
    where b.user_id=target_id and b.lifted_at is null)
$$;
revoke all on function koesell_private.is_banned(uuid) from public;
grant execute on function koesell_private.is_banned(uuid) to anon,authenticated;

create function public.koesell_my_ban_status()
returns boolean language sql stable security invoker set search_path=''
as $$ select koesell_private.is_banned((select auth.uid())) $$;
revoke all on function public.koesell_my_ban_status() from public,anon;
grant execute on function public.koesell_my_ban_status() to authenticated;

alter table public.voice_listings alter column review_status set default 'approved';
alter table public.voice_listings alter column is_published set default true;
update public.voice_listings
  set review_status='approved',is_published=true,reviewed_at=null
  where review_status='pending';

drop policy if exists voice_owner_submit_pending on public.voice_listings;
drop policy if exists voice_approved_or_owner_read on public.voice_listings;
create policy voice_owner_instant_publish on public.voice_listings
  for insert to authenticated with check(
    owner_id=(select auth.uid())
    and not koesell_private.is_banned((select auth.uid()))
    and review_status='approved' and is_published=true and reviewed_at is null
  );
create policy voice_public_or_owner_read on public.voice_listings
  for select to anon,authenticated using(
    (review_status='approved' and is_published=true
      and not koesell_private.is_banned(owner_id))
    or (select auth.uid())=owner_id
  );

drop policy if exists koeni_preview_upload on storage.objects;
drop policy if exists koesell_review_gated_preview_read on storage.objects;
create policy koesell_active_user_upload_preview on storage.objects
  for insert to authenticated with check(
    bucket_id='koeni-previews'
    and (storage.foldername(name))[1]=(select auth.uid())::text
    and array_length(storage.foldername(name),1)=1
    and not koesell_private.is_banned((select auth.uid()))
  );
create policy koesell_allowed_audio_preview_read on storage.objects
  for select to anon,authenticated using(
    bucket_id='koeni-previews'
    and not koesell_private.is_banned((select auth.uid()))
    and (
      (select auth.uid())::text=(storage.foldername(name))[1]
      or exists(select 1 from public.voice_listings l
        where l.preview_path=storage.objects.name
          and l.review_status='approved' and l.is_published=true
          and not koesell_private.is_banned(l.owner_id))
    )
  );
-- Storage bucket remains PRIVATE. Approved audio uses short-lived signed URLs.

drop policy if exists favorite_owner_add_approved on public.voice_favorites;
create policy favorite_owner_add_active on public.voice_favorites
  for insert to authenticated with check(
    user_id=(select auth.uid())
    and not koesell_private.is_banned((select auth.uid()))
    and exists(select 1 from public.voice_listings l
      where l.id=listing_id and l.review_status='approved'
        and l.is_published=true and not koesell_private.is_banned(l.owner_id))
  );

drop policy if exists report_approved_listing on public.voice_reports;
create policy report_visible_listing on public.voice_reports
  for insert to authenticated with check(
    reporter_id=(select auth.uid())
    and not koesell_private.is_banned((select auth.uid()))
    and exists(select 1 from public.voice_listings l
      where l.id=listing_id and l.review_status='approved'
        and l.is_published=true and not koesell_private.is_banned(l.owner_id))
  );

create table public.voice_threads(
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.voice_listings(id) on delete set null,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint no_self_chat check(buyer_id<>seller_id),
  constraint one_thread_per_buyer_and_listing unique(listing_id,buyer_id)
);
alter table public.voice_threads enable row level security;
create policy voice_thread_participant_read on public.voice_threads
  for select to authenticated using((select auth.uid()) in (buyer_id,seller_id));
create policy voice_thread_buyer_start on public.voice_threads
  for insert to authenticated with check(
    buyer_id=(select auth.uid())
    and not koesell_private.is_banned(buyer_id)
    and not koesell_private.is_banned(seller_id)
    and exists(select 1 from public.voice_listings l
      where l.id=listing_id and l.owner_id=seller_id and l.review_status='approved'
        and l.is_published=true)
  );
grant select,insert on public.voice_threads to authenticated;

create table public.voice_messages(
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.voice_threads(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check(char_length(btrim(body)) between 1 and 1000),
  safety_flag text check(safety_flag in ('possible_impersonation_or_fraud','possible_off_platform_contact')),
  flagged_at timestamptz,
  created_at timestamptz not null default now()
);
create index voice_messages_thread_order on public.voice_messages(thread_id,created_at);
create index voice_messages_sender_rate on public.voice_messages(sender_id,created_at desc);
create index voice_messages_flagged on public.voice_messages(flagged_at desc) where flagged_at is not null;
alter table public.voice_messages enable row level security;
create policy voice_message_participant_read on public.voice_messages
  for select to authenticated using(
    exists(select 1 from public.voice_threads t
      where t.id=thread_id and (select auth.uid()) in (t.buyer_id,t.seller_id))
  );
create policy voice_message_participant_write on public.voice_messages
  for insert to authenticated with check(
    sender_id=(select auth.uid())
    and not koesell_private.is_banned((select auth.uid()))
    and exists(select 1 from public.voice_threads t
      where t.id=thread_id and (select auth.uid()) in (t.buyer_id,t.seller_id)
      and not koesell_private.is_banned(t.buyer_id)
      and not koesell_private.is_banned(t.seller_id))
  );

create function public.koesell_mark_suspicious_message()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.body ~* '(なりすまし|声を似せ|本人のふり|詐欺|送金|振込|銀行口座|認証コード|暗証番号)' then
    new.safety_flag:='possible_impersonation_or_fraud';
  elsif new.body ~* '(LINE|ライン|Telegram|WhatsApp|メールアドレス|電話番号)' then
    new.safety_flag:='possible_off_platform_contact';
  else
    new.safety_flag:=null;
  end if;
  new.flagged_at:=case when new.safety_flag is null then null else now() end;
  if (select count(*) from public.voice_messages m where
       m.sender_id=new.sender_id and m.created_at>now()-interval '1 minute')>=15 then
    raise exception 'message rate limit reached' using errcode='P0001';
  end if;
  return new;
end
$$;
revoke all on function public.koesell_mark_suspicious_message()
  from public,anon,authenticated;
create trigger tag_voice_messages before insert on public.voice_messages
  for each row execute function public.koesell_mark_suspicious_message();
revoke all on public.voice_messages from anon,authenticated;
grant select(id,thread_id,sender_id,body,created_at),
  insert(thread_id,sender_id,body) on public.voice_messages to authenticated;

create table public.voice_message_reports(
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.voice_messages(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check(reason in ('impersonation','fraud','harassment','other')),
  details text not null default '' check(char_length(details)<=500),
  created_at timestamptz not null default now(),
  unique(message_id,reporter_id)
);
create index voice_message_reports_latest on public.voice_message_reports(created_at desc);
alter table public.voice_message_reports enable row level security;
create policy message_report_by_thread_participant on public.voice_message_reports
  for insert to authenticated with check(
    reporter_id=(select auth.uid())
    and exists(select 1 from public.voice_messages m
      join public.voice_threads t on t.id=m.thread_id
      where m.id=message_id and m.sender_id<>(select auth.uid())
        and (select auth.uid()) in(t.buyer_id,t.seller_id))
  );
revoke all on public.voice_message_reports from anon,authenticated;
grant insert(message_id,reporter_id,reason,details)
  on public.voice_message_reports to authenticated;
