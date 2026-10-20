-- KOESELL v0.7 private audio catalog/order schema (applied 2026-10-21).
-- Run ONLY on a fresh environment, after the v0.5 account and listing migrations.

create table koesell_private.commerce_settings (
  singleton boolean primary key default true check (singleton),
  payments_enabled boolean not null default false,
  platform_fee_bps integer check (platform_fee_bps between 0 and 3000),
  updated_at timestamptz not null default now()
);
insert into koesell_private.commerce_settings (singleton,payments_enabled,platform_fee_bps)
values(true,false,null);
revoke all on koesell_private.commerce_settings from public,anon,authenticated;

create table public.voice_products (
  listing_id uuid primary key references public.voice_listings(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  master_path text not null unique check(char_length(master_path) between 8 and 350),
  original_filename text not null check(char_length(original_filename) between 1 and 120),
  file_size_bytes bigint not null check(file_size_bytes between 1 and 26214400),
  created_at timestamptz not null default now(),
  constraint stock_master_owner_prefix check(master_path like owner_id::text||'/'||listing_id::text||'/%')
);
create index voice_products_owner_idx on public.voice_products(owner_id,created_at desc);
alter table public.voice_products enable row level security;
create policy voice_product_catalog_or_owner on public.voice_products
 for select to anon,authenticated using(
   owner_id=(select auth.uid())
   or exists(select 1 from public.voice_listings l where l.id=listing_id
     and l.listing_type='stock' and l.review_status='approved'
     and l.is_published=true and not koesell_private.is_banned(l.owner_id))
 );
create policy voice_product_owner_insert on public.voice_products
 for insert to authenticated with check(
   owner_id=(select auth.uid()) and not koesell_private.is_banned((select auth.uid()))
   and exists(select 1 from public.voice_listings l
     where l.id=listing_id and l.owner_id=(select auth.uid())
       and l.listing_type='stock' and l.review_status='approved' and l.is_published=true)
 );
revoke all on public.voice_products from public,anon,authenticated;
grant select,insert on public.voice_products to authenticated;

create table public.voice_orders (
 id uuid primary key default gen_random_uuid(),
 buyer_id uuid not null references auth.users(id) on delete restrict,
 seller_id uuid not null references auth.users(id) on delete restrict,
 listing_id uuid not null references public.voice_products(listing_id) on delete restrict,
 amount_yen integer not null check(amount_yen between 100 and 100000),
 platform_fee_yen integer not null check(platform_fee_yen between 0 and amount_yen),
 purchased_master_path text not null,
 purchase_license text not null,
 stripe_checkout_session_id text unique,
 stripe_payment_intent_id text unique,
 stripe_connected_account_id text not null,
 status text not null default 'pending' check(status in
 ('pending','paid','payment_failed','expired','refunded','partially_refunded','disputed')),
 paid_at timestamptz,refunded_at timestamptz,created_at timestamptz not null default now(),
 constraint order_different_users check(buyer_id<>seller_id)
);
create index voice_orders_buyer_idx on public.voice_orders(buyer_id,created_at desc);
create index voice_orders_seller_idx on public.voice_orders(seller_id,created_at desc);
alter table public.voice_orders enable row level security;
create policy order_parties_select on public.voice_orders
 for select to authenticated using((select auth.uid()) in(buyer_id,seller_id));
revoke all on public.voice_orders from public,anon,authenticated;
grant select on public.voice_orders to authenticated;

create table koesell_private.seller_connect (
 user_id uuid primary key references auth.users(id) on delete restrict,
 stripe_account_id text not null unique,
 payouts_enabled boolean not null default false,
 details_submitted boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
revoke all on koesell_private.seller_connect from public,anon,authenticated;
create table koesell_private.payment_events (
 stripe_event_id text primary key,event_type text not null,
 processed_at timestamptz not null default now()
);
revoke all on koesell_private.payment_events from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('koesell-masters','koesell-masters',false,26214400,
 array['audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/webm','audio/aac','audio/flac','audio/x-m4a']);
create policy koesell_master_owner_upload on storage.objects for insert
 to authenticated with check(
  bucket_id='koesell-masters'
  and array_length(storage.foldername(name),1)=2
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and not koesell_private.is_banned((select auth.uid()))
  and exists(select 1 from public.voice_listings l
    where l.owner_id=(select auth.uid()) and l.id::text=(storage.foldername(name))[2]
      and l.listing_type='stock')
 );
create policy koesell_master_owner_read on storage.objects for select
 to authenticated using(bucket_id='koesell-masters'
  and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy koesell_master_owner_delete on storage.objects for delete
 to authenticated using(bucket_id='koesell-masters'
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and not exists(select 1 from public.voice_products p where p.master_path=storage.objects.name));

create function koesell_private.verify_stock_master_exists()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from storage.objects s
   where s.bucket_id='koesell-masters' and s.name=new.master_path)
 then raise exception 'complete master audio upload first' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function koesell_private.verify_stock_master_exists() from public,anon,authenticated;
create trigger verify_stock_master_before_insert
 before insert on public.voice_products
 for each row execute function koesell_private.verify_stock_master_exists();

create function public.koesell_checkout_snapshot(target_listing_id uuid, purchasing_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if purchasing_user_id is null or koesell_private.is_banned(purchasing_user_id)
 then return jsonb_build_object('ready',false,'reason','buyer_unavailable'); end if;
 select jsonb_build_object(
 'ready', c.payments_enabled=true and c.platform_fee_bps is not null
  and s.payouts_enabled=true and s.stripe_account_id is not null,
 'payments_enabled',c.payments_enabled,'fee_bps',c.platform_fee_bps,
 'listing_id',l.id,'seller_id',l.owner_id,'price_yen',l.price_yen,
 'title',l.title,'license',l.usage_license,'master_path',p.master_path,
 'stripe_account',s.stripe_account_id)
 into result
 from public.voice_listings l
 join public.voice_products p on p.listing_id=l.id and p.owner_id=l.owner_id
 left join koesell_private.seller_connect s on s.user_id=l.owner_id
 cross join koesell_private.commerce_settings c
 where c.singleton and l.id=target_listing_id and l.owner_id<>purchasing_user_id
 and not koesell_private.is_banned(l.owner_id) and l.listing_type='stock'
 and l.is_published=true and l.review_status='approved';
 return coalesce(result,jsonb_build_object('ready',false,'reason','not_available'));
end $$;
revoke all on function public.koesell_checkout_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.koesell_checkout_snapshot(uuid,uuid) to service_role;
