begin;

create schema if not exists event_pass_private;
revoke all on schema event_pass_private from public, anon, authenticated;

create table event_pass_private.card_owners (
  user_id uuid primary key references public.users on delete cascade,
  session_id uuid not null references public.app_sessions on delete cascade
);

create table event_pass_private.qr_tickets (
  registration_id uuid primary key references public.event_registrations on delete cascade,
  session_id uuid not null references public.app_sessions on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  scan_mode text not null check (scan_mode in ('CHECKIN','CHECKOUT')),
  expires_at timestamptz not null,
  used boolean not null default false
);

create function public.issue_event_qr(p_session_token text, p_event_id uuid, p_transfer boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  s public.app_sessions%rowtype;
  r public.event_registrations%rowtype;
  ticket event_pass_private.qr_tickets%rowtype;
  previous_session uuid;
  mode text;
begin
  -- Issuance, transfers, redemption and logout serialize on the student row.
  select sess.* into s from public.app_sessions sess join public.users u on u.id=sess.user_id
    where sess.token_hash=encode(digest(p_session_token,'sha256'),'hex') and u.role='STUDENT'
    for update of u;
  if not found or not exists(select 1 from public.app_sessions where id=s.id and expires_at>clock_timestamp()) then
    return jsonb_build_object('message','เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  end if;
  select reg.* into r from public.event_registrations reg join public.events e on e.id=reg.event_id
    where reg.event_id=p_event_id and reg.user_id=s.user_id and e.status='ACTIVE';
  if not found or r.status='COMPLETED' then
    return jsonb_build_object('message','กิจกรรมนี้ไม่เปิดให้ออกบัตรแล้ว');
  end if;
  select owner.session_id into previous_session from event_pass_private.card_owners owner
    join public.app_sessions sess on sess.id=owner.session_id
    where owner.user_id=s.user_id and sess.expires_at>clock_timestamp();
  if previous_session is distinct from s.id then
    if previous_session is not null and p_transfer is not true then
      return jsonb_build_object('code','OTHER_SESSION','message','บัตร QR เปิดอยู่ในอีกเบราว์เซอร์หนึ่ง');
    end if;
    delete from event_pass_private.qr_tickets t using public.event_registrations reg
      where t.registration_id=reg.id and reg.user_id=s.user_id;
    insert into event_pass_private.card_owners values(s.user_id,s.id)
      on conflict(user_id) do update set session_id=excluded.session_id;
  end if;
  mode := case when r.status='REGISTERED' then 'CHECKIN' else 'CHECKOUT' end;
  select * into ticket from event_pass_private.qr_tickets where registration_id=r.id;
  if not found or ticket.used or ticket.expires_at<=clock_timestamp() or ticket.scan_mode<>mode then
    insert into event_pass_private.qr_tickets(registration_id,session_id,scan_mode,expires_at)
      values(r.id,s.id,mode,least(s.expires_at,clock_timestamp()+interval '60 seconds'))
      on conflict(registration_id) do update set token=excluded.token, session_id=excluded.session_id,
        scan_mode=excluded.scan_mode, expires_at=excluded.expires_at, used=false returning * into ticket;
  end if;
  return jsonb_build_object('success',true,'token',ticket.token,'mode',mode,
    'ttl_ms',floor(extract(epoch from ticket.expires_at-clock_timestamp())*1000));
end; $$;

-- Only the verified redemption RPC can invoke the existing attendance transaction.
revoke all on function public.process_qr_scan(text,uuid,uuid) from public, anon, authenticated;

create function public.redeem_event_qr(p_session_token text,p_event_id uuid,p_scan_mode text,p_ticket uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  student uuid;
  ticket_event uuid;
  ticket event_pass_private.qr_tickets%rowtype;
  result jsonb;
begin
  if not exists(select 1 from public.app_sessions s join public.users u on u.id=s.user_id
    where s.token_hash=encode(digest(p_session_token,'sha256'),'hex') and s.expires_at>clock_timestamp()
      and u.role in ('STAFF','ADMIN')) then
    return jsonb_build_object('message','กรุณาเข้าสู่ระบบสตาฟก่อนสแกน');
  end if;
  select u.id into student from event_pass_private.qr_tickets t
    join public.event_registrations r on r.id=t.registration_id join public.users u on u.id=r.user_id
    where t.token=p_ticket for update of u;
  select t.* into ticket from event_pass_private.qr_tickets t
    join event_pass_private.card_owners o on o.session_id=t.session_id and o.user_id=student
    join public.app_sessions s on s.id=t.session_id and s.expires_at>clock_timestamp()
    where t.token=p_ticket;
  if not found or ticket.expires_at<=clock_timestamp() then
    return jsonb_build_object('message','QR หมดอายุหรือบัตรถูกย้าย กรุณาเปิด QR ใหม่');
  end if;
  if ticket.used then return jsonb_build_object('message','QR นี้ถูกใช้แล้ว'); end if;
  select event_id into ticket_event from public.event_registrations where id=ticket.registration_id;
  if ticket_event is distinct from p_event_id then return jsonb_build_object('message','QR นี้เป็นของกิจกรรมอื่น'); end if;
  perform 1 from public.events where id=p_event_id and scan_mode=ticket.scan_mode for share;
  if not found or p_scan_mode is distinct from ticket.scan_mode then
    return jsonb_build_object('message','โหมดสแกนเข้า/ออกไม่ตรงกับบัตร กรุณาตรวจโหมดสแกน');
  end if;
  result := public.process_qr_scan(p_session_token,p_event_id,student);
  if (result->>'success')::boolean then
    update event_pass_private.qr_tickets set used=true where token=p_ticket;
  end if;
  return result;
end; $$;

create function public.logout_event_session(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare s public.app_sessions%rowtype;
begin
  select sess.* into s from public.app_sessions sess join public.users u on u.id=sess.user_id
    where sess.token_hash=encode(digest(p_session_token,'sha256'),'hex') for update of u;
  if found then
    if s.expires_at>clock_timestamp() and exists(select 1 from public.event_registrations
      where user_id=s.user_id and status='ATTENDING') then
      return jsonb_build_object('message','ต้องรอเจ้าหน้าที่เช็กเอาต์ก่อนจึงจะออกจากระบบได้');
    end if;
    delete from public.app_sessions where id=s.id;
  end if;
  return jsonb_build_object('success',true);
end; $$;

grant execute on function public.issue_event_qr(text,uuid,boolean), public.redeem_event_qr(text,uuid,text,uuid),
  public.logout_event_session(text) to anon, authenticated;
notify pgrst,'reload schema';
commit;
