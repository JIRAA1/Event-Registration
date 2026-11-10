begin;
set local search_path=public,extensions,pg_temp;

-- Apply the same ID spelling to existing accounts and future imports, edits and walk-ins.
-- If legacy accounts collide the unique constraint aborts the migration without merging identities.
create function event_pass_private.student_number(value text) returns text
language sql immutable strict as $$ select translate(btrim(value),'๐๑๒๓๔๕๖๗๘๙','0123456789') $$;

update public.users set student_id=event_pass_private.student_number(student_id)
where role='STUDENT' and student_id<>event_pass_private.student_number(student_id);
create function event_pass_private.normalize_student() returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
begin
  if new.role='STUDENT' then new.student_id:=event_pass_private.student_number(new.student_id); end if;
  return new;
end; $$;
create trigger normalize_student_number before insert or update of student_id,role on public.users
for each row execute function event_pass_private.normalize_student();

create or replace function public.login_student(p_student_id varchar, p_password varchar)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_user public.users%rowtype; v_token text;
begin
  select * into v_user from public.users where student_id = trim(p_student_id) or (role='STUDENT' and student_id=event_pass_private.student_number(p_student_id)) order by (student_id=trim(p_student_id)) desc limit 1;
  if not found or crypt(p_password, v_user.password_hash) is distinct from v_user.password_hash then
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

alter table public.events add column online_registration boolean not null default false;
create table event_pass_private.registration_settings (
  singleton boolean primary key check(singleton), contact text not null default '',
  issue_key bytea not null default gen_random_bytes(32)
);
insert into event_pass_private.registration_settings(singleton,contact) values(true,'');

-- Dedicated device identities cannot authenticate as staff or acquire a scanning session.
create table event_pass_private.stations (
  event_id uuid primary key references public.events on delete cascade,
  username text not null unique, password_hash text not null,
  session_hash text, expires_at timestamptz
);
create table event_pass_private.applications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  student_id text not null, profile jsonb not null, kiosk boolean not null,
  receipt_hash text not null unique, initial_hash text,
  status text not null default 'PENDING' check(status in ('PENDING','CORRECT','APPROVED','CANCELLED')),
  note text not null default '', issued boolean not null default false, claimed boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index one_open_application on event_pass_private.applications(event_id,student_id)
where status in ('PENDING','CORRECT');

create function event_pass_private.admin_id(token text) returns uuid language sql stable
set search_path=public,extensions,pg_temp as $$
  select u.id from public.app_sessions s join public.users u on u.id=s.user_id
  where s.token_hash=encode(digest(token,'sha256'),'hex') and s.expires_at>now() and u.role='ADMIN'
$$;
create function event_pass_private.station_ok(e uuid,token text) returns boolean language sql stable
set search_path=public,extensions,pg_temp as $$
  select exists(select 1 from event_pass_private.stations where event_id=e
    and session_hash=encode(digest(token,'sha256'),'hex') and expires_at>now())
$$;

create function public.registration_info(p_event uuid default null) returns jsonb language sql stable security definer
set search_path=public,pg_temp as $$
  select jsonb_build_object('contact',(select contact from event_pass_private.registration_settings),
    'event',(select jsonb_build_object('title',title,'location',location,'open',online_registration and status<>'CLOSED','closed',status='CLOSED') from public.events where id=p_event),
    'catalog',case when p_event is not null then (select jsonb_object_agg(f.name,
      (select coalesce(jsonb_agg(m.name order by m.name),'[]'::jsonb) from public.academic_majors m where m.faculty_id=f.id))
      from public.academic_faculties f) end)
$$;

create function public.registration_admin(p_token text,p_event uuid,p_action text,p_value text default '') returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare pw text; uname text;
begin
  if event_pass_private.admin_id(p_token) is null then raise exception 'กรุณาเข้าสู่ระบบแอดมิน'; end if;
  if not exists(select 1 from public.events where id=p_event) then raise exception 'ไม่พบกิจกรรม'; end if;
  case p_action
    when 'OPEN','CLOSE' then update public.events set online_registration=(p_action='OPEN') where id=p_event;
    when 'CONTACT' then
      if p_value<>'' and (p_value !~ '^https://[^[:space:]]+$' or length(p_value)>500) then raise exception 'กรุณาระบุลิงก์ติดต่อ HTTPS'; end if;
      update event_pass_private.registration_settings set contact=p_value;
    when 'STATION' then
      pw:=encode(gen_random_bytes(12),'hex');
      uname:='ipad-'||p_event::text;
      insert into event_pass_private.stations(event_id,username,password_hash) values(p_event,uname,crypt(pw,gen_salt('bf')))
      on conflict(event_id) do update set password_hash=excluded.password_hash,session_hash=null,expires_at=null;
      return jsonb_build_object('username',uname,'password',pw);
    when 'QUEUE' then null;
    else raise exception 'คำสั่งไม่ถูกต้อง';
  end case;
  return jsonb_build_object('open',(select online_registration from public.events where id=p_event),
    'contact',(select contact from event_pass_private.registration_settings),
    'station',(select username from event_pass_private.stations where event_id=p_event),
    'queue',coalesce((select jsonb_agg(jsonb_build_object('id',id,'student_id',student_id,'profile',profile,'kiosk',kiosk,'status',status)
      order by created_at) from event_pass_private.applications where event_id=p_event and status in ('PENDING','CORRECT')),'[]'::jsonb));
end; $$;

create function public.registration_station_login(p_username text,p_password text) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare device event_pass_private.stations%rowtype; token text;
begin
  select * into device from event_pass_private.stations where username=trim(p_username) for update;
  if not found or crypt(p_password,device.password_hash) is distinct from device.password_hash then raise exception 'ชื่อเครื่องหรือรหัสผ่านไม่ถูกต้อง'; end if;
  token:=encode(gen_random_bytes(32),'hex');
  update event_pass_private.stations set session_hash=encode(digest(token,'sha256'),'hex'),expires_at=now()+interval '12 hours' where event_id=device.event_id;
  return jsonb_build_object('event',device.event_id,'token',token);
end; $$;

create function public.registration_join(p_event uuid,p_token text) returns jsonb language plpgsql security definer
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
  if exists(select 1 from public.event_registrations where event_id=p_event and user_id=u.id) then update event_pass_private.applications set status='APPROVED',initial_hash=null,profile='{}' where event_id=p_event and student_id=u.student_id and status in ('PENDING','CORRECT');
    return jsonb_build_object('already',true); end if;
  if e.id is null or not e.online_registration or e.status='CLOSED' then raise exception 'ปิดรับสมัครออนไลน์แล้ว กรุณาติดต่อจุดหน้างาน'; end if;
  insert into public.event_registrations(event_id,user_id) values(p_event,u.id) on conflict(event_id,user_id) do nothing;
  update event_pass_private.applications set status='APPROVED',initial_hash=null,profile='{}' where event_id=p_event and student_id=u.student_id and status in ('PENDING','CORRECT');
  return jsonb_build_object('already',false);
end; $$;

-- Keep authentication and enrollment in one transaction. A rejected submission leaves no orphan login session.
create function public.registration_login_join(p_event uuid,p_student_id text,p_password text) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare auth jsonb; enrollment jsonb;
begin
  perform id from public.events where id=p_event for share;
  perform pg_advisory_xact_lock(hashtextextended(p_event::text||':'||event_pass_private.student_number(p_student_id),0));
  auth:=public.login_student(p_student_id::varchar,p_password::varchar);
  if (auth->>'success')::boolean is not true then return auth; end if;
  enrollment:=public.registration_join(p_event,auth->>'session_token');
  return auth || enrollment;
end; $$;

create function public.registration_apply(p_event uuid,p_profile jsonb,p_receipt text,p_station text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare e public.events%rowtype; a event_pass_private.applications%rowtype; person public.users%rowtype;
  sid text:=event_pass_private.student_number(p_profile->>'student_id'); kiosk_mode boolean:=p_station is not null;
  rh text:=encode(digest(p_receipt,'sha256'),'hex'); pw text; new_id uuid;
begin
  if p_receipt is null or p_receipt !~ '^[0-9a-f]{64}$' then raise exception 'กรุณาเปิดฟอร์มใหม่'; end if;
  if kiosk_mode and not event_pass_private.station_ok(p_event,p_station) then raise exception 'เซสชันเครื่องหมดอายุ กรุณาเข้าสู่ระบบเครื่องใหม่'; end if;
  select * into e from public.events where id=p_event for share;
  if not found or e.status='CLOSED' or (not kiosk_mode and not e.online_registration) then raise exception 'ปิดรับสมัครแล้ว กรุณาติดต่อจุดหน้างาน'; end if;
  if jsonb_typeof(p_profile) is distinct from 'object' or pg_column_size(p_profile)>8192 or sid is null or sid !~ '^[0-9]{7,8}$' or length(trim(coalesce(p_profile->>'full_name',''))) not between 2 and 255
    or length(trim(coalesce(p_profile->>'class_group',''))) not between 1 and 50 or coalesce(p_profile->>'study_year','') !~ '^[1-8]$'
    or coalesce(p_profile->>'birth_date','') !~ '^[0-9]{8}$' or coalesce(p_profile->>'phone','') !~ '^0[0-9]{9}$'
    or not exists(select 1 from public.academic_faculties f join public.academic_majors m on m.faculty_id=f.id where f.name=p_profile->>'faculty' and m.name=p_profile->>'major')
    then raise exception 'กรุณาตรวจรหัสนักศึกษา ชื่อ คณะ สาขา หมู่เรียน ชั้นปี วันเกิด และเบอร์โทร'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event::text||':'||sid,0));
  p_profile:=jsonb_build_object('student_id',sid,'full_name',trim(p_profile->>'full_name'),'class_group',trim(p_profile->>'class_group'),
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
  select substr(encode(hmac(convert_to(p_receipt,'UTF8'),issue_key,'sha256'),'hex'),1,20) into pw from event_pass_private.registration_settings;
  insert into event_pass_private.applications(event_id,student_id,profile,kiosk,receipt_hash,initial_hash)
    values(p_event,sid,p_profile,kiosk_mode,rh,crypt(pw,gen_salt('bf'))) returning id into new_id;
  return jsonb_build_object('id',new_id);
end; $$;

create function public.registration_review(p_token text,p_id uuid,p_decision text,p_note text default '') returns void
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
    values(a.student_id,a.initial_hash,trim(a.profile->>'full_name'),a.profile->>'faculty',a.profile->>'major',a.profile->>'class_group',
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
  update event_pass_private.applications set status='APPROVED',issued=fresh,initial_hash=null,profile='{}',note='' where id=a.id;
end; $$;

create function public.registration_receipt(p_event uuid,p_receipt text,p_station text default null,p_claim boolean default false)
returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare a event_pass_private.applications%rowtype; pw text;
begin
  select * into a from event_pass_private.applications where receipt_hash=encode(digest(p_receipt,'sha256'),'hex') and event_id=p_event for update;
  if not found or a.kiosk<>(p_station is not null) or (a.kiosk and not event_pass_private.station_ok(p_event,p_station)) then raise exception 'ไม่พบคำขอหรือเซสชันเครื่องหมดอายุ'; end if;
  if p_claim and a.status='APPROVED' and a.issued and not a.claimed then
    select substr(encode(hmac(convert_to(p_receipt,'UTF8'),issue_key,'sha256'),'hex'),1,20) into pw from event_pass_private.registration_settings;
    update event_pass_private.applications set claimed=true where id=a.id;
  end if;
  return jsonb_build_object('id',a.id,'status',a.status,'student_id',a.student_id,'note',a.note,'issued',a.issued,'claimed',a.claimed,
    'password',pw,'profile',case when a.status='CORRECT' then a.profile end);
end; $$;
create function public.registration_cancel_station_request(p_event uuid,p_receipt text,p_station text) returns void
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
begin
  if not event_pass_private.station_ok(p_event,p_station) then raise exception 'เซสชันเครื่องหมดอายุ'; end if;
  update event_pass_private.applications set status='CANCELLED',profile='{}',initial_hash=null,note=''
    where event_id=p_event and kiosk and receipt_hash=encode(digest(p_receipt,'sha256'),'hex') and status in ('PENDING','CORRECT');
end; $$;

create function public.registration_station_logout(p_token text) returns void language sql security definer
set search_path=public,extensions,pg_temp as $$
  update event_pass_private.stations set session_hash=null,expires_at=null where session_hash=encode(digest(p_token,'sha256'),'hex')
$$;
revoke all on function public.registration_info(uuid), public.registration_admin(text,uuid,text,text),
  public.registration_station_login(text,text), public.registration_station_logout(text),
  public.registration_login_join(uuid,text,text), public.registration_join(uuid,text),
  public.registration_apply(uuid,jsonb,text,text), public.registration_receipt(uuid,text,text,boolean),
  public.registration_review(text,uuid,text,text), public.registration_cancel_station_request(uuid,text,text) from public;
grant execute on function public.registration_info(uuid), public.registration_admin(text,uuid,text,text),
  public.registration_station_login(text,text), public.registration_station_logout(text),
  public.registration_login_join(uuid,text,text), public.registration_join(uuid,text),
  public.registration_apply(uuid,jsonb,text,text), public.registration_receipt(uuid,text,text,boolean),
  public.registration_review(text,uuid,text,text), public.registration_cancel_station_request(uuid,text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
