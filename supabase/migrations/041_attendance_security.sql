begin;

-- No attendance rows are rewritten. Deploy the matching client with this migration.
create table if not exists event_pass_private.device_bindings (
  user_id uuid primary key references public.users on delete cascade,
  device_hash text not null unique,
  session_id uuid references public.app_sessions on delete set null
);
create table if not exists event_pass_private.scan_security (
  event_id uuid primary key references public.events on delete cascade,
  radius_m integer not null default 100 check(radius_m between 10 and 1000),
  accuracy_m integer not null default 50 check(accuracy_m between 5 and 200)
);
create table if not exists event_pass_private.security_audit (
  id bigint generated always as identity primary key,
  actor uuid references public.users on delete set null,
  student uuid references public.users on delete set null,
  event_id uuid references public.events on delete set null,
  action text not null, reason text not null,
  distance_m double precision, created_at timestamptz not null default clock_timestamp()
);
alter table event_pass_private.qr_tickets add column if not exists location jsonb;

create or replace function event_pass_private.bind_device(uid uuid, sid uuid, secret text) returns void
language plpgsql set search_path=public,extensions,pg_temp as $$
declare dh text; other_id uuid; b event_pass_private.device_bindings%rowtype;
begin
  if secret is null or secret !~ '^[0-9a-f]{64}$' then raise exception 'กรุณาเปิดเว็บใหม่เพื่อยืนยันเครื่อง'; end if;
  dh:=encode(digest(secret,'sha256'),'hex');
  -- Serialize a device before user locks, including concurrent logins to different accounts.
  perform pg_advisory_xact_lock(hashtextextended(dh,41));
  select user_id into other_id from event_pass_private.device_bindings where device_hash=dh;
  perform id from public.users where id in (uid,other_id) order by id for update;
  if other_id is not null and other_id<>uid then
    if exists(select 1 from public.event_registrations where user_id=other_id and status='ATTENDING') then
      raise exception 'เครื่องนี้กำลังเข้าร่วมกิจกรรมด้วยบัญชีอื่น ต้องเช็กเอาต์หรือติดต่อแอดมินก่อน';
    end if;
    update public.app_sessions set expires_at=clock_timestamp() where user_id=other_id and expires_at>clock_timestamp();
    delete from event_pass_private.device_bindings where user_id=other_id;
  end if;
  select * into b from event_pass_private.device_bindings where user_id=uid;
  if found and b.device_hash<>dh and (
    exists(select 1 from public.app_sessions where id=b.session_id and expires_at>clock_timestamp()) or
    exists(select 1 from public.event_registrations where user_id=uid and status='ATTENDING')
  ) then raise exception 'บัญชีนี้ใช้งานอยู่บนอีกเครื่อง กรุณาออกจากระบบเครื่องเดิมหรือติดต่อแอดมิน'; end if;
  insert into event_pass_private.device_bindings values(uid,dh,sid)
    on conflict(user_id) do update set device_hash=excluded.device_hash,session_id=excluded.session_id;
end; $$;

do $$
begin
  if not exists (select 1 from pg_proc join pg_namespace n on n.oid = pg_proc.pronamespace where n.nspname = 'event_pass_private' and proname = 'login_original') then
    alter function public.login_student(varchar,varchar) set schema event_pass_private;
    alter function event_pass_private.login_student(varchar,varchar) rename to login_original;
  end if;
end $$;
revoke all on function event_pass_private.login_original(varchar,varchar) from public,anon,authenticated;

create or replace function public.login_student(p_student_id varchar,p_password varchar) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare u public.users%rowtype; auth jsonb; sid uuid; secret text;
begin
  select * into u from public.users where student_id=event_pass_private.student_number(p_student_id);
  if not found or p_password is null or crypt(p_password,u.password_hash) is distinct from u.password_hash then
    return jsonb_build_object('success',false,'message','รหัสผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  end if;
  if u.role='STUDENT' then
    secret:=current_setting('eventpass.device_secret',true);
    perform event_pass_private.bind_device(u.id,null,secret);
    -- The same browser can recover after a closed tab, but only one session remains valid.
    update public.app_sessions set expires_at=clock_timestamp() where user_id=u.id and expires_at>clock_timestamp();
  end if;
  auth:=event_pass_private.login_original(p_student_id,p_password);
  if u.role='STUDENT' then
    select id into sid from public.app_sessions where token_hash=encode(digest(auth->>'session_token','sha256'),'hex');
    update event_pass_private.device_bindings set session_id=sid where user_id=u.id;
  end if;
  return auth;
end; $$;

create or replace function public.login_device(p_student_id varchar,p_password varchar,p_device text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform set_config('eventpass.device_secret',coalesce(p_device,''),true);
  return public.login_student(p_student_id,p_password);
end; $$;

create or replace function public.registration_device_join(p_event uuid,p_student_id text,p_password text,p_device text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform set_config('eventpass.device_secret',coalesce(p_device,''),true);
  return public.registration_login_join(p_event,p_student_id,p_password);
end; $$;

create or replace function public.admin_scan_security(p_token text,p_event uuid,p_radius integer default null,p_accuracy integer default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if event_pass_private.admin_id(p_token) is null then raise exception 'สงวนสิทธิ์เฉพาะแอดมิน'; end if;
  if p_radius is not null then
    insert into event_pass_private.scan_security values(p_event,p_radius,coalesce(p_accuracy,50))
      on conflict(event_id) do update set radius_m=excluded.radius_m,accuracy_m=excluded.accuracy_m;
  end if;
  return jsonb_build_object('radius_m',coalesce((select radius_m from event_pass_private.scan_security where event_id=p_event),100),
    'accuracy_m',coalesce((select accuracy_m from event_pass_private.scan_security where event_id=p_event),50));
end; $$;

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
  insert into event_pass_private.security_audit(actor,student,action,reason) values(actor,uid,'RESET_DEVICE',trim(p_reason));
  return jsonb_build_object('success',true);
end; $$;

-- Old clients must not bypass the location gate by calling a legacy RPC.
do $$
begin
  if exists (select 1 from pg_proc join pg_namespace n on n.oid = pg_proc.pronamespace where n.nspname = 'public' and proname = 'issue_event_qr') then
    alter function public.issue_event_qr(text,uuid,boolean) set schema event_pass_private;
  end if;
  if exists (select 1 from pg_proc join pg_namespace n on n.oid = pg_proc.pronamespace where n.nspname = 'public' and proname = 'redeem_device_event_qr') then
    alter function public.redeem_device_event_qr(text,uuid,text,uuid) set schema event_pass_private;
  end if;
end $$;

revoke all on function event_pass_private.issue_event_qr(text,uuid,boolean),
  event_pass_private.redeem_device_event_qr(text,uuid,text,uuid),public.redeem_event_qr(text,uuid,text,uuid),
  public.process_qr_scan(text,uuid,uuid) from public,anon,authenticated;

create or replace function event_pass_private.valid_location(loc jsonb) returns boolean
language plpgsql immutable set search_path=public,pg_temp as $$
begin
  return coalesce(jsonb_typeof(loc)='object' and
    (loc->>'lat')::double precision between -90 and 90 and
    (loc->>'lon')::double precision between -180 and 180 and
    (loc->>'accuracy')::double precision between 0 and 10000 and
    (loc->>'timestamp')::double precision between 0 and 9999999999999,false);
exception when others then return false;
end; $$;

create or replace function public.issue_location_qr(p_session_token text,p_event_id uuid,p_device text,p_location jsonb default null) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare s public.app_sessions%rowtype; result jsonb; loc jsonb;
begin
  select sess.* into s from public.app_sessions sess join public.users u on u.id=sess.user_id
    where sess.token_hash=encode(digest(p_session_token,'sha256'),'hex') and sess.expires_at>clock_timestamp() and u.role='STUDENT';
  if not found then return jsonb_build_object('success',false,'message','เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'); end if;
  perform event_pass_private.bind_device(s.user_id,s.id,p_device);
  -- Recheck after waiting for another login/issuance transaction.
  if not exists(select 1 from public.app_sessions where id=s.id and expires_at>clock_timestamp()) then
    return jsonb_build_object('success',false,'message','เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'); end if;
  update public.app_sessions set expires_at=clock_timestamp() where user_id=s.user_id and id<>s.id and expires_at>clock_timestamp();
  result:=event_pass_private.issue_event_qr(p_session_token,p_event_id,true);
  if (result->>'success')::boolean then
    if event_pass_private.valid_location(p_location) and
      abs(extract(epoch from clock_timestamp())*1000-(p_location->>'timestamp')::double precision)<=30000 then
      loc:=p_location || jsonb_build_object('received_at',clock_timestamp());
    end if;
    update event_pass_private.qr_tickets set location=loc,
      expires_at=least(expires_at,clock_timestamp()+interval '30 seconds') where token=(result->>'token')::uuid;
    result:=result||jsonb_build_object('ttl_ms',least((result->>'ttl_ms')::numeric,30000),'location_available',loc is not null);
  end if;
  return result;
end; $$;

create or replace function public.redeem_location_qr(p_session_token text,p_event_id uuid,p_scan_mode text,p_ticket uuid,
  p_location jsonb default null,p_confirm boolean default false,p_reason text default null) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare actor uuid; student uuid; ticket event_pass_private.qr_tickets%rowtype; radius integer:=100; accuracy integer:=50;
  distance double precision; issue text; result jsonb; a jsonb; b jsonb:=p_location;
begin
  select u.id into actor from public.app_sessions s join public.users u on u.id=s.user_id
    where s.token_hash=encode(digest(p_session_token,'sha256'),'hex') and s.expires_at>clock_timestamp() and u.role in ('STAFF','ADMIN');
  if actor is null then return jsonb_build_object('success',false,'message','กรุณาเข้าสู่ระบบสตาฟ'); end if;
  select u.id into student from event_pass_private.qr_tickets t join public.event_registrations r on r.id=t.registration_id
    join public.users u on u.id=r.user_id where t.token=p_ticket for update of u;
  select t.* into ticket from event_pass_private.qr_tickets t
    join public.event_registrations r on r.id=t.registration_id
    join event_pass_private.card_owners o on o.user_id=r.user_id and o.session_id=t.session_id
    join public.app_sessions s on s.id=t.session_id and s.expires_at>clock_timestamp()
    where t.token=p_ticket and r.event_id=p_event_id and not t.used and t.expires_at>clock_timestamp() and t.scan_mode=p_scan_mode;
  if not found then return jsonb_build_object('success',false,'message','QR หมดอายุ ถูกใช้แล้ว หรือโหมด/กิจกรรมไม่ตรง กรุณาเปิด QR ใหม่'); end if;
  select coalesce(x.radius_m,100),coalesce(x.accuracy_m,50) into radius,accuracy
    from (values(1)) v(n) left join event_pass_private.scan_security x on x.event_id=p_event_id;
  a:=ticket.location;
  if not event_pass_private.valid_location(a) or not event_pass_private.valid_location(b) then issue:='ไม่มีพิกัด GPS ที่ใช้คำนวณระยะได้';
  elsif abs(extract(epoch from clock_timestamp())*1000-(a->>'timestamp')::double precision)>30000 or
    abs(extract(epoch from clock_timestamp())*1000-(b->>'timestamp')::double precision)>30000 or
    (a->>'received_at')::timestamptz<clock_timestamp()-interval '30 seconds' then issue:='พิกัด GPS เก่าเกินไป กรุณาขอตำแหน่งใหม่';
  else
    distance:=6371000*2*asin(sqrt(least(1.0,power(sin(radians((b->>'lat')::float8-(a->>'lat')::float8)/2),2)+
      cos(radians((a->>'lat')::float8))*cos(radians((b->>'lat')::float8))*power(sin(radians((b->>'lon')::float8-(a->>'lon')::float8)/2),2))));
    if (a->>'accuracy')::float8>accuracy or (b->>'accuracy')::float8>accuracy then issue:='GPS มีความคลาดเคลื่อนสูง';
    elsif distance>radius then issue:='นักศึกษาอยู่ไกลกว่าระยะที่กำหนด'; end if;
  end if;
  if issue is not null and (p_confirm is not true or length(trim(coalesce(p_reason,''))) not between 5 and 500) then
    return jsonb_build_object('success',false,'code','GPS_CONFIRM_REQUIRED','message',issue,'distance_m',distance,
      'radius_m',radius,'student_accuracy',a->'accuracy','staff_accuracy',b->'accuracy',
      'student_id',(select student_id from public.users where id=student),'full_name',(select full_name from public.users where id=student));
  end if;
  result:=event_pass_private.redeem_device_event_qr(p_session_token,p_event_id,p_scan_mode,p_ticket);
  if (result->>'success')::boolean then
    if issue is not null then insert into event_pass_private.security_audit(actor,student,event_id,action,reason,distance_m)
      values(actor,student,p_event_id,'GPS_OVERRIDE_'||p_scan_mode,issue||': '||trim(p_reason),distance); end if;
    update event_pass_private.qr_tickets set location=null where token=p_ticket;
  end if;
  return result;
end; $$;

revoke all on all tables in schema event_pass_private from public,anon,authenticated;
revoke all on all functions in schema event_pass_private from public,anon,authenticated;
revoke all on function public.login_device(varchar,varchar,text),public.registration_device_join(uuid,text,text,text),
  public.admin_scan_security(text,uuid,integer,integer),public.admin_reset_student_device(text,text,text),
  public.issue_location_qr(text,uuid,text,jsonb),public.redeem_location_qr(text,uuid,text,uuid,jsonb,boolean,text) from public;
grant execute on function public.login_device(varchar,varchar,text),public.registration_device_join(uuid,text,text,text),
  public.admin_scan_security(text,uuid,integer,integer),public.admin_reset_student_device(text,text,text),
  public.issue_location_qr(text,uuid,text,jsonb),public.redeem_location_qr(text,uuid,text,uuid,jsonb,boolean,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
