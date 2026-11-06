-- Allow administrators to correct student and staff profiles and reset passwords.
create or replace function public.admin_update_user(
  p_admin_token text,
  p_user_id uuid,
  p_student_id varchar,
  p_full_name varchar,
  p_faculty varchar,
  p_major varchar,
  p_class_group varchar,
  p_study_year int,
  p_birth_date varchar,
  p_phone varchar,
  p_new_password varchar default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_role varchar(20);
  v_student_id text := nullif(trim(p_student_id), '');
  v_full_name text := nullif(trim(p_full_name), '');
  v_password_changed boolean := coalesce(p_new_password, '') <> '';
begin
  if not exists (
    select 1 from public.app_sessions s
    join public.users u on u.id = s.user_id
    where s.token_hash = encode(digest(p_admin_token, 'sha256'), 'hex')
      and s.expires_at > now() and u.role = 'ADMIN'
  ) then
    return jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'สงวนสิทธิ์เฉพาะแอดมิน');
  end if;

  select role into v_role from public.users where id = p_user_id for update;
  if not found or v_role not in ('STUDENT', 'STAFF') then
    return jsonb_build_object('success', false, 'error_code', 'USER_NOT_FOUND', 'message', 'ไม่พบบัญชีนักศึกษาหรือสตาฟนี้');
  end if;
  if length(coalesce(v_student_id, '')) < 3 or length(coalesce(v_student_id, '')) > 20
    or length(coalesce(v_full_name, '')) < 2 or length(coalesce(v_full_name, '')) > 255 then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_INPUT', 'message', 'กรุณาระบุชื่อผู้ใช้และชื่อ-นามสกุลให้ถูกต้อง');
  end if;
  if length(coalesce(p_faculty, '')) > 150 or length(coalesce(p_major, '')) > 150
    or length(coalesce(p_class_group, '')) > 50 or length(coalesce(p_phone, '')) > 20 then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_INPUT', 'message', 'คณะ สาขา หมู่เรียน หรือเบอร์โทรยาวเกินกำหนด');
  end if;
  if v_password_changed and length(p_new_password) < 8 then
    return jsonb_build_object('success', false, 'error_code', 'WEAK_PASSWORD', 'message', 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
  end if;
  if v_role = 'STUDENT' and (p_study_year is null or p_study_year < 1 or p_study_year > 8) then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_STUDY_YEAR', 'message', 'ชั้นปีต้องอยู่ระหว่างปี 1 ถึงปี 8');
  end if;
  if nullif(trim(coalesce(p_birth_date, '')), '') is not null
    and trim(p_birth_date) !~ '^[0-9]{8}$' then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_BIRTH_DATE', 'message', 'วันเกิดต้องใช้ตัวเลข 8 หลักรูปแบบ DDMMYYYY');
  end if;

  update public.users
  set student_id = v_student_id,
      full_name = v_full_name,
      faculty = nullif(trim(coalesce(p_faculty, '')), ''),
      major = nullif(trim(coalesce(p_major, '')), ''),
      class_group = nullif(trim(coalesce(p_class_group, '')), ''),
      study_year = case when v_role = 'STUDENT' then p_study_year else study_year end,
      enrollment_year = case when v_role = 'STUDENT'
        then extract(year from now())::int + 543 - p_study_year + 1
        else enrollment_year end,
      birth_date = coalesce(nullif(trim(coalesce(p_birth_date, '')), ''), birth_date),
      phone = nullif(trim(coalesce(p_phone, '')), ''),
      password_hash = case when v_password_changed then crypt(p_new_password, gen_salt('bf')) else password_hash end
  where id = p_user_id;

  if v_password_changed then
    delete from public.app_sessions
    where user_id = p_user_id
      and token_hash <> encode(digest(p_admin_token, 'sha256'), 'hex');
  end if;

  return jsonb_build_object('success', true);
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'error_code', 'USERNAME_EXISTS', 'message', 'ชื่อผู้ใช้นี้มีในระบบแล้ว');
end;
$$;

create or replace function public.load_workspace(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.users%rowtype;
begin
  select u.* into v_user
  from public.app_sessions s join public.users u on u.id = s.user_id
  where s.token_hash = encode(digest(p_session_token, 'sha256'), 'hex') and s.expires_at > now();
  if not found then
    return jsonb_build_object('success', false, 'message', 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  end if;

  return jsonb_build_object(
    'success', true,
    'user', jsonb_build_object(
      'id',v_user.id,'student_id',v_user.student_id,'full_name',v_user.full_name,
      'faculty',v_user.faculty,'major',v_user.major,'class_group',v_user.class_group,
      'enrollment_year',v_user.enrollment_year,'study_year',v_user.study_year,
      'phone',v_user.phone,'role',v_user.role
    ),
    'events',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',e.id,'title',e.title,'location',e.location,'activity_hours',e.activity_hours,
        'status',e.status,'redirect_url_year1',e.redirect_url_year1,'scan_mode',e.scan_mode,
        'banner_url',e.banner_url
      ) order by e.created_at desc)
      from public.events e
      where v_user.role in ('STAFF','ADMIN')
        or exists(select 1 from public.event_registrations r where r.event_id=e.id and r.user_id=v_user.id)
    ), '[]'::jsonb),
    'users',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',u.id,'student_id',u.student_id,'full_name',u.full_name,'faculty',u.faculty,
        'major',u.major,'class_group',u.class_group,'enrollment_year',u.enrollment_year,
        'study_year',u.study_year,
        'birth_date',case when v_user.role = 'ADMIN' then u.birth_date else null end,
        'phone',case when v_user.role = 'ADMIN' or u.id=v_user.id then u.phone else null end,
        'role',u.role
      ))
      from public.users u where v_user.role in ('STAFF','ADMIN') or u.id=v_user.id
    ), '[]'::jsonb),
    'registrations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_id',r.event_id,'user_id',r.user_id,'status',r.status,
        'passcode',case when v_user.role in ('STAFF','ADMIN') or r.status='COMPLETED' then pc.code else null end,
        'checkin_at',r.checkin_at,'checkout_at',r.checkout_at,'is_walkin',r.is_walkin,
        'checked_in_by',r.checked_in_by,'checked_out_by',r.checked_out_by,
        'checkin_staff_name',checkin_staff.full_name,
        'checkout_staff_name',checkout_staff.full_name
      ))
      from public.event_registrations r
      left join public.event_passcodes pc on pc.id=r.passcode_id
      left join public.users checkin_staff on checkin_staff.id=r.checked_in_by
      left join public.users checkout_staff on checkout_staff.id=r.checked_out_by
      where v_user.role in ('STAFF','ADMIN') or r.user_id=v_user.id
    ), '[]'::jsonb),
    'passcodes',case when v_user.role in ('STAFF','ADMIN') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_id',p.event_id,'code',p.code,'is_reserve',p.is_reserve,'assigned_to',p.assigned_to
      )) from public.event_passcodes p
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

grant execute on function public.admin_update_user(text, uuid, varchar, varchar, varchar, varchar, varchar, int, varchar, varchar, varchar)
  to anon, authenticated;
grant execute on function public.load_workspace(text) to anon, authenticated;
notify pgrst, 'reload schema';
