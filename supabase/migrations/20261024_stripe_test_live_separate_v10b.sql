-- KOESELL v1.0b: Separate Stripe sandbox seller identities from production.
-- Production checkout reads only koesell_private.seller_connect; never test accounts.
create table if not exists koesell_private.seller_connect_test (
  user_id uuid primary key references auth.users(id) on delete restrict,
  stripe_account_id text not null unique,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table koesell_private.seller_connect_test enable row level security;
revoke all on table koesell_private.seller_connect_test from public,anon,authenticated;

create or replace function public.koesell_connect_get_mode(target_user_id uuid,target_mode text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if target_user_id is null then return '{}'::jsonb; end if;
  if target_mode='test' then
    select jsonb_build_object('accountId',s.stripe_account_id,
      'payoutsEnabled',s.payouts_enabled,'detailsSubmitted',s.details_submitted)
      into result from koesell_private.seller_connect_test s where s.user_id=target_user_id;
  elsif target_mode='live' then
    select jsonb_build_object('accountId',s.stripe_account_id,
      'payoutsEnabled',s.payouts_enabled,'detailsSubmitted',s.details_submitted)
      into result from koesell_private.seller_connect s where s.user_id=target_user_id;
  else
    raise exception 'invalid stripe mode' using errcode='22023';
  end if;
  return coalesce(result,'{}'::jsonb);
end;
$$;
revoke all on function public.koesell_connect_get_mode(uuid,text) from public,anon,authenticated;
grant execute on function public.koesell_connect_get_mode(uuid,text) to service_role;

create or replace function public.koesell_connect_set_mode(
  target_user_id uuid,target_account_id text,
  target_payouts_enabled boolean,target_details_submitted boolean,target_mode text
)
returns void language plpgsql security definer set search_path='' as $$
begin
  if target_user_id is null or target_account_id !~ '^acct_[a-zA-Z0-9]+$'
      or koesell_private.is_banned(target_user_id) then
    raise exception 'invalid seller connect update' using errcode='22023';
  end if;
  if target_mode='test' then
    insert into koesell_private.seller_connect_test
      (user_id,stripe_account_id,payouts_enabled,details_submitted)
    values(target_user_id,target_account_id,coalesce(target_payouts_enabled,false),
      coalesce(target_details_submitted,false))
    on conflict(user_id) do update
      set payouts_enabled=excluded.payouts_enabled,
          details_submitted=excluded.details_submitted,updated_at=now()
      where koesell_private.seller_connect_test.stripe_account_id=excluded.stripe_account_id;
  elsif target_mode='live' then
    insert into koesell_private.seller_connect
      (user_id,stripe_account_id,payouts_enabled,details_submitted)
    values(target_user_id,target_account_id,coalesce(target_payouts_enabled,false),
      coalesce(target_details_submitted,false))
    on conflict(user_id) do update
      set payouts_enabled=excluded.payouts_enabled,
          details_submitted=excluded.details_submitted,updated_at=now()
      where koesell_private.seller_connect.stripe_account_id=excluded.stripe_account_id;
  else
    raise exception 'invalid stripe mode' using errcode='22023';
  end if;
  if not found then
    raise exception 'seller connect account cannot be replaced' using errcode='23514';
  end if;
end;
$$;
revoke all on function public.koesell_connect_set_mode(uuid,text,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.koesell_connect_set_mode(uuid,text,boolean,boolean,text) to service_role;

-- Retire first-pass non-mode-aware RPC; no database rows or Stripe accounts are removed.
drop function if exists public.koesell_connect_get(uuid);
drop function if exists public.koesell_connect_set(uuid,text,boolean,boolean);
