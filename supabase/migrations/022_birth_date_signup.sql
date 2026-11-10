begin;
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
  if jsonb_typeof(p_profile) is distinct from 'object' or pg_column_size(p_profile)>8192 or sid is null or sid !~ '^[0-9]{7,8}$' or length(trim(coalesce(p_profile->>'full_name',''))) not between 2 and 255
    or coalesce(p_profile->>'class_group','') not in ('1','2','3','4')
    or coalesce(p_profile->>'prefix','') not in ('นาย','นางสาว')
    or length(concat(p_profile->>'prefix',trim(p_profile->>'full_name')))>255 or coalesce(p_profile->>'study_year','') !~ '^[1-8]$'
    or coalesce(p_profile->>'birth_date','') !~ '^[0-9]{8}$' or coalesce(p_profile->>'phone','') !~ '^0[0-9]{9}$'
    or not exists(select 1 from public.academic_faculties f join public.academic_majors m on m.faculty_id=f.id where f.name=p_profile->>'faculty' and m.name=p_profile->>'major')
    then raise exception 'กรุณาตรวจรหัสนักศึกษา ชื่อ คณะ สาขา หมู่เรียน ชั้นปี วันเกิด และเบอร์โทร'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event::text||':'||sid,0));
  p_profile:=jsonb_build_object('student_id',sid,'prefix',p_profile->>'prefix','full_name',trim(p_profile->>'full_name'),'class_group',trim(p_profile->>'class_group'),
    'faculty',p_profile->>'faculty','major',p_profile->>'major','birth_date',p_profile->>'birth_date','phone',p_profile->>'phone','study_year',p_profile->>'study_year');
  select * into a from event_pass_private.applications where receipt_hash=rh for update;
  if found then
    if a.student_id<>sid or a.event_id<>p_event or a.kiosk<>kiosk_mode then raise exception 'ใบสมัครไม่ตรงกับคำขอเดิม'; end if;
    if a.status='CORRECT' then update event_pass_private.applications set profile=p_profile,status='PENDING',note='' where id=a.id; end if;
    return jsonb_build_object('id',a.id);
  end if;
  select * into person from public.users where student_id=sid;
  if found and (person.role<>'STUDENT' or not kiosk_mode) then raise exception 'กรุณาใช้บัญชีเดิมยืนยันการสมัคร หรือติดต่อแอดมิน'; end if;
  if exists(select 1 from public.event_registrations where event_id=p_event and user_id=person.id) then raise exception 'มีรายชื่อในกิจกรรมแล้ว กรุณาเปิด Event Pass'; end if;
  if exists(select 1 from event_pass_private.applications where event_id=p_event and student_id=sid and status in ('PENDING','CORRECT')) then
    raise exception 'มีใบสมัครรออยู่แล้ว กรุณากลับไปยังหน้ารอเดิมหรือติดต่อแอดมิน'; end if;
  insert into event_pass_private.applications(event_id,student_id,profile,kiosk,receipt_hash)
    values(p_event,sid,p_profile,kiosk_mode,rh) returning id into new_id;
  return jsonb_build_object('id',new_id);
end; $$;

create or replace function public.registration_review(p_token text,p_id uuid,p_decision text,p_note text default '') returns void
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare a event_pass_private.applications%rowtype; uid uuid; fresh boolean; yr int; reserve_id uuid; admin uuid:=event_pass_private.admin_id(p_token);
begin
  if admin is null then raise exception 'สงวนสิทธิ์เฉพาะแอดมิน'; end if;
  select * into a from event_pass_private.applications where id=p_id;
  if not found then raise exception 'ไม่พบคำขอ'; end if;
  perform 1 from public.events where id=a.event_id and (status<>'CLOSED' or p_decision='CANCEL') for share;
  if not found then raise exception 'กิจกรรมปิดแล้ว'; end if;
  perform pg_advisory_xact_lock(hashtextextended(a.event_id::text||':'||a.student_id,0));
  select * into a from event_pass_private.applications where id=p_id for update;
  if a.status='APPROVED' then return; end if;
  if a.status not in ('PENDING','CORRECT') then raise exception 'คำขอสิ้นสุดแล้ว'; end if;
  if p_decision='CANCEL' then
    update event_pass_private.applications set status='CANCELLED',profile='{}',initial_hash=null where id=a.id;return;
  end if;
  if p_decision='CORRECT' and length(trim(p_note)) between 1 and 300 then
    update event_pass_private.applications set status='CORRECT',note=trim(p_note) where id=a.id;return;
  end if;
  if p_decision is distinct from 'APPROVE' or a.status<>'PENDING' then raise exception 'กรุณาตรวจสถานะหรือระบุสิ่งที่ต้องแก้ไข'; end if;
  yr:=(a.profile->>'study_year')::int;
  insert into public.users(student_id,password_hash,full_name,faculty,major,class_group,study_year,enrollment_year,birth_date,phone,role)
    values(a.student_id,crypt(a.profile->>'birth_date',gen_salt('bf')),concat(a.profile->>'prefix',trim(a.profile->>'full_name')),a.profile->>'faculty',a.profile->>'major',a.profile->>'class_group',
      yr,extract(year from now())::int+544-yr,a.profile->>'birth_date',a.profile->>'phone','STUDENT')
    on conflict(student_id) do nothing returning id into uid;
  fresh:=found;
  if not fresh then
    select id,study_year into uid,yr from public.users where student_id=a.student_id and role='STUDENT' for no key update;
    if not found then raise exception 'รหัสนี้ใช้กับบัญชีเจ้าหน้าที่'; end if;
  end if;
  if not exists(select 1 from public.event_registrations where event_id=a.event_id and user_id=uid) then
    if a.kiosk and yr>1 then
      select id into reserve_id from public.event_passcodes where event_id=a.event_id and is_reserve and assigned_to is null
        order by id limit 1 for update skip locked;
      if not found then raise exception 'กรุณาเติม Passcode สำรองก่อนอนุมัตินักศึกษาหน้างานปี 2 ขึ้นไป'; end if;
      update public.event_passcodes set assigned_to=uid,assigned_at=now() where id=reserve_id;
    end if;
    insert into public.event_registrations(event_id,user_id,is_walkin,registered_by,passcode_id)
      values(a.event_id,uid,a.kiosk,admin,reserve_id);
  end if;
  update event_pass_private.applications set status='APPROVED',issued=fresh,initial_hash=null,
    profile=case when fresh then jsonb_build_object('birth_user',uid) else '{}'::jsonb end,note='' where id=a.id;
end; $$;

create or replace function public.registration_receipt(p_event uuid,p_receipt text,p_station text default null,p_claim boolean default false)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare a event_pass_private.applications%rowtype; pw text;
begin
  select * into a from event_pass_private.applications where receipt_hash=encode(digest(p_receipt,'sha256'),'hex') and event_id=p_event for update;
  if not found or a.kiosk<>(p_station is not null) or (a.kiosk and not event_pass_private.station_ok(p_event,p_station)) then raise exception 'ไม่พบคำขอหรือเซสชันเครื่องหมดอายุ'; end if;
  if p_claim and a.status='APPROVED' and a.issued and not a.claimed then
    if a.profile ? 'birth_user' then
      select u.birth_date into pw from public.users u where u.id=(a.profile->>'birth_user')::uuid
        and u.password_hash=crypt(u.birth_date,u.password_hash);
    else
      -- Receipts approved under migration 021 must still show their original credential.
      select substr(encode(hmac(convert_to(p_receipt,'UTF8'),issue_key,'sha256'),'hex'),1,20) into pw from event_pass_private.registration_settings;
    end if;
    update event_pass_private.applications set claimed=true,profile='{}' where id=a.id;
  end if;
  return jsonb_build_object('id',a.id,'status',a.status,'student_id',a.student_id,'note',a.note,'issued',a.issued,'claimed',a.claimed,
    'password',pw,'profile',case when a.status='CORRECT' then a.profile end);
end; $$;

notify pgrst,'reload schema';
commit;
