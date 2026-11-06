alter table public.app_sessions
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists active_event_id uuid references public.events(id) on delete set null;

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
  set last_seen_at = now(),
      expires_at = now() + interval '12 hours',
      active_event_id = case
        when u.role in ('STAFF','ADMIN') and exists(select 1 from public.events e where e.id = p_active_event_id)
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
          from public.event_registrations r
          join public.users u on u.id = r.user_id and u.role = 'STUDENT'
          join public.app_sessions s on s.user_id = u.id
          where r.event_id = e.id and s.expires_at > now()
            and s.last_seen_at > now() - interval '90 seconds'
        ),
        'online_staff', (
          select count(distinct u.id)
          from public.app_sessions s
          join public.users u on u.id = s.user_id and u.role in ('STAFF','ADMIN')
          where s.active_event_id = e.id and s.expires_at > now()
            and s.last_seen_at > now() - interval '90 seconds'
        )
      ) order by e.created_at desc)
      from public.events e
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.admin_get_event_dashboard(text) to anon, authenticated;
notify pgrst, 'reload schema';
