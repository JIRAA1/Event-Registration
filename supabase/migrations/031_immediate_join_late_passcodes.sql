begin;
alter table public.event_registrations add column checkin_station boolean not null default false;

create function event_pass_private.match_waiting_passcodes(p_event uuid) returns int
language plpgsql set search_path=public,pg_temp as $$
declare r record; code_id uuid; matched int:=0;
begin
  for r in select reg.id,reg.user_id from public.event_registrations reg join public.users u on u.id=reg.user_id
    where reg.event_id=p_event and reg.passcode_id is null and u.role='STUDENT' and u.study_year>1
    order by reg.id for update of reg skip locked
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

create function public.admin_match_waiting_passcodes(p_token text,p_event uuid) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
begin
  if event_pass_private.admin_id(p_token) is null then raise exception 'กรุณาเข้าสู่ระบบแอดมิน'; end if;
  return jsonb_build_object('matched_count',event_pass_private.match_waiting_passcodes(p_event));
end; $$;

create function public.registration_station_checkin(p_station text,p_event uuid,p_student_id text,p_password text) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare u public.users%rowtype; r public.event_registrations%rowtype;
begin
  if not event_pass_private.station_ok(p_event,p_station) then raise exception 'เซสชันเครื่องหมดอายุ กรุณาเข้าสู่ระบบเครื่องใหม่'; end if;
  perform 1 from public.events where id=p_event and status='ACTIVE' for share;
  if not found then raise exception 'กิจกรรมไม่เปิดให้เช็กอิน'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event::text||':'||event_pass_private.student_number(p_student_id),0));
  select * into u from public.users where student_id=event_pass_private.student_number(p_student_id) and role='STUDENT' for update;
  if not found or crypt(p_password,u.password_hash) is distinct from u.password_hash or p_password is null then
    raise exception 'รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
  end if;

  insert into public.event_registrations(event_id,user_id,is_walkin) values(p_event,u.id,true)
    on conflict(event_id,user_id) do nothing;
  select * into r from public.event_registrations where event_id=p_event and user_id=u.id for update;
  if r.status='REGISTERED' then
    update public.event_registrations set status='ATTENDING',checkin_at=now(),checkin_station=true,updated_at=now()
      where id=r.id returning * into r;
  end if;
  update event_pass_private.applications set status='APPROVED',profile='{}',note=''
    where event_id=p_event and student_id=u.student_id and status in ('PENDING','CORRECT');
  return jsonb_build_object('student_id',u.student_id,'full_name',u.full_name,'status',r.status);
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
  if e.id is null or not e.online_registration or e.status='CLOSED' then raise exception 'ปิดรับสมัครออนไลน์แล้ว กรุณาติดต่อจุดหน้างาน'; end if;
  insert into public.event_registrations(event_id,user_id) values(p_event,u.id) on conflict(event_id,user_id) do nothing;
  update event_pass_private.applications set status='APPROVED',profile='{}',note='' where event_id=p_event and student_id=u.student_id and status in ('PENDING','CORRECT');
  if not found then
    insert into event_pass_private.applications(event_id,student_id,kiosk,receipt_hash,status,profile)
      values(p_event,u.student_id,false,encode(gen_random_bytes(32),'hex'),'APPROVED',jsonb_build_object('full_name',u.full_name,
      'faculty',u.faculty,'major',u.major,'class_group',u.class_group,'study_year',u.study_year));
  end if;
  return jsonb_build_object('already',false);
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

      update public.event_passcodes set assigned_to=uid,assigned_at=now() where id=reserve_id;
    end if;
    insert into public.event_registrations(event_id,user_id,is_walkin,registered_by,passcode_id)
      values(a.event_id,uid,a.kiosk,admin,reserve_id);
  end if;
  update event_pass_private.applications set status='APPROVED',issued=(fresh or a.issued),initial_hash=null,
    profile=case when fresh then jsonb_build_object('birth_user',uid) else '{}'::jsonb end,note='' where id=a.id;
end; $$;

create or replace function public.admin_add_reserve_passcodes(p_admin_token text,p_event_id uuid,p_codes text[])
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_role text; v_code text; v_added int := 0;
begin
  select u.role into v_role from public.app_sessions s join public.users u on u.id=s.user_id
    where s.token_hash=encode(digest(p_admin_token,'sha256'),'hex') and s.expires_at>now();
  if coalesce(v_role,'') <> 'ADMIN' then return jsonb_build_object('success',false,'message','สงวนสิทธิ์เฉพาะแอดมิน'); end if;
  foreach v_code in array coalesce(p_codes,'{}'::text[]) loop
    if length(trim(v_code)) > 0 then
      insert into public.event_passcodes(event_id,code,is_reserve) values(p_event_id,trim(v_code),true)
      on conflict(event_id,code) do nothing;
      if found then v_added := v_added + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('success',true,'added_count',v_added,'matched_count',event_pass_private.match_waiting_passcodes(p_event_id));
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
    'users',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'student_id',u.student_id,'full_name',u.full_name,'faculty',u.faculty,'major',u.major,'class_group',u.class_group,'enrollment_year',u.enrollment_year,'study_year',u.study_year,'birth_date',case when v_user.role='ADMIN' then u.birth_date else null end,'phone',case when v_user.role='ADMIN' or u.id=v_user.id then u.phone else null end,'role',u.role)) from public.users u where (v_user.role='ADMIN') or (v_user.role='STAFF' and u.role in ('STAFF','ADMIN')) or (u.id=v_user.id)),'[]'::jsonb),
    'registrations',coalesce((select jsonb_agg(jsonb_build_object('event_id',r.event_id,'user_id',r.user_id,'status',r.status,'passcode',case when v_user.role in ('STAFF','ADMIN') or r.status='COMPLETED' then pc.code else null end,'checkin_at',r.checkin_at,'checkout_at',r.checkout_at,'is_walkin',r.is_walkin,'checkin_station',r.checkin_station,'checked_in_by',r.checked_in_by,'checked_out_by',r.checked_out_by,'checkin_staff_name',checkin_staff.full_name,'checkout_staff_name',checkout_staff.full_name)) from public.event_registrations r left join public.event_passcodes pc on pc.id=r.passcode_id left join public.users checkin_staff on checkin_staff.id=r.checked_in_by left join public.users checkout_staff on checkout_staff.id=r.checked_out_by where v_user.role in ('STAFF','ADMIN') or r.user_id=v_user.id),'[]'::jsonb),
    'passcodes',case when v_user.role in ('STAFF','ADMIN') then coalesce((select jsonb_agg(jsonb_build_object('event_id',p.event_id,'code',p.code,'is_reserve',p.is_reserve,'assigned_to',p.assigned_to)) from public.event_passcodes p),'[]'::jsonb) else '[]'::jsonb end,
    'academic_catalog',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'majors',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name) order by m.name) from public.academic_majors m where m.faculty_id=f.id),'[]'::jsonb)) order by f.name) from public.academic_faculties f),'[]'::jsonb)
  );
end; $$;

revoke all on function public.load_workspace(text) from public;
grant execute on function public.load_workspace(text) to anon, authenticated;


-- Existing online requests backed by an account can enter the normal registration flow.
insert into public.event_registrations(event_id,user_id)
select a.event_id,u.id from event_pass_private.applications a join public.users u on u.student_id=a.student_id and u.role='STUDENT'
join public.events e on e.id=a.event_id and e.status<>'CLOSED'
where not a.kiosk and a.status='PENDING' on conflict(event_id,user_id) do nothing;
update event_pass_private.applications a set status='APPROVED',profile='{}',note=''
where not a.kiosk and a.status='PENDING' and exists(
  select 1 from public.users u join public.event_registrations r on r.user_id=u.id
  where u.student_id=a.student_id and r.event_id=a.event_id);

revoke all on function public.admin_match_waiting_passcodes(text,uuid),public.registration_station_checkin(text,uuid,text,text) from public;
grant execute on function public.admin_match_waiting_passcodes(text,uuid),public.registration_station_checkin(text,uuid,text,text) to anon,authenticated;
-- Imports take the student's current study year directly. Admission year is
-- retained internally only because the users table still stores that value.
create or replace function public.admin_import_event_students(
  p_admin_token text,
  p_event_id uuid,
  p_students jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_student jsonb;
  v_admin_id uuid;
  v_user_id uuid;
  v_registration_id uuid;
  v_passcode_id uuid;
  v_student_id varchar(20);
  v_full_name varchar(255);
  v_faculty varchar(150);
  v_major varchar(150);
  v_class_group varchar(50);
  v_enrollment_year int;
  v_study_year int;
  v_birth_date varchar(8);
  v_phone varchar(20);
  v_existing_role varchar(20);
  v_imported_count int := 0;
  v_skipped_count int := 0;
  v_passcodes_assigned_count int := 0;
begin
  select u.id into v_admin_id
  from public.app_sessions s join public.users u on u.id = s.user_id
  where s.token_hash = encode(digest(p_admin_token, 'sha256'), 'hex')
    and s.expires_at > now() and u.role = 'ADMIN';
  if v_admin_id is null then
    return jsonb_build_object('success',false,'error_code','FORBIDDEN','message','สงวนสิทธิ์เฉพาะแอดมิน');
  end if;
  if jsonb_typeof(p_students) <> 'array' then
    return jsonb_build_object('success',false,'error_code','INVALID_INPUT','message','รูปแบบรายชื่อ CSV ไม่ถูกต้อง');
  end if;
  if not exists(select 1 from public.events where id = p_event_id) then
    return jsonb_build_object('success',false,'error_code','EVENT_NOT_FOUND','message','ไม่พบกิจกรรมนี้');
  end if;

  begin
    for v_student in select value from jsonb_array_elements(p_students) loop
      v_student_id := nullif(trim(v_student->>'student_id'), '');
      v_full_name := nullif(trim(v_student->>'full_name'), '');
      v_faculty := nullif(trim(v_student->>'faculty'), '');
      v_major := nullif(trim(v_student->>'major'), '');
      v_class_group := nullif(trim(v_student->>'class_group'), '');
      v_study_year := nullif(trim(v_student->>'study_year'), '')::int;
      v_birth_date := nullif(trim(v_student->>'birth_date'), '');
      v_phone := nullif(trim(v_student->>'phone'), '');

      if v_student_id is null or v_full_name is null or v_birth_date is null then
        raise exception 'กรุณาระบุ student_id, full_name, study_year และ birth_date ให้ครบทุกแถว';
      end if;
      if v_study_year is null or v_study_year < 1 or v_study_year > 8 then
        raise exception 'ชั้นปีที่กำลังศึกษาต้องอยู่ระหว่างปี 1 ถึงปี 8';
      end if;

      select role into v_existing_role from public.users where student_id = v_student_id for update;
      if v_existing_role is not null and v_existing_role <> 'STUDENT' then
        raise exception 'รหัสผู้ใช้ % เป็นบัญชีเจ้าหน้าที่ ไม่สามารถนำเข้าเป็นนักศึกษาได้', v_student_id;
      end if;
      if exists(
        select 1 from public.users u join public.event_registrations r on r.user_id = u.id
        where u.student_id = v_student_id and r.event_id = p_event_id
      ) then
        v_skipped_count := v_skipped_count + 1;
        continue;
      end if;

      v_enrollment_year := extract(year from now())::int + 543 - v_study_year + 1;
      insert into public.users(student_id,password_hash,full_name,faculty,major,class_group,enrollment_year,study_year,birth_date,phone,role)
      values(v_student_id,crypt(v_birth_date,gen_salt('bf')),v_full_name,v_faculty,v_major,v_class_group,v_enrollment_year,v_study_year,v_birth_date,v_phone,'STUDENT')
      on conflict(student_id) do update set
        full_name=excluded.full_name,faculty=excluded.faculty,major=excluded.major,
        class_group=excluded.class_group,enrollment_year=excluded.enrollment_year,
        study_year=excluded.study_year,birth_date=excluded.birth_date,phone=excluded.phone
      returning id into v_user_id;

      v_passcode_id := null;
      if v_study_year > 1 then
        select id into v_passcode_id
        from public.event_passcodes
        where event_id=p_event_id and is_reserve=true and assigned_to is null
        order by id limit 1 for update skip locked;

        update public.event_passcodes set assigned_to=v_user_id,assigned_at=now() where id=v_passcode_id;
      end if;

      v_registration_id := null;
      insert into public.event_registrations(event_id,user_id,passcode_id,status,is_walkin,registered_by)
      values(p_event_id,v_user_id,v_passcode_id,'REGISTERED',false,v_admin_id)
      on conflict(event_id,user_id) do nothing
      returning id into v_registration_id;

      if v_registration_id is null then
        if v_passcode_id is not null then
          update public.event_passcodes set assigned_to=null,assigned_at=null where id=v_passcode_id and assigned_to=v_user_id;
        end if;
        v_skipped_count := v_skipped_count + 1;
        continue;
      end if;
      v_imported_count := v_imported_count + 1;
      if v_passcode_id is not null then v_passcodes_assigned_count := v_passcodes_assigned_count + 1; end if;
    end loop;
  exception when others then
    return jsonb_build_object('success',false,'error_code','IMPORT_FAILED','message',sqlerrm);
  end;

  return jsonb_build_object(
    'success',true,
    'imported_count',v_imported_count,
    'skipped_count',v_skipped_count,
    'passcodes_assigned_count',v_passcodes_assigned_count
  );
end;
$$;

create or replace function public.register_walkin_student(
  p_event_id uuid, p_session_token text, p_student_id varchar, p_full_name varchar,
  p_faculty varchar, p_major varchar, p_class_group varchar, p_enrollment_year int,
  p_birth_date varchar, p_phone varchar, p_study_year int
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid;
  v_staff_id uuid;
  v_passcode_id uuid;
  v_code varchar;
begin
  select u.id into v_staff_id
  from public.app_sessions s join public.users u on u.id = s.user_id
  where s.token_hash = encode(digest(p_session_token, 'sha256'), 'hex')
    and s.expires_at > now() and u.role in ('STAFF','ADMIN');
  if v_staff_id is null then
    return jsonb_build_object('success',false,'error_code','FORBIDDEN','message','บัญชีนี้ไม่มีสิทธิ์เพิ่มรายชื่อ');
  end if;
  if p_study_year is null or p_study_year < 1 or p_study_year > 8 then
    return jsonb_build_object('success',false,'error_code','INVALID_STUDY_YEAR','message','กรุณาระบุชั้นปีที่กำลังศึกษา');
  end if;

  if p_study_year > 1 then
    select id,code into v_passcode_id,v_code
    from public.event_passcodes
    where event_id = p_event_id and is_reserve = true and assigned_to is null
    order by id limit 1 for update skip locked;

  end if;

  insert into public.users(student_id,password_hash,full_name,faculty,major,class_group,enrollment_year,study_year,birth_date,phone,role)
  values(p_student_id,crypt(p_birth_date,gen_salt('bf')),p_full_name,p_faculty,p_major,p_class_group,p_enrollment_year,p_study_year,p_birth_date,p_phone,'STUDENT')
  on conflict(student_id) do update set
    full_name=excluded.full_name,faculty=excluded.faculty,major=excluded.major,
    class_group=excluded.class_group,enrollment_year=excluded.enrollment_year,
    study_year=excluded.study_year,birth_date=excluded.birth_date,phone=excluded.phone
  returning id into v_user_id;

  if exists(select 1 from public.event_registrations where event_id=p_event_id and user_id=v_user_id) then
    return jsonb_build_object('success',false,'error_code','ALREADY_REGISTERED','message','รหัสนักศึกษานี้มีชื่อในกิจกรรมแล้ว');
  end if;
  if v_passcode_id is not null then
    update public.event_passcodes set assigned_to=v_user_id,assigned_at=now() where id=v_passcode_id;
  end if;
  insert into public.event_registrations(event_id,user_id,passcode_id,status,is_walkin,registered_by)
  values(p_event_id,v_user_id,v_passcode_id,'REGISTERED',true,v_staff_id);
  return jsonb_build_object('success',true,'user_id',v_user_id,'passcode_assigned',v_passcode_id is not null,'passcode_preview',coalesce(v_code,'REDIRECT_URL_YEAR1'));
exception when unique_violation then
  return jsonb_build_object('success',false,'error_code','ALREADY_REGISTERED','message','รหัสนักศึกษานี้มีชื่อในกิจกรรมแล้ว');
end;
$$;

notify pgrst,'reload schema';
commit;
