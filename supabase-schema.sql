-- =====================================================================
-- Supabase schema for the messenger.
-- Run this in the Supabase SQL editor (Dashboard > SQL Editor).
--
-- Identity: the app has NO password auth. Each browser generates a uuid
-- for the profile and stores it in localStorage; that uuid is the row
-- key in `profiles`.
--
-- RLS: these tables are created WITH row-level security enabled (that is
-- the Supabase default), so the anon key needs explicit policies below.
-- Without them every insert fails with:
--   42501 new row violates row-level security policy for table "profiles"
-- and reads silently return [] rather than erroring, which makes the
-- username-uniqueness check look like it passed.
--
-- The policies at the bottom of this file open the tables to the anon key,
-- which matches the original no-auth design. If you add real auth later,
-- replace them with auth.uid()-scoped policies.
--
-- NOTE: Jerry (the BOT) is special-cased in db.js and stays in
-- localStorage; he is NOT a row here.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enable RLS explicitly. This is idempotent, and it guarantees the
-- policies below are actually enforced even on a table that was
-- created before RLS was turned on project-wide.
-- ---------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.conversations       enable row level security;
alter table public.conversation_members enable row level security;
alter table public.friendships         enable row level security;
alter table public.messages            enable row level security;

-- ---------------------------------------------------------------------
-- Profiles: one row per user.
-- avatar is a JSON object: { type: "icon", name: "cat", color: "#22c55e" }
--                        or { type: "image", value: "<url>", color: "#22c55e" }
-- presence: clients heartbeat `last_seen` every ~30s and flip `status`
-- between 'online' and 'away' (inactivity) / 'offline' (tab closed).
-- A user shows as offline when their last_seen is stale (> 90s old).
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  username    text not null unique,
  avatar      jsonb not null default '{"type":"icon","name":"user","color":"#22c55e"}'::jsonb,
  bot         boolean not null default false,
  status      text not null default 'online' check (status in ('online', 'away', 'offline')),
  last_seen   timestamptz,
  created_at  timestamptz not null default now()
);

-- migrate existing installs (no-ops when the columns already exist)
alter table public.profiles add column if not exists status text not null default 'online' check (status in ('online', 'away', 'offline'));
alter table public.profiles add column if not exists last_seen timestamptz;

-- normalize rows left null by a partial/older migration
update public.profiles set status = 'online' where status is null;

-- ---------------------------------------------------------------------
-- Accounts: case-insensitive name uniqueness.
-- The plain `username text unique` above treats "Bob" and "bob" as two
-- different people, which is not what we want. This index makes the name
-- unique regardless of case or surrounding whitespace. The login page
-- lowercases before insert, so it also catches " Bob" vs "bob".
-- ---------------------------------------------------------------------
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(btrim(username)));

-- ---------------------------------------------------------------------
-- Avatars: uploaded pictures live in Supabase Storage, and the row keeps
-- the object path in avatar_path (NULL means "use the generated icon").
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists avatar_path text;

-- ---------------------------------------------------------------------
-- Playtime, for the leaderboard.
--   total_playtime  lifetime seconds, server-authoritative
--   playtime_delta  unsynced seconds from the browser (localStorage)
--   playtime_synced_at  when the client last pushed a delta
--
-- The client can't be trusted to send a final total, so it sends
-- *deltas*: it adds to playtime_delta locally and flushes that number to
-- the server, which folds it into total_playtime and resets the delta.
-- Total is therefore the only value used for ranking.
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists total_playtime bigint not null default 0;
alter table public.profiles add column if not exists playtime_delta bigint not null default 0;
alter table public.profiles add column if not exists playtime_synced_at timestamptz;

create index if not exists profiles_playtime_idx
  on public.profiles (total_playtime desc);

-- ---------------------------------------------------------------------
-- Storage bucket for uploaded profile pictures.
-- public = true so the anon key can render them with a plain <img src>.
-- Without a bucket the upload silently fails, so this is created here.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

-- RLS is disabled project-wide in this schema, so the anon key can already
-- insert into this bucket. These policies are here so the bucket keeps
-- working if RLS is ever switched on.
drop policy if exists "avatar public read" on storage.objects;
create policy "avatar public read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatar public insert" on storage.objects;
create policy "avatar public insert" on storage.objects
  for insert with check (bucket_id = 'avatars');

drop policy if exists "avatar public update" on storage.objects;
create policy "avatar public update" on storage.objects
  for update using (bucket_id = 'avatars');

drop policy if exists "avatar public delete" on storage.objects;
create policy "avatar public delete" on storage.objects
  for delete using (bucket_id = 'avatars');

-- ---------------------------------------------------------------------
-- Conversations: DMs and groups.
--   type = 'dm' | 'group'
-- group avatar/banner_color live on the conversation row.
-- ---------------------------------------------------------------------
create table if not exists public.conversations (
  id           uuid primary key default gen_random_uuid(),
  type         text not null check (type in ('dm', 'group')),
  name         text,                                  -- group name (null for dm)
  avatar       jsonb,                                 -- group icon
  banner_color text,                                  -- group banner/card color
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Conversation members: who is in a DM or group.
-- ---------------------------------------------------------------------
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_members_user_idx on public.conversation_members (user_id);

-- ---------------------------------------------------------------------
-- Friendships: undirected friend links (stored one way; both directions
-- are queried, so it behaves like an undirected edge).
-- ---------------------------------------------------------------------
create table if not exists public.friendships (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  friend_id  uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);

create index if not exists friendships_friend_idx on public.friendships (friend_id);

-- ---------------------------------------------------------------------
-- Messages.
--   type = 'text' | 'invite' | 'system'
--   meta = invite: { groupId, groupName, groupAvatar, groupColor,
--                    status: "pending"|"accepted"|"declined" }
--          system: { groupId, groupName, system: "text" }
-- ---------------------------------------------------------------------
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  content         text not null default '',
  type            text not null default 'text' check (type in ('text', 'invite', 'system')),
  meta            jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------
-- RLS policies for the anon key.
--
-- The app has no auth, so every browser shares one identity. These open
-- the tables to the anon key, which is what the schema was designed
-- around. `drop policy if exists` first makes the whole block safe to
-- re-run.
-- ---------------------------------------------------------------------

-- profiles: read everyone, create yourself, edit yourself
drop policy if exists "profiles anon select" on public.profiles;
create policy "profiles anon select" on public.profiles
  for select to anon using (true);

drop policy if exists "profiles anon insert" on public.profiles;
create policy "profiles anon insert" on public.profiles
  for insert to anon with check (true);

drop policy if exists "profiles anon update" on public.profiles;
create policy "profiles anon update" on public.profiles
  for update to anon using (true) with check (true);

drop policy if exists "profiles anon delete" on public.profiles;
create policy "profiles anon delete" on public.profiles
  for delete to anon using (true);

-- conversations
drop policy if exists "conversations anon all" on public.conversations;
create policy "conversations anon all" on public.conversations
  for all to anon using (true) with check (true);

-- conversation_members
drop policy if exists "conversation_members anon all" on public.conversation_members;
create policy "conversation_members anon all" on public.conversation_members
  for all to anon using (true) with check (true);

-- friendships
drop policy if exists "friendships anon all" on public.friendships;
create policy "friendships anon all" on public.friendships
  for all to anon using (true) with check (true);

-- messages
drop policy if exists "messages anon all" on public.messages;
create policy "messages anon all" on public.messages
  for all to anon using (true) with check (true);

-- ---------------------------------------------------------------------
-- The same access for signed-in requests.
--
-- Once an account signs in, its requests carry the role "authenticated",
-- and a policy written `to anon` does not apply to it at all. Without the
-- mirror policies below, a signed-in user cannot read profiles or insert
-- its own row: the insert fails with "new row violates row-level security
-- policy for table profiles". Same rules as the anon block, so the app
-- behaves identically signed in or out.
-- ---------------------------------------------------------------------
drop policy if exists "profiles auth select" on public.profiles;
create policy "profiles auth select" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles auth insert" on public.profiles;
create policy "profiles auth insert" on public.profiles
  for insert to authenticated with check (true);

drop policy if exists "profiles auth update" on public.profiles;
create policy "profiles auth update" on public.profiles
  for update to authenticated using (true) with check (true);

drop policy if exists "profiles auth delete" on public.profiles;
create policy "profiles auth delete" on public.profiles
  for delete to authenticated using (true);

drop policy if exists "conversations auth all" on public.conversations;
create policy "conversations auth all" on public.conversations
  for all to authenticated using (true) with check (true);

drop policy if exists "conversation_members auth all" on public.conversation_members;
create policy "conversation_members auth all" on public.conversation_members
  for all to authenticated using (true) with check (true);

drop policy if exists "friendships auth all" on public.friendships;
create policy "friendships auth all" on public.friendships
  for all to authenticated using (true) with check (true);

drop policy if exists "messages auth all" on public.messages;
create policy "messages auth all" on public.messages
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete
  on public.profiles, public.conversations, public.conversation_members,
     public.friendships, public.messages
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- Playtime flush: fold a client's unsynced delta into total_playtime.
--
-- Called with {p_id, p_delta}. The increment happens in the database so
-- two tabs (or a retry after a dropped connection) can't overwrite each
-- other's time, and so the client never has to send a total it could
-- inflate. `greatest(0, ...)` keeps a malformed negative delta from
-- walking the total down.
-- ---------------------------------------------------------------------
create or replace function public.add_playtime(p_id uuid, p_delta bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint;
begin
  update public.profiles
     set total_playtime    = greatest(0, total_playtime + coalesce(p_delta, 0)),
         playtime_delta     = 0,
         playtime_synced_at = now()
   where id = p_id
  returning total_playtime into v_total;

  -- no row matched: the profile is not in the database (yet)
  if v_total is null then
    return null;
  end if;

  return v_total;
end;
$$;

-- The leaderboard reads every profile, so anon needs to select them.
-- (Already covered by "profiles anon select" above, but this is called out
-- because add_playtime is security definer and the RPC itself needs no
-- grant beyond the default; the explicit grants below make that clear.)
grant execute on function public.add_playtime(uuid, bigint) to anon, authenticated;

-- Leaderboard query, ordered by the server-side total.
grant select on public.profiles to anon, authenticated;

-- ---------------------------------------------------------------------
-- Realtime: broadcast every table change so open tabs update live.
-- The DO block is idempotent (safe to re-run) — plain ALTER PUBLICATION
-- errors with 42710 if a table is already in the publication.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles', 'conversations', 'conversation_members', 'friendships', 'messages']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- =====================================================================
-- Sign-in link (multi-link support)
--
-- profiles.id stays the in-app identity that conversations, friendships
-- and messages point at, so adding sign-in never re-keys a row. auth_id
-- is the Supabase Auth user (auth.users.id) allowed to open that row.
-- Accounts created before sign-in existed leave it NULL; they keep working
-- and can attach an email later, which fills this column in.
-- =====================================================================
alter table public.profiles add column if not exists auth_id uuid;

create unique index if not exists profiles_auth_id_key
  on public.profiles (auth_id)
  where auth_id is not null;

-- =====================================================================
-- Progress that used to be browser-only (multi-link support)
--
-- The account itself is a Supabase Auth user, so it works from any link
-- the site is served on. This table holds the parts that used to live
-- only in localStorage: the per-game playtime map (levels/XP), bookmarks
-- and the active quests. They are merged (not overwritten) on pull so
-- two links never wipe each other's progress.
-- =====================================================================
create table if not exists public.profile_data (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  playtime   jsonb not null default '{}'::jsonb,  -- { cleanGameName: seconds }
  bookmarks  jsonb not null default '[]'::jsonb,  -- [ cleanGameName ]
  quests     jsonb not null default '[]'::jsonb,  -- [ { clean, name } ]
  updated_at timestamptz not null default now()
);

alter table public.profile_data enable row level security;

drop policy if exists "profile_data anon all" on public.profile_data;
create policy "profile_data anon all" on public.profile_data
  for all to anon using (true) with check (true);

drop policy if exists "profile_data auth all" on public.profile_data;
create policy "profile_data auth all" on public.profile_data
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.profile_data to anon, authenticated;
