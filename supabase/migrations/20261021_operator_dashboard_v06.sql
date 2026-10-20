-- KOESELL v0.6 operator dashboard and case resolution (replay after v0.5 migration)
-- APPLIED to live project 2026-10-21. Do not run twice in production.

create table koesell_private.operators(
  user_id uuid primary key references auth.users(id) on delete cascade,
  appointed_at timestamptz not null default now()
);
revoke all on koesell_private.operators from public,anon,authenticated;

create function koesell_private.is_operator(candidate uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select candidate is not null and exists(
  select 1 from koesell_private.operators o where o.user_id=candidate) $$;
revoke all on function koesell_private.is_operator(uuid) from public;
grant execute on function koesell_private.is_operator(uuid) to authenticated;

create function public.koesell_admin_access()
returns boolean language sql stable security invoker set search_path=''
as $$ select koesell_private.is_operator((select auth.uid())) $$;
revoke all on function public.koesell_admin_access() from public,anon;
grant execute on function public.koesell_admin_access() to authenticated;

alter table public.voice_reports
 add column resolved_at timestamptz,
 add column resolved_by uuid references auth.users(id) on delete set null;
alter table public.voice_message_reports
 add column resolved_at timestamptz,
 add column resolved_by uuid references auth.users(id) on delete set null;
alter table public.voice_messages
 add column reviewed_at timestamptz,
 add column reviewed_by uuid references auth.users(id) on delete set null;

create table koesell_private.moderation_actions(
 id uuid primary key default gen_random_uuid(),
 operator_id uuid references auth.users(id) on delete set null,
 action text not null check(action in ('review_flag','review_message_report','review_listing_report')),
 target_id uuid not null,
 created_at timestamptz not null default now()
);
revoke all on koesell_private.moderation_actions from public,anon,authenticated;

create function koesell_private.moderation_queue()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare response jsonb;
begin
 if not koesell_private.is_operator(auth.uid()) then
   raise exception 'moderator access required' using errcode='42501';
 end if;
 select jsonb_build_object(
   'flagged_messages',
     coalesce((select jsonb_agg(to_jsonb(z)) from (
       select m.id,m.created_at,m.body,m.safety_flag,m.sender_id,
         t.buyer_id,t.seller_id,t.listing_id
       from public.voice_messages m
       join public.voice_threads t on t.id=m.thread_id
       where m.flagged_at is not null and m.reviewed_at is null
       order by m.flagged_at desc limit 50
     )z),'[]'::jsonb),
   'message_reports',
     coalesce((select jsonb_agg(to_jsonb(z)) from (
       select r.id,r.created_at,r.reason,r.details,r.reporter_id,
         m.body,m.sender_id,m.thread_id
       from public.voice_message_reports r
       join public.voice_messages m on m.id=r.message_id
       where r.resolved_at is null
       order by r.created_at desc limit 50
     )z),'[]'::jsonb),
   'listing_reports',
     coalesce((select jsonb_agg(to_jsonb(z)) from (
       select r.id,r.created_at,r.reason,r.details,r.reporter_id,
         l.id as listing_id,l.title,l.owner_id
       from public.voice_reports r
       join public.voice_listings l on l.id=r.listing_id
       where r.resolved_at is null
       order by r.created_at desc limit 50
     )z),'[]'::jsonb),
   'active_bans',
     coalesce((select jsonb_agg(to_jsonb(z)) from (
       select b.user_id,b.reason,b.banned_at
       from public.account_bans b where b.lifted_at is null
       order by b.banned_at desc limit 50
     )z),'[]'::jsonb)
 ) into response;
 return response;
end $$;
revoke all on function koesell_private.moderation_queue() from public;
grant execute on function koesell_private.moderation_queue() to authenticated;

create function public.koesell_admin_queue()
returns jsonb language sql stable security invoker set search_path=''
as $$ select koesell_private.moderation_queue() $$;
revoke all on function public.koesell_admin_queue() from public,anon;
grant execute on function public.koesell_admin_queue() to authenticated;

create function koesell_private.moderation_ban(target uuid,explanation text)
returns boolean language plpgsql volatile security definer set search_path=''
as $$
begin
 if not koesell_private.is_operator(auth.uid()) then
   raise exception 'moderator access required' using errcode='42501';
 end if;
 if target is null or explanation is null or char_length(btrim(explanation)) not between 3 and 500 then
   raise exception 'valid account and 3-500 character reason required' using errcode='22023';
 end if;
 if target=auth.uid() then
   raise exception 'cannot ban your own operator account' using errcode='22023';
 end if;
 insert into public.account_bans(user_id,reason,banned_at,lifted_at)
 values(target,btrim(explanation),now(),null)
 on conflict(user_id) do update
 set reason=excluded.reason,banned_at=now(),lifted_at=null;
 return true;
end $$;
revoke all on function koesell_private.moderation_ban(uuid,text) from public;
grant execute on function koesell_private.moderation_ban(uuid,text) to authenticated;
create function public.koesell_admin_ban(target uuid,explanation text)
returns boolean language sql volatile security invoker set search_path=''
as $$ select koesell_private.moderation_ban(target,explanation) $$;
revoke all on function public.koesell_admin_ban(uuid,text) from public,anon;
grant execute on function public.koesell_admin_ban(uuid,text) to authenticated;

create function koesell_private.moderation_unban(target uuid)
returns boolean language plpgsql volatile security definer set search_path=''
as $$
begin
 if not koesell_private.is_operator(auth.uid()) then
   raise exception 'moderator access required' using errcode='42501';
 end if;
 update public.account_bans set lifted_at=now()
 where user_id=target and lifted_at is null;
 return found;
end $$;
revoke all on function koesell_private.moderation_unban(uuid) from public;
grant execute on function koesell_private.moderation_unban(uuid) to authenticated;
create function public.koesell_admin_unban(target uuid)
returns boolean language sql volatile security invoker set search_path=''
as $$ select koesell_private.moderation_unban(target) $$;
revoke all on function public.koesell_admin_unban(uuid) from public,anon;
grant execute on function public.koesell_admin_unban(uuid) to authenticated;

create function koesell_private.moderation_hide_listing(target uuid)
returns boolean language plpgsql volatile security definer set search_path=''
as $$
begin
 if not koesell_private.is_operator(auth.uid()) then
   raise exception 'moderator access required' using errcode='42501';
 end if;
 update public.voice_listings
 set review_status='rejected',is_published=false,reviewed_at=now()
 where id=target and is_published=true;
 return found;
end $$;
revoke all on function koesell_private.moderation_hide_listing(uuid) from public;
grant execute on function koesell_private.moderation_hide_listing(uuid) to authenticated;
create function public.koesell_admin_hide_listing(target uuid)
returns boolean language sql volatile security invoker set search_path=''
as $$ select koesell_private.moderation_hide_listing(target) $$;
revoke all on function public.koesell_admin_hide_listing(uuid) from public,anon;
grant execute on function public.koesell_admin_hide_listing(uuid) to authenticated;

create function koesell_private.mark_case_reviewed(kind text,target uuid)
returns boolean language plpgsql volatile security definer set search_path=''
as $$
declare touched integer;
begin
 if not koesell_private.is_operator(auth.uid()) then
   raise exception 'moderator access required' using errcode='42501';
 end if;
 if target is null or kind not in ('flag','message_report','listing_report') then
   raise exception 'unknown moderation case type' using errcode='22023';
 end if;
 if kind='flag' then
   update public.voice_messages set reviewed_at=now(),reviewed_by=auth.uid()
     where id=target and flagged_at is not null and reviewed_at is null;
 elsif kind='message_report' then
   update public.voice_message_reports set resolved_at=now(),resolved_by=auth.uid()
     where id=target and resolved_at is null;
 else
   update public.voice_reports set resolved_at=now(),resolved_by=auth.uid()
     where id=target and resolved_at is null;
 end if;
 get diagnostics touched=row_count;
 if touched>0 then
   insert into koesell_private.moderation_actions(operator_id,action,target_id)
     values(auth.uid(),case kind when 'flag' then 'review_flag'
       when 'message_report' then 'review_message_report'
       else 'review_listing_report' end,target);
 end if;
 return touched>0;
end $$;
revoke all on function koesell_private.mark_case_reviewed(text,uuid) from public;
grant execute on function koesell_private.mark_case_reviewed(text,uuid) to authenticated;
create function public.koesell_admin_review(kind text,target uuid)
returns boolean language sql volatile security invoker set search_path=''
as $$ select koesell_private.mark_case_reviewed(kind,target) $$;
revoke all on function public.koesell_admin_review(text,uuid) from public,anon;
grant execute on function public.koesell_admin_review(text,uuid) to authenticated;