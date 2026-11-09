-- Restore the profile editor independently of later load_workspace revisions.
begin;
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

grant execute on function public.admin_update_user(text, uuid, varchar, varchar, varchar, varchar, varchar, int, varchar, varchar, varchar)
  to anon, authenticated;
notify pgrst, 'reload schema';
commit;
