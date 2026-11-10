begin;
create function event_pass_private.application_profile(p_profile jsonb) returns jsonb
language plpgsql stable set search_path=public,pg_temp as $$
declare sid text:=event_pass_private.student_number(p_profile->>'student_id');
begin
  if jsonb_typeof(p_profile) is distinct from 'object' or pg_column_size(p_profile)>8192 or sid is null or sid !~ '^[0-9]{7,8}$' or length(trim(coalesce(p_profile->>'full_name',''))) not between 2 and 255
    or coalesce(p_profile->>'class_group','') not in ('1','2','3','4')
    or coalesce(p_profile->>'prefix','') not in ('นาย','นางสาว')
    or length(concat(p_profile->>'prefix',trim(p_profile->>'full_name')))>255 or coalesce(p_profile->>'study_year','') !~ '^[1-8]$'
    or coalesce(p_profile->>'birth_date','') !~ '^[0-9]{8}$' or coalesce(p_profile->>'phone','') !~ '^0[0-9]{9}$'
    or not exists(select 1 from public.academic_faculties f join public.academic_majors m on m.faculty_id=f.id where f.name=p_profile->>'faculty' and m.name=p_profile->>'major')
    then raise exception 'กรุณาตรวจรหัสนักศึกษา ชื่อ คณะ สาขา หมู่เรียน ชั้นปี วันเกิด และเบอร์โทร'; end if;
  return jsonb_build_object('student_id',sid,'prefix',p_profile->>'prefix','full_name',trim(p_profile->>'full_name'),'class_group',trim(p_profile->>'class_group'),
    'faculty',p_profile->>'faculty','major',p_profile->>'major','birth_date',p_profile->>'birth_date','phone',p_profile->>'phone','study_year',p_profile->>'study_year');
end; $$;

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
    'applications',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'event_id',e.id,'title',e.title,'online',not a.kiosk,'status',a.status,'note',a.note) order by a.created_at)
      from event_pass_private.applications a join public.events e on e.id=a.event_id where v_user.role='STUDENT' and a.student_id=v_user.student_id
      and a.status in ('PENDING','CORRECT') and not exists(select 1 from public.event_registrations r where r.user_id=v_user.id and r.event_id=e.id)),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'location',e.location,'activity_hours',e.activity_hours,'status',e.status,'redirect_url_year1',e.redirect_url_year1,'scan_mode',e.scan_mode,'banner_url',e.banner_url) order by e.created_at desc) from public.events e where v_user.role in ('STAFF','ADMIN') or exists(select 1 from public.event_registrations r where r.event_id=e.id and r.user_id=v_user.id)),'[]'::jsonb),
    'users',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'student_id',u.student_id,'full_name',u.full_name,'faculty',u.faculty,'major',u.major,'class_group',u.class_group,'enrollment_year',u.enrollment_year,'study_year',u.study_year,'birth_date',case when v_user.role='ADMIN' then u.birth_date else null end,'phone',case when v_user.role='ADMIN' or u.id=v_user.id then u.phone else null end,'role',u.role)) from public.users u where v_user.role in ('STAFF','ADMIN') or u.id=v_user.id),'[]'::jsonb),
    'registrations',coalesce((select jsonb_agg(jsonb_build_object('event_id',r.event_id,'user_id',r.user_id,'status',r.status,'passcode',case when v_user.role in ('STAFF','ADMIN') or r.status='COMPLETED' then pc.code else null end,'checkin_at',r.checkin_at,'checkout_at',r.checkout_at,'is_walkin',r.is_walkin,'checked_in_by',r.checked_in_by,'checked_out_by',r.checked_out_by,'checkin_staff_name',checkin_staff.full_name,'checkout_staff_name',checkout_staff.full_name)) from public.event_registrations r left join public.event_passcodes pc on pc.id=r.passcode_id left join public.users checkin_staff on checkin_staff.id=r.checked_in_by left join public.users checkout_staff on checkout_staff.id=r.checked_out_by where v_user.role in ('STAFF','ADMIN') or r.user_id=v_user.id),'[]'::jsonb),
    'passcodes',case when v_user.role in ('STAFF','ADMIN') then coalesce((select jsonb_agg(jsonb_build_object('event_id',p.event_id,'code',p.code,'is_reserve',p.is_reserve,'assigned_to',p.assigned_to)) from public.event_passcodes p),'[]'::jsonb) else '[]'::jsonb end,
    'academic_catalog',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'majors',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name) order by m.name) from public.academic_majors m where m.faculty_id=f.id),'[]'::jsonb)) order by f.name) from public.academic_faculties f),'[]'::jsonb)
  );
end; $$;

create function public.registration_correction(p_token text,p_event uuid,p_id uuid,p_profile jsonb default null) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare a event_pass_private.applications%rowtype;
begin
  perform 1 from public.events where id=p_event and status<>'CLOSED' for share;
  if not found then raise exception 'กิจกรรมปิดแล้ว'; end if;
  select app.* into a from event_pass_private.applications app
    join public.users u on u.student_id=app.student_id and (app.created_user is null or app.created_user=u.id)
    join public.app_sessions s on s.user_id=u.id
    where app.id=p_id and app.event_id=p_event and not app.kiosk and u.role='STUDENT'
      and s.expires_at>now() and s.token_hash=encode(digest(p_token,'sha256'),'hex') for update of app;
  if not found then raise exception 'กรุณาเข้าสู่ระบบด้วยบัญชีเจ้าของใบสมัคร'; end if;
  if a.status<>'CORRECT' then raise exception 'สถานะใบสมัครเปลี่ยนแล้ว กรุณากลับไปตรวจสอบหน้า Event Pass'; end if;
  if p_profile is null then return jsonb_build_object('profile',a.profile,'note',a.note); end if;
  p_profile:=event_pass_private.application_profile(p_profile);
  if p_profile->>'student_id'<>a.student_id then raise exception 'รหัสนักศึกษาไม่ตรงกับใบสมัคร'; end if;
  update event_pass_private.applications set profile=p_profile,note='',status='PENDING' where id=a.id;
  return jsonb_build_object('status','PENDING');
end; $$;
revoke all on function public.registration_correction(text,uuid,uuid,jsonb) from public;
grant execute on function public.registration_correction(text,uuid,uuid,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
