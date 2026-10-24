-- KOESELL Stripe Connect seller onboarding server-only bridge (2026-10-24).
-- Never expose private seller payout identifiers via direct browser SQL.
alter table koesell_private.seller_connect enable row level security;

create or replace function public.koesell_connect_get(target_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare row_data jsonb;
begin
  if target_user_id is null then return '{}'::jsonb; end if;
  select jsonb_build_object(
    'accountId',s.stripe_account_id,
    'payoutsEnabled',s.payouts_enabled,
    'detailsSubmitted',s.details_submitted
  ) into row_data
  from koesell_private.seller_connect s
  where s.user_id=target_user_id;
  return coalesce(row_data,'{}'::jsonb);
end;
$$;
revoke all on function public.koesell_connect_get(uuid) from public,anon,authenticated;
grant execute on function public.koesell_connect_get(uuid) to service_role;

create or replace function public.koesell_connect_set(
  target_user_id uuid,
  target_account_id text,
  target_payouts_enabled boolean,
  target_details_submitted boolean
)
returns void language plpgsql security definer set search_path='' as $$
begin
  if target_user_id is null or target_account_id !~ '^acct_[a-zA-Z0-9]+$'
    or koesell_private.is_banned(target_user_id) then
    raise exception 'invalid seller connect update' using errcode='22023';
  end if;
  insert into koesell_private.seller_connect
    (user_id,stripe_account_id,payouts_enabled,details_submitted)
  values
    (target_user_id,target_account_id,coalesce(target_payouts_enabled,false),
     coalesce(target_details_submitted,false))
  on conflict(user_id) do update
  set payouts_enabled=excluded.payouts_enabled,
      details_submitted=excluded.details_submitted,
      updated_at=now()
  where koesell_private.seller_connect.stripe_account_id=excluded.stripe_account_id;
  if not found then
    raise exception 'seller connect account cannot be replaced' using errcode='23514';
  end if;
end;
$$;
revoke all on function public.koesell_connect_set(uuid,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.koesell_connect_set(uuid,text,boolean,boolean) to service_role;