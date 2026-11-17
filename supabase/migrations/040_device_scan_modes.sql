begin;

create or replace function event_pass_private.apply_scan(
  p_session_token text,
  p_event_id uuid,
  p_user_id uuid,
  p_mode text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_event public.events%rowtype;
  v_reg public.event_registrations%rowtype;
  v_user public.users%rowtype;
  v_staff public.users%rowtype;
  v_status text;
  v_passcode_id uuid;
begin
  select u.* into v_staff
  from public.app_sessions s join public.users u on u.id = s.user_id
  where s.token_hash = encode(digest(p_session_token, 'sha256'), 'hex')
    and s.expires_at > now() and u.role in ('STAFF','ADMIN');
  if not found then
    return jsonb_build_object('success',false,'code','FORBIDDEN','message','กรุณาเข้าสู่ระบบสตาฟก่อนสแกน');
  end if;

  select * into v_event from public.events where id = p_event_id for share;
  if not found or v_event.status <> 'ACTIVE' then
    return jsonb_build_object('success',false,'code','EVENT_CLOSED','message','กิจกรรมปิดหรือไม่อยู่ในสถานะเปิดใช้งาน');
  end if;

  select r.* into v_reg
  from public.event_registrations r
  where r.event_id = p_event_id and r.user_id = p_user_id
  for update;
  if not found then
    return jsonb_build_object('success',false,'code','NOT_REGISTERED','message','ไม่พบรายชื่อในกิจกรรมนี้');
  end if;

  select * into v_user from public.users where id = p_user_id;
  if coalesce(p_mode, v_event.scan_mode) = 'CHECKIN' then
    if v_reg.status <> 'REGISTERED' then
      return jsonb_build_object('success',false,'code','ALREADY_CHECKED_IN','student_id',v_user.student_id,'full_name',v_user.full_name,'message','สแกนเข้างานซ้ำ');
    end if;
    v_status := 'ATTENDING';
    update public.event_registrations
    set status=v_status,checkin_at=now(),checked_in_by=v_staff.id,updated_at=now()
    where id=v_reg.id;
  else
    if v_reg.status = 'COMPLETED' then
      return jsonb_build_object('success',false,'code','ALREADY_COMPLETED','student_id',v_user.student_id,'full_name',v_user.full_name,'message','สแกนออกงานซ้ำ');
    end if;
    if v_reg.status <> 'ATTENDING' then
      return jsonb_build_object('success',false,'code','NOT_CHECKED_IN','student_id',v_user.student_id,'full_name',v_user.full_name,'message','ยังไม่ได้สแกนเข้างาน');
    end if;
    v_status := 'COMPLETED';

    -- If Year 2+ and has no passcode yet, auto-assign from reserve pool if any available
    if v_user.study_year > 1 and v_reg.passcode_id is null then
      select id into v_passcode_id from public.event_passcodes
        where event_id = p_event_id and is_reserve = true and assigned_to is null
        order by id limit 1 for update skip locked;
      if v_passcode_id is not null then
        update public.event_passcodes set assigned_to = v_user.id, assigned_at = now() where id = v_passcode_id;
        v_reg.passcode_id := v_passcode_id;
      end if;
    end if;

    update public.event_registrations
    set status=v_status,checkout_at=now(),checked_out_by=v_staff.id,passcode_id=coalesce(v_reg.passcode_id,passcode_id),updated_at=now()
    where id=v_reg.id;
  end if;

  return jsonb_build_object(
    'success',true,'code','SCAN_OK','new_status',v_status,
    'student_id',v_user.student_id,'full_name',v_user.full_name,
    'faculty',v_user.faculty,'major',v_user.major,'class_group',v_user.class_group,
    'study_year',v_user.study_year,
    'message',case when v_status='ATTENDING' then 'เช็คอินสำเร็จ' else 'เช็คเอาต์สำเร็จ' end
  );
end;
$$;

revoke all on function event_pass_private.apply_scan(text,uuid,uuid,text) from public, anon, authenticated;

-- Legacy clients still use the event mode under the same event lock.
create or replace function public.process_qr_scan(p_session_token text,p_event_id uuid,p_user_id uuid)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select event_pass_private.apply_scan(p_session_token,p_event_id,p_user_id,null);
$$;

create function public.redeem_device_event_qr(p_session_token text,p_event_id uuid,p_scan_mode text,p_ticket uuid)
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
  if p_scan_mode is distinct from ticket.scan_mode then
    return jsonb_build_object('message','โหมดสแกนเข้า/ออกไม่ตรงกับบัตร กรุณาตรวจโหมดสแกน');
  end if;
  result := event_pass_private.apply_scan(p_session_token,p_event_id,student,ticket.scan_mode);
  if (result->>'success')::boolean then
    update event_pass_private.qr_tickets set used=true where token=p_ticket;
  end if;
  return result;
end; $$;

revoke all on function public.redeem_device_event_qr(text,uuid,text,uuid) from public;
grant execute on function public.redeem_device_event_qr(text,uuid,text,uuid) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
