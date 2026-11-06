-- Passcodes belong to students currently in year 2 or above. Assign any missing
-- code when a registration is created, and deliver it to that student's private
-- realtime topic only after check-out is complete.

create or replace function public.assign_registration_passcode_for_study_year()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_study_year int;
  v_passcode_id uuid;
begin
  if new.passcode_id is not null then return new; end if;

  select study_year into v_study_year
  from public.users
  where id = new.user_id and role = 'STUDENT';

  if coalesce(v_study_year, 0) <= 1 then return new; end if;

  select id into v_passcode_id
  from public.event_passcodes
  where event_id = new.event_id and is_reserve = true and assigned_to is null
  order by id
  limit 1
  for update skip locked;

  if v_passcode_id is not null then
    update public.event_passcodes
    set assigned_to = new.user_id, assigned_at = now()
    where id = v_passcode_id and assigned_to is null;
    if found then
      update public.event_registrations
      set passcode_id = v_passcode_id, updated_at = now()
      where id = new.id and passcode_id is null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists event_registrations_assign_study_year_passcode on public.event_registrations;
create trigger event_registrations_assign_study_year_passcode
  after insert on public.event_registrations
  for each row execute function public.assign_registration_passcode_for_study_year();

-- Walk-in registration uses the student's current study year, not admission year,
-- when deciding whether a passcode is required.
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
    if v_passcode_id is null then
      return jsonb_build_object('success',false,'error_code','OUT_OF_PASSCODE','message','Passcode สำรองหมดแล้ว');
    end if;
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

grant execute on function public.register_walkin_student(uuid,text,varchar,varchar,varchar,varchar,varchar,int,varchar,varchar,int)
  to anon, authenticated;

-- Repair registrations created before this migration where the old admission-year
-- test skipped a passcode for a student whose current study year is 2 or above.
do $$
declare
  v_reg record;
  v_passcode_id uuid;
begin
  for v_reg in
    select r.id, r.event_id, r.user_id
    from public.event_registrations r
    join public.users u on u.id = r.user_id
    where r.passcode_id is null and u.role = 'STUDENT' and u.study_year > 1
    order by r.id
    for update of r
  loop
    select p.id into v_passcode_id
    from public.event_passcodes p
    where p.event_id = v_reg.event_id and p.is_reserve = true and p.assigned_to is null
    order by p.id
    limit 1
    for update skip locked;

    if v_passcode_id is not null then
      update public.event_passcodes
      set assigned_to = v_reg.user_id, assigned_at = now()
      where id = v_passcode_id and assigned_to is null;
      if found then
        update public.event_registrations
        set passcode_id = v_passcode_id, updated_at = now()
        where id = v_reg.id;
      end if;
    end if;
    v_passcode_id := null;
  end loop;
end;
$$;

create or replace function public.broadcast_student_registration_status()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid;
  v_event_id uuid;
  v_status varchar(20);
  v_checkin_at timestamptz;
  v_checkout_at timestamptz;
  v_passcode text;
  v_session record;
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
    v_event_id := old.event_id;
  else
    v_user_id := new.user_id;
    v_event_id := new.event_id;
    v_status := new.status;
    v_checkin_at := new.checkin_at;
    v_checkout_at := new.checkout_at;
    if new.status = 'COMPLETED' and new.passcode_id is not null then
      select code into v_passcode
      from public.event_passcodes
      where id = new.passcode_id and assigned_to = new.user_id;
    end if;
  end if;

  for v_session in
    select s.token_hash
    from public.app_sessions s
    where s.user_id = v_user_id and s.expires_at > now()
  loop
    perform realtime.send(
      jsonb_build_object(
        'event_id', v_event_id,
        'user_id', v_user_id,
        'status', v_status,
        'checkin_at', v_checkin_at,
        'checkout_at', v_checkout_at,
        'passcode', v_passcode,
        'operation', tg_op
      ),
      'registration_status',
      'aru-student:' || v_session.token_hash,
      true
    );
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
