begin;

-- Remember former devices during attendance, so transferring an account cannot
-- free the old browser to check in a friend. No raw device secret is stored.
create table event_pass_private.attendance_device_holds (
  device_hash text primary key,
  user_id uuid not null references public.users on delete cascade
);
-- Match the existing SECURITY DEFINER owner, also when deployed by postgres.
do $$
declare function_owner text;
begin
  select pg_get_userbyid(proowner) into function_owner from pg_proc
    where oid='event_pass_private.bind_device(uuid,uuid,text)'::regprocedure;
  execute format('alter table event_pass_private.attendance_device_holds owner to %I',function_owner);
end; $$;
revoke all on event_pass_private.attendance_device_holds from public,anon,authenticated;

create or replace function event_pass_private.bind_device(uid uuid, sid uuid, secret text) returns void
language plpgsql set search_path=public,extensions,pg_temp as $$
declare dh text; other_id uuid; b event_pass_private.device_bindings%rowtype;
begin
  if secret is null or secret !~ '^[0-9a-f]{64}$' then raise exception 'กรุณาเปิดเว็บใหม่เพื่อยืนยันเครื่อง'; end if;
  dh:=encode(digest(secret,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(dh,41));
  select user_id into other_id from event_pass_private.device_bindings where device_hash=dh;
  perform id from public.users where id in (uid,other_id) or id in (
    select user_id from event_pass_private.attendance_device_holds where device_hash=dh
  ) order by id for update;

  -- A QR refresh is not a password-authenticated login and cannot take over.
  select * into b from event_pass_private.device_bindings where user_id=uid;
  if sid is not null then
    if not exists(select 1 from public.app_sessions where id=sid and user_id=uid and expires_at>clock_timestamp()) or
      (b.user_id is not null and (b.device_hash<>dh or b.session_id is distinct from sid)) then
      raise exception 'เซสชันหมดอายุหรือบัญชีนี้เข้าสู่ระบบบนเครื่องอื่นแล้ว กรุณาเข้าสู่ระบบใหม่';
    end if;
  end if;

  delete from event_pass_private.attendance_device_holds h where h.device_hash=dh and not exists (
    select 1 from public.event_registrations r where r.user_id=h.user_id and r.status='ATTENDING'
  );
  if exists(select 1 from event_pass_private.attendance_device_holds where device_hash=dh and user_id<>uid) then
    raise exception 'เครื่องนี้ยังมีบัญชีที่กำลังเข้าร่วมกิจกรรม ต้องเช็กเอาต์ก่อนสลับบัญชี';
  end if;
  if other_id is not null and other_id<>uid then
    if exists(select 1 from public.event_registrations where user_id=other_id and status='ATTENDING') then
      raise exception 'เครื่องนี้กำลังเข้าร่วมกิจกรรมด้วยบัญชีอื่น ต้องเช็กเอาต์ก่อนสลับบัญชี';
    end if;
    update public.app_sessions set expires_at=clock_timestamp() where user_id=other_id and expires_at>clock_timestamp();
    delete from event_pass_private.device_bindings where user_id=other_id;
  end if;
  if sid is null and b.user_id is not null and b.device_hash<>dh then
    if exists(select 1 from public.event_registrations where user_id=uid and status='ATTENDING') then
      insert into event_pass_private.attendance_device_holds values(b.device_hash,uid)
        on conflict(device_hash) do update set user_id=excluded.user_id;
    end if;
    insert into event_pass_private.security_audit(actor,student,action,reason)
      values(uid,uid,'SESSION_TAKEOVER','เข้าสู่ระบบด้วยรหัสผ่านบนเครื่องใหม่');
  end if;
  -- login_student expires previous sessions and creates the replacement while
  -- holding this same user-row lock. The transaction commits both atomically.
  insert into event_pass_private.device_bindings values(uid,dh,sid)
    on conflict(user_id) do update set device_hash=excluded.device_hash,session_id=excluded.session_id;
end; $$;
revoke all on function event_pass_private.bind_device(uuid,uuid,text) from public,anon,authenticated;

create or replace function public.admin_reset_student_device(p_token text,p_student_id text,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare actor uuid:=event_pass_private.admin_id(p_token); uid uuid;
begin
  if actor is null then raise exception 'สงวนสิทธิ์เฉพาะแอดมิน'; end if;
  if length(trim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร'; end if;
  select id into uid from public.users where student_id=event_pass_private.student_number(p_student_id) and role='STUDENT' for update;
  if uid is null then raise exception 'ไม่พบนักศึกษา'; end if;
  update public.app_sessions set expires_at=clock_timestamp() where user_id=uid and expires_at>clock_timestamp();
  delete from event_pass_private.card_owners where user_id=uid;
  delete from event_pass_private.device_bindings where user_id=uid;
  delete from event_pass_private.attendance_device_holds where user_id=uid;
  insert into event_pass_private.security_audit(actor,student,action,reason) values(actor,uid,'RESET_DEVICE',trim(p_reason));
  return jsonb_build_object('success',true);
end; $$;

notify pgrst,'reload schema';
commit;
