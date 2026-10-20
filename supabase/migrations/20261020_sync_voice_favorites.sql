-- KOESELL v0.4: favorite approved listings across logged-in devices.
-- Already applied to dedicated Supabase project tiyyxtbmaxtdsmmrdsjd.
-- Apply after 20261020_moderation_private_previews.sql.

create table public.voice_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  listing_id uuid not null references public.voice_listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index voice_favorites_by_listing on public.voice_favorites(listing_id);
alter table public.voice_favorites enable row level security;

create policy favorite_owner_read on public.voice_favorites
  for select to authenticated using ((select auth.uid())=user_id);
create policy favorite_owner_add_approved on public.voice_favorites
  for insert to authenticated with check (
    (select auth.uid())=user_id
    and exists (
      select 1 from public.voice_listings l
      where l.id=listing_id
        and l.review_status='approved' and l.is_published=true
    )
  );
create policy favorite_owner_delete on public.voice_favorites
  for delete to authenticated using ((select auth.uid())=user_id);

revoke all on table public.voice_favorites from anon;
revoke update, truncate, references, trigger
  on table public.voice_favorites from authenticated;
grant select, insert, delete on table public.voice_favorites to authenticated;
