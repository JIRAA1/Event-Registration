begin;
-- Keep receipt-based corrections and authorized station applications working.
create or replace function public.registration_apply(p_event uuid,p_profile jsonb,p_receipt text,p_station text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare e public.events%rowtype; a event_pass_private.applications%rowtype; person public.users%rowtype;
  sid text:=event_pass_private.student_number(p_profile->>'student_id'); kiosk_mode boolean:=p_station is not null;
  rh text:=encode(digest(p_receipt,'sha256'),'hex'); new_id uuid;
begin
  if p_receipt is null or p_receipt !~ '^[0-9a-f]{64}$' then raise exception 'กรุณาเปิดฟอร์มใหม่'; end if;
  if kiosk_mode and not event_pass_private.station_ok(p_event,p_station) then raise exception 'เซสชันเครื่องหมดอายุ กรุณาเข้าสู่ระบบเครื่องใหม่'; end if;
  select * into e from public.events where id=p_event for share;
  if not found or e.status='CLOSED' or (not kiosk_mode and not e.online_registration) then raise exception 'ปิดรับสมัครแล้ว กรุณาติดต่อจุดหน้างาน'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event::text||':'||sid,0));
  p_profile:=event_pass_private.application_profile(p_profile);
  select * into a from event_pass_private.applications where receipt_hash=rh for update;
  if found then
    if a.student_id<>sid or a.event_id<>p_event or a.kiosk<>kiosk_mode then raise exception 'ใบสมัครไม่ตรงกับคำขอเดิม'; end if;
    if a.status='CORRECT' then update event_pass_private.applications set profile=p_profile,status='PENDING',note='' where id=a.id; end if;
    return jsonb_build_object('id',a.id);
  end if;
  if not kiosk_mode then
    if not exists(select 1 from public.users where student_id=sid and role='STUDENT') then
      raise exception 'รหัสนักศึกษาไม่ถูกต้อง กรุณาตรวจสอบ หากมั่นใจว่าถูกต้อง กรุณาติดต่อแอดมิน';
    end if;
    raise exception 'กรุณาใช้บัญชีเดิมยืนยันการสมัคร หรือติดต่อแอดมิน';
  end if;
  select * into person from public.users where student_id=sid;
  if found and (person.role<>'STUDENT' or not kiosk_mode) then raise exception 'กรุณาใช้บัญชีเดิมยืนยันการสมัคร หรือติดต่อแอดมิน'; end if;
  if exists(select 1 from public.event_registrations where event_id=p_event and user_id=person.id) then raise exception 'มีรายชื่อในกิจกรรมแล้ว กรุณาเปิด Event Pass'; end if;
  if exists(select 1 from event_pass_private.applications where event_id=p_event and student_id=sid and status in ('PENDING','CORRECT')) then
    raise exception 'มีใบสมัครรออยู่แล้ว กรุณากลับไปยังหน้ารอเดิมหรือติดต่อแอดมิน'; end if;
  insert into event_pass_private.applications(event_id,student_id,profile,kiosk,receipt_hash)
    values(p_event,sid,p_profile,kiosk_mode,rh) returning id into new_id;
  return jsonb_build_object('id',new_id,'account_created',false);
end; $$;

notify pgrst,'reload schema';
commit;
