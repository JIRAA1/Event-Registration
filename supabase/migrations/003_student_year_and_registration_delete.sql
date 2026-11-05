-- Store the student's current study year separately from admission year.
alter table public.users
  add column if not exists study_year int not null default 0;

update public.users
set study_year = greatest(1, least(8, extract(year from now())::int + 544 - enrollment_year))
where role = 'STUDENT' and study_year = 0;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'users_study_year_range_check'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_study_year_range_check check (study_year between 0 and 8);
  end if;
end $$;

create or replace function public.login_student(p_student_id varchar, p_password varchar)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_user public.users%rowtype; v_token text;
begin
  select * into v_user from public.users where student_id = p_student_id;
  if not found or v_user.password_hash <> crypt(p_password, v_user.password_hash) then
    return jsonb_build_object('success', false, 'message', 'รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  end if;
  v_token := encode(gen_random_bytes(32),'hex');
  insert into public.app_sessions(user_id,token_hash,expires_at)
    values(v_user.id,encode(digest(v_token,'sha256'),'hex'),now()+interval '12 hours');
  return jsonb_build_object('success', true, 'user', jsonb_build_object(
    'id',v_user.id,'student_id',v_user.student_id,'full_name',v_user.full_name,
    'faculty',v_user.faculty,'major',v_user.major,'class_group',v_user.class_group,
    'enrollment_year',v_user.enrollment_year,'study_year',v_user.study_year,'role',v_user.role),'session_token',v_token);
end; $$;

drop function if exists public.register_walkin_student(uuid,text,varchar,varchar,varchar,varchar,varchar,int,varchar,varchar);
create or replace function public.register_walkin_student(
  p_event_id uuid, p_session_token text, p_student_id varchar, p_full_name varchar,
  p_faculty varchar, p_major varchar, p_class_group varchar, p_enrollment_year int,
  p_birth_date varchar, p_phone varchar, p_study_year int
) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_user_id uuid; v_staff_id uuid; v_passcode_id uuid; v_code varchar; v_passcode boolean := p_enrollment_year <= 2568;
begin
  select u.id into v_staff_id from public.app_sessions s join public.users u on u.id=s.user_id
    where s.token_hash=encode(digest(p_session_token,'sha256'),'hex') and s.expires_at>now() and u.role in ('STAFF','ADMIN');
  if v_staff_id is null then
    return jsonb_build_object('success',false,'error_code','FORBIDDEN','message','บัญชีนี้ไม่มีสิทธิ์เพิ่มรายชื่อ');
  end if;
  if p_study_year is null or p_study_year < 1 or p_study_year > 8 then
    return jsonb_build_object('success',false,'error_code','INVALID_STUDY_YEAR','message','กรุณาระบุชั้นปีที่กำลังศึกษา');
  end if;
  if v_passcode then
    select id,code into v_passcode_id,v_code from public.event_passcodes
      where event_id=p_event_id and is_reserve=true and assigned_to is null
      order by id limit 1 for update skip locked;
    if v_passcode_id is null then return jsonb_build_object('success',false,'error_code','OUT_OF_PASSCODE','message','Passcode สำรองหมดแล้ว'); end if;
  end if;
  insert into public.users(student_id,password_hash,full_name,faculty,major,class_group,enrollment_year,study_year,birth_date,phone,role)
    values(p_student_id,crypt(p_birth_date,gen_salt('bf')),p_full_name,p_faculty,p_major,p_class_group,p_enrollment_year,p_study_year,p_birth_date,p_phone,'STUDENT')
    on conflict(student_id) do update set full_name=excluded.full_name,faculty=excluded.faculty,major=excluded.major,
    class_group=excluded.class_group,enrollment_year=excluded.enrollment_year,study_year=excluded.study_year,birth_date=excluded.birth_date,phone=excluded.phone
    returning id into v_user_id;
  if exists(select 1 from public.event_registrations where event_id=p_event_id and user_id=v_user_id) then
    return jsonb_build_object('success',false,'error_code','ALREADY_REGISTERED','message','รหัสนักศึกษานี้มีชื่อในกิจกรรมแล้ว');
  end if;
  if v_passcode_id is not null then update public.event_passcodes set assigned_to=v_user_id,assigned_at=now() where id=v_passcode_id; end if;
  insert into public.event_registrations(event_id,user_id,passcode_id,status,is_walkin,registered_by)
    values(p_event_id,v_user_id,v_passcode_id,'REGISTERED',true,v_staff_id);
  return jsonb_build_object('success',true,'user_id',v_user_id,'passcode_assigned',v_passcode_id is not null,'passcode_preview',coalesce(v_code,'REDIRECT_URL_YEAR1'));
exception when unique_violation then
  return jsonb_build_object('success',false,'error_code','ALREADY_REGISTERED','message','รหัสนักศึกษานี้มีชื่อในกิจกรรมแล้ว');
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
    'user',jsonb_build_object('id',v_user.id,'student_id',v_user.student_id,'full_name',v_user.full_name,'faculty',v_user.faculty,'major',v_user.major,'class_group',v_user.class_group,'enrollment_year',v_user.enrollment_year,'study_year',v_user.study_year,'role',v_user.role),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'location',e.location,'activity_hours',e.activity_hours,'status',e.status,'redirect_url_year1',e.redirect_url_year1,'scan_mode',e.scan_mode) order by e.created_at desc)
      from public.events e where v_user.role in ('STAFF','ADMIN') or exists(select 1 from public.event_registrations r where r.event_id=e.id and r.user_id=v_user.id)),'[]'::jsonb),
    'users',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'student_id',u.student_id,'full_name',u.full_name,'faculty',u.faculty,'major',u.major,'class_group',u.class_group,'enrollment_year',u.enrollment_year,'study_year',u.study_year,'role',u.role))
      from public.users u where v_user.role in ('STAFF','ADMIN') or u.id=v_user.id),'[]'::jsonb),
    'registrations',coalesce((select jsonb_agg(jsonb_build_object('event_id',r.event_id,'user_id',r.user_id,'status',r.status,'passcode',case when v_user.role in ('STAFF','ADMIN') or r.status='COMPLETED' then pc.code else null end,'checkin_at',r.checkin_at,'checkout_at',r.checkout_at,'is_walkin',r.is_walkin))
      from public.event_registrations r left join public.event_passcodes pc on pc.id=r.passcode_id where v_user.role in ('STAFF','ADMIN') or r.user_id=v_user.id),'[]'::jsonb),
    'passcodes',case when v_user.role in ('STAFF','ADMIN') then coalesce((select jsonb_agg(jsonb_build_object('event_id',p.event_id,'code',p.code,'is_reserve',p.is_reserve,'assigned_to',p.assigned_to)) from public.event_passcodes p),'[]'::jsonb) else '[]'::jsonb end
  );
end; $$;

create or replace function public.admin_delete_event_registration(p_admin_token text,p_event_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_passcode_id uuid;
begin
  if not exists(select 1 from public.app_sessions s join public.users u on u.id=s.user_id
    where s.token_hash=encode(digest(p_admin_token,'sha256'),'hex') and s.expires_at>now() and u.role='ADMIN') then
    return jsonb_build_object('success',false,'error_code','FORBIDDEN','message','สงวนสิทธิ์เฉพาะแอดมิน');
  end if;

  select passcode_id into v_passcode_id
    from public.event_registrations
    where event_id=p_event_id and user_id=p_user_id
    for update;
  if not found then return jsonb_build_object('success',false,'error_code','NOT_FOUND','message','ไม่พบรายการลงทะเบียนนี้'); end if;

  if v_passcode_id is not null then
    update public.event_passcodes
    set assigned_to=null,assigned_at=null
    where id=v_passcode_id and event_id=p_event_id and is_reserve=true and assigned_to=p_user_id;
  end if;

  delete from public.event_registrations where event_id=p_event_id and user_id=p_user_id;
  return jsonb_build_object('success',true);
end; $$;

grant execute on function public.login_student(varchar,varchar) to anon, authenticated;
grant execute on function public.register_walkin_student(uuid,text,varchar,varchar,varchar,varchar,varchar,int,varchar,varchar,int) to anon, authenticated;
grant execute on function public.load_workspace(text) to anon, authenticated;
grant execute on function public.admin_delete_event_registration(text,uuid,uuid) to anon, authenticated;

notify pgrst, 'reload schema';
