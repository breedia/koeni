-- KOENI v0.3. This schema has already been applied to the dedicated KOENI
-- Supabase project via migration add_public_voice_listing_previews_v03.
-- Run only when initializing a fresh project.

create table public.voice_listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  seller_name text not null check (char_length(seller_name) between 2 and 30),
  title text not null check (char_length(title) between 2 and 75),
  category text not null check (category in ('ショート動画','ナレーション','セリフ・演技','ホラー・怪談','朗読','ASMR・癒し','ゲーム・TRPG','広告・企業')),
  listing_type text not null check (listing_type in ('stock','custom')),
  price_yen integer not null check (price_yen between 100 and 100000),
  voice_tag text not null check (char_length(voice_tag) between 1 and 35),
  duration_label text not null default '要相談' check (char_length(duration_label) between 1 and 30),
  usage_license text not null check (usage_license in ('個人利用のみ','商用利用可（SNS動画）','商用利用可（広告・企業利用含む）','用途によって要相談')),
  sample_text text not null default '' check (char_length(sample_text) <= 350),
  preview_path text,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  constraint voice_preview_owner check (preview_path is null or
    (split_part(preview_path,'/',1) = owner_id::text and char_length(preview_path) <= 180))
);
create index voice_listings_latest on public.voice_listings(created_at desc);
create index voice_listings_owner on public.voice_listings(owner_id, created_at desc);
alter table public.voice_listings enable row level security;
create policy voice_public_published on public.voice_listings
  for select to anon, authenticated
  using (is_published or (select auth.uid()) = owner_id);
create policy voice_owner_insert on public.voice_listings
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy voice_owner_update on public.voice_listings
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy voice_owner_delete on public.voice_listings
  for delete to authenticated using ((select auth.uid()) = owner_id);
grant select on public.voice_listings to anon, authenticated;
grant insert, update, delete on public.voice_listings to authenticated;

-- Public PREVIEW samples only. Never upload paid full-length deliverables here.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('koeni-previews','koeni-previews',true,10485760,
  array['audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav',
        'audio/ogg','audio/webm','audio/aac','audio/x-aac','audio/flac',
        'audio/3gpp','audio/3gpp2']);

create policy koeni_preview_upload on storage.objects
  for insert to authenticated
  with check (bucket_id='koeni-previews'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and array_length(storage.foldername(name),1)=1);
create policy koeni_preview_remove on storage.objects
  for delete to authenticated
  using (bucket_id='koeni-previews'
    and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy koeni_preview_owner_read on storage.objects
  for select to authenticated
  using (bucket_id='koeni-previews'
    and (storage.foldername(name))[1]=(select auth.uid())::text);
