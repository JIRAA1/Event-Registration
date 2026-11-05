-- This app authenticates users with app_sessions rather than Supabase Auth,
-- so Postgres Changes cannot authorize row delivery with auth.uid(). Use a
-- private Broadcast topic derived from each short-lived app session instead.
create or replace function public.can_receive_student_registration_broadcast(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.app_sessions s
    where p_topic = 'aru-student:' || s.token_hash
      and s.expires_at > now()
  );
$$;

revoke all on function public.can_receive_student_registration_broadcast(text) from public;
grant execute on function public.can_receive_student_registration_broadcast(text) to anon, authenticated;

drop policy if exists "Students receive their registration broadcasts" on realtime.messages;
create policy "Students receive their registration broadcasts"
  on realtime.messages
  for select
  to anon, authenticated
  using (
    extension = 'broadcast'
    and public.can_receive_student_registration_broadcast(realtime.topic())
  );

create or replace function public.broadcast_student_registration_status()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid;
  v_event_id uuid;
  v_status varchar(20);
  v_checkin_at timestamptz;
  v_checkout_at timestamptz;
  v_session record;
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
    v_event_id := old.event_id;
  else
    v_user_id := new.user_id;
    v_event_id := new.event_id;
    v_status := new.status;
    v_checkin_at := new.checkin_at;
    v_checkout_at := new.checkout_at;
  end if;

  for v_session in
    select s.token_hash
    from public.app_sessions s
    where s.user_id = v_user_id and s.expires_at > now()
  loop
    perform realtime.send(
      jsonb_build_object(
        'event_id', v_event_id,
        'user_id', v_user_id,
        'status', v_status,
        'checkin_at', v_checkin_at,
        'checkout_at', v_checkout_at,
        'operation', tg_op
      ),
      'registration_status',
      'aru-student:' || v_session.token_hash,
      true
    );
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists event_registrations_broadcast_student_status on public.event_registrations;
create trigger event_registrations_broadcast_student_status
  after insert or update or delete on public.event_registrations
  for each row execute function public.broadcast_student_registration_status();

notify pgrst, 'reload schema';
