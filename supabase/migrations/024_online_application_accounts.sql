begin;
alter table event_pass_private.applications add column created_user uuid references public.users on delete set null;
alter table event_pass_private.applications add column export_profile jsonb;

create function event_pass_private.snapshot_applicant() returns trigger language plpgsql as $$
begin
  if new.profile ? 'full_name' then
    new.export_profile:=jsonb_build_object('name',concat(new.profile->>'prefix',new.profile->>'full_name'),
      'faculty',new.profile->>'faculty','major',new.profile->>'major','year',new.profile->>'study_year','group',new.profile->>'class_group');
  end if;
  return new;
end; $$;
create trigger snapshot_applicant before insert or update of profile on event_pass_private.applications
for each row execute function event_pass_private.snapshot_applicant();
update event_pass_private.applications set profile=profile where profile ? 'full_name';
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
  if not kiosk_mode then
    insert into public.users(student_id,password_hash,full_name,faculty,major,class_group,study_year,enrollment_year,birth_date,phone,role)
    values(sid,crypt(p_profile->>'birth_date',gen_salt('bf')),concat(p_profile->>'prefix',p_profile->>'full_name'),
      p_profile->>'faculty',p_profile->>'major',p_profile->>'class_group',(p_profile->>'study_year')::int,
      extract(year from now())::int+544-(p_profile->>'study_year')::int,p_profile->>'birth_date',p_profile->>'phone','STUDENT')
    on conflict(student_id) do nothing returning id into person.id;
    if not found then raise exception 'กรุณาใช้บัญชีเดิมยืนยันการสมัคร'; end if;
    update event_pass_private.applications set created_user=person.id,issued=true where id=new_id;
  end if;
  return jsonb_build_object('id',new_id,'account_created',not kiosk_mode);
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
  if p_decision='CORRECT' and not (a.profile ? 'birth_date') then raise exception 'กรุณาแก้ข้อมูลบัญชีเดิม หรือยกเลิกเพื่อให้สมัครใหม่'; end if;
  if p_decision='CORRECT' and length(trim(p_note)) between 1 and 300 then
    update event_pass_private.applications set status='CORRECT',note=trim(p_note) where id=a.id;return;
  end if;
  if p_decision is distinct from 'APPROVE' or a.status<>'PENDING' then raise exception 'กรุณาตรวจสถานะหรือระบุสิ่งที่ต้องแก้ไข'; end if;
  yr:=(a.profile->>'study_year')::int;
  select id,study_year into uid,yr from public.users where student_id=a.student_id and role='STUDENT' for no key update;
  fresh:=false;
  if not found then
    if not (a.profile ? 'birth_date') then raise exception 'ไม่พบบัญชีนักศึกษา'; end if;
    yr:=(a.profile->>'study_year')::int;
  insert into public.users(student_id,password_hash,full_name,faculty,major,class_group,study_year,enrollment_year,birth_date,phone,role)
    values(a.student_id,crypt(a.profile->>'birth_date',gen_salt('bf')),concat(a.profile->>'prefix',trim(a.profile->>'full_name')),a.profile->>'faculty',a.profile->>'major',a.profile->>'class_group',
      yr,extract(year from now())::int+544-yr,a.profile->>'birth_date',a.profile->>'phone','STUDENT')
    on conflict(student_id) do nothing returning id into uid;
    fresh:=found;
    if not fresh then raise exception 'บัญชีเปลี่ยนแปลง กรุณาตรวจสอบอีกครั้ง'; end if;
  end if;
  if uid=a.created_user then
    yr:=(a.profile->>'study_year')::int;
    update public.users set full_name=concat(a.profile->>'prefix',a.profile->>'full_name'),faculty=a.profile->>'faculty',
      major=a.profile->>'major',class_group=a.profile->>'class_group',phone=a.profile->>'phone',
      study_year=yr,enrollment_year=extract(year from now())::int+544-yr,
      birth_date=a.profile->>'birth_date' where id=uid;
  end if;
  if not exists(select 1 from public.event_registrations where event_id=a.event_id and user_id=uid) then
    if yr>1 then
      select id into reserve_id from public.event_passcodes where event_id=a.event_id and is_reserve and assigned_to is null
        order by id limit 1 for update skip locked;
      if not found then raise exception 'กรุณาเติม Passcode สำรองก่อนอนุมัตินักศึกษาปี 2 ขึ้นไป'; end if;
      update public.event_passcodes set assigned_to=uid,assigned_at=now() where id=reserve_id;
    end if;
    insert into public.event_registrations(event_id,user_id,is_walkin,registered_by,passcode_id)
      values(a.event_id,uid,a.kiosk,admin,reserve_id);
  end if;
  update event_pass_private.applications set status='APPROVED',issued=(fresh or a.issued),initial_hash=null,
    profile=case when fresh then jsonb_build_object('birth_user',uid) else '{}'::jsonb end,note='' where id=a.id;
end; $$;

create or replace function public.registration_receipt(p_event uuid,p_receipt text,p_station text default null,p_claim boolean default false)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare a event_pass_private.applications%rowtype; pw text;
begin
  select * into a from event_pass_private.applications where receipt_hash=encode(digest(p_receipt,'sha256'),'hex') and event_id=p_event for update;
  if not found or a.kiosk<>(p_station is not null) or (a.kiosk and not event_pass_private.station_ok(p_event,p_station)) then raise exception 'ไม่พบคำขอหรือเซสชันเครื่องหมดอายุ'; end if;
  if p_claim and a.issued and not a.claimed and a.created_user is not null and a.status in ('PENDING','CORRECT','APPROVED') then
    select u.birth_date into pw from public.users u where u.id=a.created_user and u.password_hash=crypt(u.birth_date,u.password_hash);
    update event_pass_private.applications set claimed=true where id=a.id;
  elsif p_claim and a.status='APPROVED' and a.issued and not a.claimed then
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

create or replace function public.registration_join(p_event uuid,p_token text) returns jsonb language plpgsql security definer
set search_path=public,extensions,pg_temp as $$
declare u public.users%rowtype; e public.events%rowtype;
begin
  select * into e from public.events where id=p_event for share;
  select a.student_id into u.student_id from public.users a join public.app_sessions s on s.user_id=a.id
    where s.token_hash=encode(digest(p_token,'sha256'),'hex') and s.expires_at>now() and a.role='STUDENT';
  if not found then raise exception 'กรุณายืนยันด้วยบัญชีนักศึกษา'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event::text||':'||u.student_id,0));
  select a.* into u from public.users a join public.app_sessions s on s.user_id=a.id where a.role='STUDENT'
    and s.token_hash=encode(digest(p_token,'sha256'),'hex') and s.expires_at>now() for no key update of a;
  if not found then raise exception 'กรุณายืนยันด้วยบัญชีนักศึกษา'; end if;
  if exists(select 1 from public.event_registrations where event_id=p_event and user_id=u.id) then
    return jsonb_build_object('already',true);
  end if;
  if exists(select 1 from event_pass_private.applications where event_id=p_event and student_id=u.student_id and status in ('PENDING','CORRECT')) then
    return jsonb_build_object('pending',true);
  end if;
  if e.id is null or not e.online_registration or e.status='CLOSED' then raise exception 'ปิดรับสมัครออนไลน์แล้ว กรุณาติดต่อจุดหน้างาน'; end if;
  if u.study_year>1 or exists(select 1 from event_pass_private.applications where event_id=p_event and created_user=u.id) then
    insert into event_pass_private.applications(event_id,student_id,kiosk,receipt_hash,profile)
    values(p_event,u.student_id,false,encode(gen_random_bytes(32),'hex'),jsonb_build_object('full_name',u.full_name,'faculty',u.faculty,
      'major',u.major,'class_group',u.class_group,'phone',u.phone,'study_year',u.study_year));
    return jsonb_build_object('pending',true);
  end if;
  insert into public.event_registrations(event_id,user_id) values(p_event,u.id) on conflict(event_id,user_id) do nothing;
  insert into event_pass_private.applications(event_id,student_id,kiosk,receipt_hash,status,profile)
    values(p_event,u.student_id,false,encode(gen_random_bytes(32),'hex'),'APPROVED',jsonb_build_object('full_name',u.full_name,
      'faculty',u.faculty,'major',u.major,'class_group',u.class_group,'study_year',u.study_year));

  return jsonb_build_object('already',false);
end; $$;

create or replace function public.load_workspace(p_session_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_user public.users%rowtype;
begin
  select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
    where s.token_hash=encode(digest(p_session_token,'sha256'),'hex') and s.expires_at>now();
  if not found then return jsonb_build_object('success',false,'message','เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'); end if;
  return jsonb_build_object(
    'success',true,
    'user',jsonb_build_object('id',v_user.id,'student_id',v_user.student_id,'full_name',v_user.full_name,'faculty',v_user.faculty,'major',v_user.major,'class_group',v_user.class_group,'enrollment_year',v_user.enrollment_year,'study_year',v_user.study_year,'phone',v_user.phone,'role',v_user.role),
    'applications',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'event_id',e.id,'title',e.title,'status',a.status,'note',a.note) order by a.created_at)
      from event_pass_private.applications a join public.events e on e.id=a.event_id where v_user.role='STUDENT' and a.student_id=v_user.student_id
      and a.status in ('PENDING','CORRECT') and not exists(select 1 from public.event_registrations r where r.user_id=v_user.id and r.event_id=e.id)),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'location',e.location,'activity_hours',e.activity_hours,'status',e.status,'redirect_url_year1',e.redirect_url_year1,'scan_mode',e.scan_mode,'banner_url',e.banner_url) order by e.created_at desc) from public.events e where v_user.role in ('STAFF','ADMIN') or exists(select 1 from public.event_registrations r where r.event_id=e.id and r.user_id=v_user.id)),'[]'::jsonb),
    'users',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'student_id',u.student_id,'full_name',u.full_name,'faculty',u.faculty,'major',u.major,'class_group',u.class_group,'enrollment_year',u.enrollment_year,'study_year',u.study_year,'birth_date',case when v_user.role='ADMIN' then u.birth_date else null end,'phone',case when v_user.role='ADMIN' or u.id=v_user.id then u.phone else null end,'role',u.role)) from public.users u where v_user.role in ('STAFF','ADMIN') or u.id=v_user.id),'[]'::jsonb),
    'registrations',coalesce((select jsonb_agg(jsonb_build_object('event_id',r.event_id,'user_id',r.user_id,'status',r.status,'passcode',case when v_user.role in ('STAFF','ADMIN') or r.status='COMPLETED' then pc.code else null end,'checkin_at',r.checkin_at,'checkout_at',r.checkout_at,'is_walkin',r.is_walkin,'checked_in_by',r.checked_in_by,'checked_out_by',r.checked_out_by,'checkin_staff_name',checkin_staff.full_name,'checkout_staff_name',checkout_staff.full_name)) from public.event_registrations r left join public.event_passcodes pc on pc.id=r.passcode_id left join public.users checkin_staff on checkin_staff.id=r.checked_in_by left join public.users checkout_staff on checkout_staff.id=r.checked_out_by where v_user.role in ('STAFF','ADMIN') or r.user_id=v_user.id),'[]'::jsonb),
    'passcodes',case when v_user.role in ('STAFF','ADMIN') then coalesce((select jsonb_agg(jsonb_build_object('event_id',p.event_id,'code',p.code,'is_reserve',p.is_reserve,'assigned_to',p.assigned_to)) from public.event_passcodes p),'[]'::jsonb) else '[]'::jsonb end,
    'academic_catalog',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'majors',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name) order by m.name) from public.academic_majors m where m.faculty_id=f.id),'[]'::jsonb)) order by f.name) from public.academic_faculties f),'[]'::jsonb)
  );
end; $$;

create function public.registration_approve_many(p_token text,p_event uuid,p_ids uuid[]) returns void
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare item uuid;
begin
  if event_pass_private.admin_id(p_token) is null then raise exception 'กรุณาเข้าสู่ระบบแอดมิน'; end if;
  for item in select distinct unnest(p_ids) order by 1 loop
    if not exists(select 1 from event_pass_private.applications where id=item and event_id=p_event) then raise exception 'ใบสมัครไม่ตรงกับกิจกรรม'; end if;
    perform public.registration_review(p_token,item,'APPROVE');
  end loop;
end; $$;
create function public.registration_export(p_token text,p_event uuid) returns jsonb
language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
begin
  if event_pass_private.admin_id(p_token) is null then raise exception 'กรุณาเข้าสู่ระบบแอดมิน'; end if;
  return coalesce((select jsonb_agg(jsonb_build_array(a.student_id,coalesce(a.export_profile->>'name',u.full_name),
    coalesce(a.export_profile->>'faculty',u.faculty),coalesce(a.export_profile->>'major',u.major),
    coalesce(a.export_profile->>'year',u.study_year::text),coalesce(a.export_profile->>'group',u.class_group),
    case when a.kiosk then 'หน้างาน' else 'ออนไลน์' end,
    case a.status when 'PENDING' then 'รอยืนยัน' when 'APPROVED' then 'อนุมัติแล้ว' when 'CORRECT' then 'รอแก้ไข' else 'ยกเลิก' end,
    a.created_at) order by a.created_at,a.id) from event_pass_private.applications a left join public.users u on u.student_id=a.student_id
    where a.event_id=p_event),'[]'::jsonb);
end; $$;
revoke all on function public.registration_approve_many(text,uuid,uuid[]),public.registration_export(text,uuid) from public;
grant execute on function public.registration_approve_many(text,uuid,uuid[]),public.registration_export(text,uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
