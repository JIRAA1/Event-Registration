-- ARU Student Organization event registration
create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  student_id varchar(20) unique not null,
  password_hash text not null,
  full_name varchar(255) not null,
  faculty varchar(150), major varchar(150), class_group varchar(50),
  enrollment_year int not null,
  birth_date varchar(8),
  phone varchar(20),
  role varchar(20) not null default 'STUDENT' check (role in ('STUDENT','STAFF','ADMIN')),
  created_at timestamptz not null default now()
);

-- Staff/admin accounts use their own password and do not require a student birth date.
alter table public.users alter column birth_date drop not null;

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title varchar(255) not null, location varchar(255), activity_hours int not null default 4,
  status varchar(20) not null default 'ACTIVE' check (status in ('UPCOMING','ACTIVE','CLOSED')),
  redirect_url_year1 text,
  scan_mode varchar(20) not null default 'CHECKIN' check (scan_mode in ('CHECKIN','CHECKOUT')),
  created_at timestamptz not null default now()
);

create table if not exists public.event_passcodes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  code varchar(100) not null,
  is_reserve boolean not null default false,
  assigned_to uuid references public.users(id) on delete set null,
  assigned_at timestamptz,
  unique(event_id, code)
);

create table if not exists public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  passcode_id uuid references public.event_passcodes(id) on delete set null,
  status varchar(20) not null default 'REGISTERED' check (status in ('REGISTERED','ATTENDING','COMPLETED')),
  is_walkin boolean not null default false,
  checkin_at timestamptz, checkout_at timestamptz,
  registered_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique(event_id, user_id)
);

create index if not exists idx_passcodes_reserve_pool on public.event_passcodes(event_id, is_reserve) where assigned_to is null;
create index if not exists idx_registrations_lookup on public.event_registrations(event_id, user_id);

-- Custom student/staff credentials are verified inside the database. Passwords are bcrypt hashes.
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
    'enrollment_year',v_user.enrollment_year,'role',v_user.role),'session_token',v_token);
end; $$;

drop function if exists public.process_qr_scan(uuid,uuid);
create or replace function public.process_qr_scan(p_session_token text,p_event_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_event public.events%rowtype; v_reg public.event_registrations%rowtype; v_user public.users%rowtype; v_status text;
begin
  if not exists(select 1 from public.app_sessions s join public.users u on u.id=s.user_id
    where s.token_hash=encode(digest(p_session_token,'sha256'),'hex') and s.expires_at>now() and u.role in ('STAFF','ADMIN')) then
    return jsonb_build_object('success',false,'code','FORBIDDEN','message','กรุณาเข้าสู่ระบบสตาฟก่อนสแกน');
  end if;
  select * into v_event from public.events where id = p_event_id for share;
  if not found or v_event.status <> 'ACTIVE' then return jsonb_build_object('success',false,'code','EVENT_CLOSED','message','กิจกรรมปิดหรือไม่อยู่ในสถานะเปิดใช้งาน'); end if;
  select r.* into v_reg from public.event_registrations r where r.event_id=p_event_id and r.user_id=p_user_id for update;
  if not found then return jsonb_build_object('success',false,'code','NOT_REGISTERED','message','ไม่พบรายชื่อในกิจกรรมนี้'); end if;
  select * into v_user from public.users where id=p_user_id;
  if v_event.scan_mode='CHECKIN' then
    if v_reg.status <> 'REGISTERED' then return jsonb_build_object('success',false,'code','ALREADY_CHECKED_IN','student_id',v_user.student_id,'full_name',v_user.full_name,'message','สแกนเข้างานซ้ำ'); end if;
    v_status := 'ATTENDING';
    update public.event_registrations set status=v_status,checkin_at=now(),updated_at=now() where id=v_reg.id;
  else
    if v_reg.status='COMPLETED' then return jsonb_build_object('success',false,'code','ALREADY_COMPLETED','student_id',v_user.student_id,'full_name',v_user.full_name,'message','สแกนออกงานซ้ำ'); end if;
    if v_reg.status <> 'ATTENDING' then return jsonb_build_object('success',false,'code','NOT_CHECKED_IN','student_id',v_user.student_id,'full_name',v_user.full_name,'message','ยังไม่ได้สแกนเข้างาน'); end if;
    v_status := 'COMPLETED';
    update public.event_registrations set status=v_status,checkout_at=now(),updated_at=now() where id=v_reg.id;
  end if;
  return jsonb_build_object('success',true,'code','SCAN_OK','new_status',v_status,'student_id',v_user.student_id,
    'full_name',v_user.full_name,'faculty',v_user.faculty,'enrollment_year',v_user.enrollment_year,'message',case when v_status='ATTENDING' then 'เช็คอินสำเร็จ' else 'เช็คเอาท์สำเร็จ' end);
end; $$;

drop function if exists public.register_walkin_student(uuid,uuid,varchar,varchar,varchar,varchar,varchar,int,varchar,varchar);
create or replace function public.register_walkin_student(
  p_event_id uuid, p_session_token text, p_student_id varchar, p_full_name varchar,
  p_faculty varchar, p_major varchar, p_class_group varchar, p_enrollment_year int,
  p_birth_date varchar, p_phone varchar
) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_user_id uuid; v_staff_id uuid; v_passcode_id uuid; v_code varchar; v_passcode boolean := p_enrollment_year <= 2568;
begin
  select u.id into v_staff_id from public.app_sessions s join public.users u on u.id=s.user_id
    where s.token_hash=encode(digest(p_session_token,'sha256'),'hex') and s.expires_at>now() and u.role in ('STAFF','ADMIN');
  if v_staff_id is null then
    return jsonb_build_object('success',false,'error_code','FORBIDDEN','message','บัญชีนี้ไม่มีสิทธิ์เพิ่มรายชื่อ');
  end if;
  if v_passcode then
    select id,code into v_passcode_id,v_code from public.event_passcodes
      where event_id=p_event_id and is_reserve=true and assigned_to is null
      order by id limit 1 for update skip locked;
    if v_passcode_id is null then return jsonb_build_object('success',false,'error_code','OUT_OF_PASSCODE','message','Passcode สำรองหมดแล้ว'); end if;
  end if;
  insert into public.users(student_id,password_hash,full_name,faculty,major,class_group,enrollment_year,birth_date,phone,role)
    values(p_student_id,crypt(p_birth_date,gen_salt('bf')),p_full_name,p_faculty,p_major,p_class_group,p_enrollment_year,p_birth_date,p_phone,'STUDENT')
    on conflict(student_id) do update set full_name=excluded.full_name,faculty=excluded.faculty,major=excluded.major,
    class_group=excluded.class_group,enrollment_year=excluded.enrollment_year,birth_date=excluded.birth_date,phone=excluded.phone
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

drop function if exists public.admin_add_reserve_passcodes(uuid,uuid,text[]);
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
  return jsonb_build_object('success',true,'added_count',v_added);
end; $$;

drop function if exists public.admin_create_user(uuid,varchar,varchar,varchar,varchar,varchar,varchar);
create or replace function public.admin_create_user(
  p_admin_token text,
  p_username varchar,
  p_password varchar,
  p_full_name varchar,
  p_role varchar,
  p_faculty varchar default null,
  p_major varchar default null
) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_user_id uuid;
begin
  if not exists(select 1 from public.app_sessions s join public.users u on u.id=s.user_id
    where s.token_hash=encode(digest(p_admin_token,'sha256'),'hex') and s.expires_at>now() and u.role='ADMIN') then
    return jsonb_build_object('success',false,'error_code','FORBIDDEN','message','สงวนสิทธิ์เฉพาะแอดมิน');
  end if;
  if p_role not in ('STAFF','ADMIN') then
    return jsonb_build_object('success',false,'error_code','INVALID_ROLE','message','เลือกได้เฉพาะ STAFF หรือ ADMIN');
  end if;
  if length(trim(coalesce(p_username,''))) < 3 or length(coalesce(p_password,'')) < 8 or length(trim(coalesce(p_full_name,''))) < 2 then
    return jsonb_build_object('success',false,'error_code','INVALID_INPUT','message','กรุณากรอกชื่อผู้ใช้ ชื่อ และรหัสผ่านอย่างน้อย 8 ตัวอักษร');
  end if;
  insert into public.users(student_id,password_hash,full_name,faculty,major,enrollment_year,birth_date,role)
    values(trim(p_username),crypt(p_password,gen_salt('bf')),trim(p_full_name),nullif(trim(p_faculty),''),nullif(trim(p_major),''),0,null,p_role)
    returning id into v_user_id;
  return jsonb_build_object('success',true,'user',jsonb_build_object('id',v_user_id,'student_id',trim(p_username),'full_name',trim(p_full_name),'faculty',p_faculty,'major',p_major,'enrollment_year',0,'role',p_role));
exception when unique_violation then
  return jsonb_build_object('success',false,'error_code','USERNAME_EXISTS','message','ชื่อผู้ใช้นี้มีในระบบแล้ว');
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
    'user',jsonb_build_object('id',v_user.id,'student_id',v_user.student_id,'full_name',v_user.full_name,'faculty',v_user.faculty,'major',v_user.major,'class_group',v_user.class_group,'enrollment_year',v_user.enrollment_year,'role',v_user.role),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'location',e.location,'activity_hours',e.activity_hours,'status',e.status,'redirect_url_year1',e.redirect_url_year1,'scan_mode',e.scan_mode) order by e.created_at desc)
      from public.events e where v_user.role in ('STAFF','ADMIN') or exists(select 1 from public.event_registrations r where r.event_id=e.id and r.user_id=v_user.id)),'[]'::jsonb),
    'users',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'student_id',u.student_id,'full_name',u.full_name,'faculty',u.faculty,'major',u.major,'class_group',u.class_group,'enrollment_year',u.enrollment_year,'role',u.role))
      from public.users u where v_user.role in ('STAFF','ADMIN') or u.id=v_user.id),'[]'::jsonb),
    'registrations',coalesce((select jsonb_agg(jsonb_build_object('event_id',r.event_id,'user_id',r.user_id,'status',r.status,'passcode',case when v_user.role in ('STAFF','ADMIN') or r.status='COMPLETED' then pc.code else null end,'checkin_at',r.checkin_at,'checkout_at',r.checkout_at,'is_walkin',r.is_walkin))
      from public.event_registrations r left join public.event_passcodes pc on pc.id=r.passcode_id where v_user.role in ('STAFF','ADMIN') or r.user_id=v_user.id),'[]'::jsonb),
    'passcodes',case when v_user.role in ('STAFF','ADMIN') then coalesce((select jsonb_agg(jsonb_build_object('event_id',p.event_id,'code',p.code,'is_reserve',p.is_reserve,'assigned_to',p.assigned_to)) from public.event_passcodes p),'[]'::jsonb) else '[]'::jsonb end
  );
end; $$;

create or replace function public.admin_delete_event(p_admin_token text,p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if not exists(select 1 from public.app_sessions s join public.users u on u.id=s.user_id
    where s.token_hash=encode(digest(p_admin_token,'sha256'),'hex') and s.expires_at>now() and u.role='ADMIN') then
    return jsonb_build_object('success',false,'error_code','FORBIDDEN','message','สงวนสิทธิ์เฉพาะแอดมิน');
  end if;
  delete from public.events where id=p_event_id;
  if not found then return jsonb_build_object('success',false,'error_code','NOT_FOUND','message','ไม่พบกิจกรรมนี้'); end if;
  return jsonb_build_object('success',true);
end; $$;

create or replace function public.admin_create_event(
  p_admin_token text,p_title varchar,p_location varchar,p_activity_hours int,p_redirect_url_year1 text default null
) returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_event public.events%rowtype;
begin
  if not exists(select 1 from public.app_sessions s join public.users u on u.id=s.user_id
    where s.token_hash=encode(digest(p_admin_token,'sha256'),'hex') and s.expires_at>now() and u.role='ADMIN') then
    return jsonb_build_object('success',false,'error_code','FORBIDDEN','message','สงวนสิทธิ์เฉพาะแอดมิน');
  end if;
  if length(trim(coalesce(p_title,'')))<3 or p_activity_hours<1 then
    return jsonb_build_object('success',false,'error_code','INVALID_INPUT','message','กรุณาระบุชื่อกิจกรรมและชั่วโมงกิจกรรมให้ถูกต้อง');
  end if;
  insert into public.events(title,location,activity_hours,redirect_url_year1,status,scan_mode)
    values(trim(p_title),nullif(trim(p_location),''),p_activity_hours,nullif(trim(p_redirect_url_year1),''),'ACTIVE','CHECKIN') returning * into v_event;
  return jsonb_build_object('success',true,'event',jsonb_build_object('id',v_event.id,'title',v_event.title,'location',coalesce(v_event.location,''),'activity_hours',v_event.activity_hours,'status',v_event.status,'redirect_url_year1',coalesce(v_event.redirect_url_year1,''),'scan_mode',v_event.scan_mode));
end; $$;

create or replace function public.set_event_scan_mode(p_session_token text,p_event_id uuid,p_scan_mode varchar)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if not exists(select 1 from public.app_sessions s join public.users u on u.id=s.user_id
    where s.token_hash=encode(digest(p_session_token,'sha256'),'hex') and s.expires_at>now() and u.role in ('STAFF','ADMIN')) then
    return jsonb_build_object('success',false,'error_code','FORBIDDEN','message','ไม่มีสิทธิ์เปลี่ยนโหมดสแกน');
  end if;
  if p_scan_mode not in ('CHECKIN','CHECKOUT') then return jsonb_build_object('success',false,'error_code','INVALID_MODE','message','โหมดสแกนไม่ถูกต้อง'); end if;
  update public.events set scan_mode=p_scan_mode where id=p_event_id;
  if not found then return jsonb_build_object('success',false,'error_code','NOT_FOUND','message','ไม่พบกิจกรรม'); end if;
  return jsonb_build_object('success',true);
end; $$;

-- Direct table access is disabled. Admin account creation verifies a short-lived server-issued session token.
alter table public.users enable row level security;
alter table public.app_sessions enable row level security;
alter table public.events enable row level security;
alter table public.event_passcodes enable row level security;
alter table public.event_registrations enable row level security;
revoke all on public.users, public.app_sessions, public.events, public.event_passcodes, public.event_registrations from anon, authenticated;
grant execute on function public.login_student(varchar,varchar) to anon, authenticated;
grant execute on function public.process_qr_scan(text,uuid,uuid) to anon, authenticated;
grant execute on function public.register_walkin_student(uuid,text,varchar,varchar,varchar,varchar,varchar,int,varchar,varchar) to anon, authenticated;
grant execute on function public.admin_add_reserve_passcodes(text,uuid,text[]) to anon, authenticated;
grant execute on function public.admin_create_user(text,varchar,varchar,varchar,varchar,varchar,varchar) to anon, authenticated;
grant execute on function public.load_workspace(text) to anon, authenticated;
grant execute on function public.admin_delete_event(text,uuid) to anon, authenticated;
grant execute on function public.admin_create_event(text,varchar,varchar,int,text) to anon, authenticated;
grant execute on function public.set_event_scan_mode(text,uuid,varchar) to anon, authenticated;

-- Add realtime tables safely when the Supabase publication exists.
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    begin alter publication supabase_realtime add table public.event_registrations; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.event_passcodes; exception when duplicate_object then null; end;
  end if;
end $$;
