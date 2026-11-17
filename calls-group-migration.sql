-- Group/multi-party calls migration. Run in Supabase SQL editor.
-- Safe to re-run.

-- room_id: for 1:1 calls same as id; for invites to join an existing call/room,
-- points to the room's call id. Participants join the broadcast channel call:<room_id>.
alter table public.calls add column if not exists room_id uuid;
update public.calls set room_id = id where room_id is null;
alter table public.calls alter column room_id set default gen_random_uuid();

-- track participants who have joined (array of profile uuids)
alter table public.calls add column if not exists participants uuid[] not null default '{}';

-- allow callee_id to be null for room-host rows if needed (keep existing rows valid)
-- (existing schema has callee_id not null; group room host rows may not need a callee)
alter table public.calls alter column callee_id drop not null;

-- helper: add participant to a call/room
create or replace function public.join_call(p_call_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.calls
  set participants = case when p_user_id = any(participants) then participants else array_append(participants, p_user_id) end
  where id = p_call_id or room_id = p_call_id;
end;
$$;
grant execute on function public.join_call(uuid, uuid) to anon, authenticated;
