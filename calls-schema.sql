-- =====================================================================
-- Calls schema. Run this in the Supabase SQL editor (Dashboard > SQL
-- Editor). Safe to re-run — every statement is idempotent.
--
-- A call row is the *ring*: the caller inserts status='ringing' and the
-- callee sees it instantly through the supabase_realtime publication
-- (same mechanism as chat messages). Accept/decline/hangup/missed are
-- status UPDATEs on the same row.
--
-- The actual audio/video NEVER touches the database — it goes
-- peer-to-peer over WebRTC, with offer/answer/ICE exchanged through a
-- Supabase Realtime broadcast channel ("call:<id>").
-- =====================================================================

create table if not exists public.calls (
  id          uuid primary key default gen_random_uuid(),
  caller_id   uuid not null,
  callee_id   uuid not null,
  kind        text not null default 'video' check (kind in ('video', 'audio')),
  status      text not null default 'ringing' check (status in ('ringing', 'accepted', 'declined', 'ended', 'missed')),
  created_at  timestamptz not null default now(),
  answered_at timestamptz
);

alter table public.calls enable row level security;

-- Same open-to-anon policy style as the messenger tables (identity is the
-- profile id the browser carries, not auth.uid()).
drop policy if exists "calls anon all" on public.calls;
create policy "calls anon all" on public.calls
  for all to anon using (true) with check (true);

-- Signed-in requests carry the role "authenticated", and a policy written
-- `to anon` does not apply to them at all. Without this mirror every ring
-- insert, every accept/decline update and the callee's realtime delivery
-- were refused (42501 "new row violates row-level security policy for
-- table calls"), which is why calls stopped reaching the other account
-- once accounts were linked.
drop policy if exists "calls auth all" on public.calls;
create policy "calls auth all" on public.calls
  for all to authenticated using (true) with check (true);

-- Client-side filtering picks out the rows for this profile; the policy
-- simply needs to let everyone read/write. DELETE is for the call sweep.
grant select, insert, update, delete on public.calls to anon, authenticated;

-- Realtime: make sure changes on `calls` are broadcast.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calls'
  ) then
    execute 'alter publication supabase_realtime add table public.calls';
  end if;
end $$;

-- Ring sweep: delete call rows older than a day so the table stays tiny.
-- (The table is only ever a few rows; this is just hygiene.)
