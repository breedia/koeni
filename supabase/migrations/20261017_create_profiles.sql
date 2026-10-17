-- KOENI v0.2. Reference migration for a fresh KOENI Supabase project.
-- Already applied via Supabase migrations to project tiyyxtbmaxtdsmmrdsjd.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'KOENIユーザー'
    constraint profiles_name_length check (char_length(display_name) between 2 and 30),
  bio text not null default ''
    constraint profiles_bio_length check (char_length(bio) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy profiles_read_own on public.profiles
for select to authenticated
using ((select auth.uid()) = id);

create policy profiles_update_own on public.profiles
for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

revoke all on table public.profiles from anon;
grant select on table public.profiles to authenticated;
grant update (display_name, bio) on table public.profiles to authenticated;

create function public.koeni_profile_on_signup()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare proposed_name text;
begin
  proposed_name := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  insert into public.profiles (id, display_name)
  values (new.id, case when char_length(proposed_name) between 2 and 30 then proposed_name else 'KOENIユーザー' end)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.koeni_profile_on_signup() from public, anon, authenticated;

create trigger koeni_user_profile_create
after insert on auth.users
for each row execute function public.koeni_profile_on_signup();

create function public.koeni_profiles_update_time()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.koeni_profiles_update_time() from public, anon, authenticated;

create trigger koeni_profile_updated
before update on public.profiles
for each row execute function public.koeni_profiles_update_time();
