-- Mirror registry: every host that serves this frontend announces itself here
-- when it is opened, so a newly deployed site appears in the Sites tab of the
-- other mirrors without editing sites.json. Run once in the Supabase SQL
-- editor (Dashboard -> SQL -> New query -> paste -> Run).

create table if not exists public.site_mirrors (
  host text primary key
    check (host ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' and length(host) <= 253),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

alter table public.site_mirrors enable row level security;

-- The list has to be readable and writable before sign-in: a mirror announces
-- itself as soon as its page loads, signed in or not. Rows only ever hold a
-- hostname, and the check constraint keeps them to a plain host format.
drop policy if exists "site mirrors are readable" on public.site_mirrors;
create policy "site mirrors are readable"
  on public.site_mirrors for select
  using (true);

drop policy if exists "site mirrors can announce" on public.site_mirrors;
create policy "site mirrors can announce"
  on public.site_mirrors for insert
  with check (true);

drop policy if exists "site mirrors can refresh" on public.site_mirrors;
create policy "site mirrors can refresh"
  on public.site_mirrors for update
  using (true)
  with check (true);
