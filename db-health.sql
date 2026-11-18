-- =====================================================================
-- Where did the database space go?
--
-- This measures STORED data (database size). It says nothing about egress,
-- log-drain volume or query counts — those live in Dashboard > Usage and
-- come from API traffic, not from anything listed here.
--
-- Run these in Supabase > SQL Editor, in order. The first result is the
-- answer: whatever is at the top of step 1 is what grew, and step 2 says
-- whether it holds real rows or just dead versions of the same rows.
--
-- Step 3 is the one that catches the usual culprit in this app: a row that
-- contains an image (base64) instead of a URL. One 12 MB picture stored
-- inline is ~16 MB of text in a single row, and every update rewrites it.
--
-- Nothing here deletes data. Cleanup statements are at the bottom and are
-- commented out on purpose.
-- =====================================================================


-- 1. Biggest objects (tables, their indexes and their TOAST chunks) ------
select
  n.nspname                                       as schema,
  c.relname                                       as object,
  case c.relkind
    when 'r' then 'table'
    when 'm' then 'matview'
    when 't' then 'toast'
    when 'i' then 'index'
    else c.relkind::text
  end                                             as kind,
  pg_size_pretty(pg_total_relation_size(c.oid))   as total_size,
  pg_size_pretty(pg_relation_size(c.oid))         as heap,
  pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid))
                                                  as indexes_and_toast,
  case when c.reltuples >= 0 then to_char(c.reltuples, 'FM999,999,999,999') else '?' end
                                                  as estimated_rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
  and c.relkind in ('r', 'm', 't')
order by pg_total_relation_size(c.oid) desc
limit 25;


-- 2. Live rows vs dead row versions, and when autovacuum last ran ---------
-- A table with few live rows and a huge size here is bloat, not data.
select
  relname                                          as table_name,
  n_live_tup                                       as live_rows,
  n_dead_tup                                       as dead_rows,
  pg_size_pretty(pg_total_relation_size(relid))    as total_size,
  last_autovacuum,
  last_vacuum
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc
limit 20;


-- 3. The base64 smell: oversized single rows ------------------------------
-- content / meta over a few KB means an image or file was stored in the
-- database instead of in Storage.

select
  id,
  conversation_id,
  type,
  octet_length(content)                          as content_bytes,
  coalesce(octet_length(meta::text), 0)          as meta_bytes,
  created_at
from public.messages
order by greatest(octet_length(content), coalesce(octet_length(meta::text), 0)) desc
limit 10;

select
  id,
  name,
  coalesce(octet_length(avatar::text), 0)        as avatar_bytes,
  created_at
from public.conversations
order by coalesce(octet_length(avatar::text), 0) desc
limit 10;

select
  user_id,
  octet_length(playtime::text)                   as playtime_bytes,
  octet_length(bookmarks::text)                  as bookmarks_bytes,
  octet_length(quests::text)                     as quests_bytes,
  updated_at
from public.profile_data
order by octet_length(playtime::text) desc
limit 10;


-- 4. Write rate: how many messages arrived per hour ----------------------
-- A flat line at an implausible number (hundreds or thousands per hour with
-- nobody chatting) means something is looping, not that users are chatting.
select
  date_trunc('hour', created_at) as hour,
  count(*)                       as messages
from public.messages
group by 1
order by 1 desc
limit 24;


-- 5. Row counts per table ------------------------------------------------
select 'profiles'            as table_name, count(*) from public.profiles
union all select 'messages',            count(*) from public.messages
union all select 'conversations',       count(*) from public.conversations
union all select 'conversation_members',count(*) from public.conversation_members
union all select 'friendships',         count(*) from public.friendships
union all select 'profile_data',        count(*) from public.profile_data
union all select 'calls',               count(*) from public.calls
union all select 'site_mirrors',        count(*) from public.site_mirrors
order by 1;


-- 6. Replication slots holding WAL --------------------------------------
-- An inactive slot with gigabytes retained is a known way for a Supabase
-- project to fill its disk without any table being large.
select
  slot_name,
  active,
  pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) as retained_wal
from pg_replication_slots;


-- 7. Total database size -------------------------------------------------
select pg_size_pretty(pg_database_size(current_database())) as database_size;


-- =====================================================================
-- Cleanup — only after step 1/2/3 showed you the table. Uncomment and
-- adjust. Delete first, then reclaim:
--
--   -- calls are signalling rows only; the app already sweeps them.
--   delete from public.calls where created_at < now() - interval '2 days';
--
--   -- keep one bad row from being read forever:
--   --   update the row to a URL (or null) instead of deleting the account
--
--   -- messages older than the window you want to keep:
--   delete from public.messages where created_at < now() - interval '90 days';
--
--   -- Reclaim the space. Needed after a big delete: autovacuum makes space
--   -- reusable but does not return it to disk. VACUUM FULL needs room equal
--   -- to the table, so run it on the one table that grew, and only once the
--   -- project is under its limit.
--   vacuum full public.profile_data;
--   vacuum full public.messages;
-- =====================================================================
