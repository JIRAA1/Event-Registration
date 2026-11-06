-- Refresh reliable per-event online counts. A session is online while it has
-- sent a heartbeat in the last two minutes; students count for events where
-- they have a registration, while staff count for the event selected in scan.
create index if not exists idx_app_sessions_presence
  on public.app_sessions(active_event_id, last_seen_at, user_id);

create or replace function public.heartbeat_session(
  p_session_token text,
  p_active_event_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_updated boolean := false;
begin
  update public.app_sessions s
  set last_seen_at = clock_timestamp(),
      expires_at = now() + interval '12 hours',
      active_event_id = case
        when u.role in ('STAFF','ADMIN')
          and exists(select 1 from public.events e where e.id = p_active_event_id)
          then p_active_event_id
        else null
      end
  from public.users u
  where u.id = s.user_id
    and s.token_hash = encode(digest(p_session_token, 'sha256'), 'hex')
    and s.expires_at > now();
  v_updated := found;
  return jsonb_build_object('success', v_updated);
end;
$$;

grant execute on function public.heartbeat_session(text, uuid) to anon, authenticated;

create or replace function public.admin_get_event_dashboard(p_admin_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not exists (
    select 1 from public.app_sessions s
    join public.users u on u.id = s.user_id
    where s.token_hash = encode(digest(p_admin_token, 'sha256'), 'hex')
      and s.expires_at > now() and u.role = 'ADMIN'
  ) then
    return jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'สงวนสิทธิ์เฉพาะแอดมิน');
  end if;

  return jsonb_build_object(
    'success', true,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_id', e.id,
        'title', e.title,
        'status', e.status,
        'registered_count', (select count(*) from public.event_registrations r where r.event_id = e.id),
        'checked_in_count', (select count(*) from public.event_registrations r where r.event_id = e.id and r.checkin_at is not null),
        'checked_out_count', (select count(*) from public.event_registrations r where r.event_id = e.id and r.checkout_at is not null),
        'online_students', (
          select count(distinct u.id)
          from public.users u
          join public.app_sessions s on s.user_id = u.id
          where u.role = 'STUDENT'
            and s.expires_at > now()
            and s.last_seen_at >= clock_timestamp() - interval '2 minutes'
            and exists (
              select 1 from public.event_registrations r
              where r.event_id = e.id and r.user_id = u.id
            )
        ),
        'online_staff', (
          select count(distinct u.id)
          from public.app_sessions s
          join public.users u on u.id = s.user_id
          where u.role in ('STAFF','ADMIN')
            and s.active_event_id = e.id
            and s.expires_at > now()
            and s.last_seen_at >= clock_timestamp() - interval '2 minutes'
        )
      ) order by e.created_at desc)
      from public.events e
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.admin_get_event_dashboard(text) to anon, authenticated;
notify pgrst, 'reload schema';
