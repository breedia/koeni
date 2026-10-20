-- KOESELL v0.4 safety: review gate, private preview audio, and abuse reports.
-- This migration (and the trailing privilege hardening) has ALREADY been applied
-- to project tiyyxtbmaxtdsmmrdsjd. Keep this file for future project setup.
-- Apply only after 20261019_voice_listing_previews.sql.

alter table public.voice_listings
  add column review_status text not null default 'pending'
    check (review_status in ('pending','approved','rejected')),
  add column reviewed_at timestamptz;
alter table public.voice_listings alter column is_published set default false;
update public.voice_listings set
  is_published=false, review_status='pending', reviewed_at=null;
alter table public.voice_listings
  add constraint listing_only_approved_public
  check (not is_published or review_status='approved');

drop policy if exists voice_public_published on public.voice_listings;
create policy voice_approved_or_owner_read on public.voice_listings
  for select to anon, authenticated
  using (
    (review_status='approved' and is_published=true)
    or (select auth.uid())=owner_id
  );

drop policy if exists voice_owner_insert on public.voice_listings;
create policy voice_owner_submit_pending on public.voice_listings
  for insert to authenticated with check (
    (select auth.uid())=owner_id
    and review_status='pending' and is_published=false
    and reviewed_at is null
  );

drop policy if exists voice_owner_update on public.voice_listings;
revoke update on public.voice_listings from authenticated;

-- Public buckets bypass file authorization; turn it PRIVATE.
update storage.buckets set public=false where id='koeni-previews';

drop policy if exists koeni_preview_owner_read on storage.objects;
create policy koesell_review_gated_preview_read on storage.objects
  for select to anon, authenticated using (
    bucket_id='koeni-previews'
    and (
      (select auth.uid())::text=(storage.foldername(name))[1]
      or exists (
        select 1 from public.voice_listings l
        where l.preview_path=storage.objects.name
          and l.review_status='approved' and l.is_published=true
      )
    )
  );

create table public.voice_reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.voice_listings(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (
    reason in ('impersonation','voice_cloning','rights','fraud','other')
  ),
  details text not null default '' check (char_length(details) <= 500),
  created_at timestamptz not null default now(),
  unique (listing_id, reporter_id)
);
alter table public.voice_reports enable row level security;
create policy report_approved_listing on public.voice_reports
  for insert to authenticated with check (
    (select auth.uid())=reporter_id
    and exists (
      select 1 from public.voice_listings l
      where l.id=listing_id
        and l.review_status='approved' and l.is_published=true
    )
  );
-- Reporters may submit a report but cannot read or edit reports.
revoke all on table public.voice_reports from anon;
revoke select, update, delete, truncate, references, trigger
  on table public.voice_reports from authenticated;
grant insert on table public.voice_reports to authenticated;

create index voice_listings_review_queue_idx
  on public.voice_listings(review_status, created_at desc);
create index voice_reports_pending_idx
  on public.voice_reports(created_at desc);
