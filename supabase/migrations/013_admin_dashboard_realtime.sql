-- Broadcast dashboard invalidations to each active admin session. The browser
-- then calls the existing guarded RPC to fetch fresh counts; metrics themselves
-- are never published in the Realtime payload.
create or replace function public.can_receive_admin_dashboard_broadcast(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.app_sessions s
    join public.users u on u.id = s.user_id
    where p_topic = 'aru-admin-dashboard:' || s.token_hash
      and s.expires_at > now()
      and u.role = 'ADMIN'
  );
$$;

revoke all on function public.can_receive_admin_dashboard_broadcast(text) from public;
grant execute on function public.can_receive_admin_dashboard_broadcast(text) to anon, authenticated;

drop policy if exists "Admins receive dashboard broadcasts" on realtime.messages;
create policy "Admins receive dashboard broadcasts"
  on realtime.messages
  for select
  to anon, authenticated
  using (
    extension = 'broadcast'
    and public.can_receive_admin_dashboard_broadcast(realtime.topic())
  );

create or replace function public.broadcast_admin_event_dashboard_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_session record;
begin
  for v_session in
    select s.token_hash
    from public.app_sessions s
    join public.users u on u.id = s.user_id
    where u.role = 'ADMIN' and s.expires_at > now()
  loop
    perform realtime.send(
      jsonb_build_object(
        'changed_at', clock_timestamp(),
        'source_table', tg_table_name,
        'operation', tg_op
      ),
      'dashboard_changed',
      'aru-admin-dashboard:' || v_session.token_hash,
      true
    );
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists events_broadcast_admin_dashboard on public.events;
create trigger events_broadcast_admin_dashboard
  after insert or update or delete on public.events
  for each row execute function public.broadcast_admin_event_dashboard_change();

drop trigger if exists registrations_broadcast_admin_dashboard on public.event_registrations;
create trigger registrations_broadcast_admin_dashboard
  after insert or update or delete on public.event_registrations
  for each row execute function public.broadcast_admin_event_dashboard_change();

drop trigger if exists passcodes_broadcast_admin_dashboard on public.event_passcodes;
create trigger passcodes_broadcast_admin_dashboard
  after insert or update or delete on public.event_passcodes
  for each row execute function public.broadcast_admin_event_dashboard_change();

drop trigger if exists sessions_broadcast_admin_dashboard on public.app_sessions;
create trigger sessions_broadcast_admin_dashboard
  after insert or update or delete on public.app_sessions
  for each row execute function public.broadcast_admin_event_dashboard_change();

drop trigger if exists users_broadcast_admin_dashboard on public.users;
create trigger users_broadcast_admin_dashboard
  after insert or update or delete on public.users
  for each row execute function public.broadcast_admin_event_dashboard_change();

notify pgrst, 'reload schema';
