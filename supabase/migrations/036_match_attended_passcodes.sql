begin;

-- 1. Match passcodes strictly to students who actually attended (ATTENDING or COMPLETED)
create or replace function event_pass_private.match_waiting_passcodes(p_event uuid) returns int
language plpgsql set search_path=public,pg_temp as $$
declare r record; code_id uuid; matched int:=0;
begin
  for r in select reg.id,reg.user_id from public.event_registrations reg join public.users u on u.id=reg.user_id
    where reg.event_id=p_event and reg.passcode_id is null and u.role='STUDENT' and u.study_year>1
      and reg.status in ('ATTENDING','COMPLETED')
    order by case when reg.status='COMPLETED' then 1 else 2 end, reg.checkin_at asc, reg.id
    for update of reg skip locked
  loop
    select p.id into code_id from public.event_passcodes p
      where p.event_id=p_event and p.is_reserve and p.assigned_to is null
      order by p.id limit 1 for update skip locked;
    if not found then exit; end if;
    update public.event_passcodes set assigned_to=r.user_id,assigned_at=now() where id=code_id;
    update public.event_registrations set passcode_id=code_id,updated_at=now() where id=r.id;
    matched:=matched+1;
  end loop;
  return matched;
end; $$;

-- 2. Update process_qr_scan so checkout auto-assigns an unassigned reserve passcode if available
create or replace function public.process_qr_scan(
  p_session_token text,
  p_event_id uuid,
  p_user_id uuid
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
  if v_event.scan_mode = 'CHECKIN' then
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

revoke all on function public.process_qr_scan(text, uuid, uuid) from public;
grant execute on function public.process_qr_scan(text, uuid, uuid) to anon, authenticated;

-- 3. Bulk enroll roster students into an event without consuming passcodes
create or replace function public.admin_enroll_roster_to_event(
  p_admin_token text,
  p_event_id uuid,
  p_faculty text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin_id uuid;
  v_enrolled_count int := 0;
begin
  select u.id into v_admin_id
  from public.app_sessions s join public.users u on u.id = s.user_id
  where s.token_hash = encode(digest(p_admin_token, 'sha256'), 'hex')
    and s.expires_at > now() and u.role = 'ADMIN';
  if v_admin_id is null then
    return jsonb_build_object('success',false,'error_code','FORBIDDEN','message','สงวนสิทธิ์เฉพาะแอดมิน');
  end if;
  if not exists(select 1 from public.events where id = p_event_id) then
    return jsonb_build_object('success',false,'error_code','NOT_FOUND','message','ไม่พบกิจกรรมนี้');
  end if;

  with inserted as (
    insert into public.event_registrations(event_id, user_id, status, is_walkin, registered_by)
    select p_event_id, u.id, 'REGISTERED', false, v_admin_id
    from public.users u
    where u.role = 'STUDENT'
      and (p_faculty is null or u.faculty = p_faculty)
      and not exists (
        select 1 from public.event_registrations r
        where r.event_id = p_event_id and r.user_id = u.id
      )
    returning id
  )
  select count(*) into v_enrolled_count from inserted;

  return jsonb_build_object('success',true,'enrolled_count',v_enrolled_count);
end;
$$;

revoke all on function public.admin_enroll_roster_to_event(text, uuid, text) from public;
grant execute on function public.admin_enroll_roster_to_event(text, uuid, text) to anon, authenticated;

notify pgrst,'reload schema';
commit;
