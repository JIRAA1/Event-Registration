-- Student self-registration is available only for a roster-imported account.
-- The student proves identity with the existing birth-date credential, then
-- chooses a private password. Successful registration creates a live session.
create or replace function public.register_student_account(
  p_student_id varchar,
  p_birth_date varchar,
  p_password varchar
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.users%rowtype;
  v_student_id text := nullif(trim(p_student_id), '');
  v_birth_date text := nullif(trim(p_birth_date), '');
begin
  if length(coalesce(p_password, '')) < 8 then
    return jsonb_build_object('success', false, 'error_code', 'WEAK_PASSWORD', 'message', 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  end if;
  if length(coalesce(v_student_id, '')) < 3 or length(coalesce(v_student_id, '')) > 20
    or length(coalesce(v_birth_date, '')) <> 8 or v_birth_date !~ '^[0-9]{8}$' then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_INPUT', 'message', 'กรุณาตรวจสอบรหัสนักศึกษาและวันเกิดรูปแบบ DDMMYYYY');
  end if;

  select * into v_user
  from public.users
  where student_id = v_student_id and role = 'STUDENT'
  for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'ROSTER_NOT_FOUND', 'message', 'ไม่พบรายชื่อในระบบ กรุณาติดต่อแอดมินให้นำเข้ารายชื่อก่อน');
  end if;
  if v_user.birth_date is distinct from v_birth_date
    or v_user.password_hash <> crypt(v_birth_date, v_user.password_hash) then
    return jsonb_build_object('success', false, 'error_code', 'IDENTITY_MISMATCH', 'message', 'รหัสนักศึกษาหรือวันเกิดไม่ถูกต้อง หรือบัญชีนี้สมัครแล้ว');
  end if;

  update public.users
  set password_hash = crypt(p_password, gen_salt('bf'))
  where id = v_user.id;

  return public.login_student(v_user.student_id, p_password);
end;
$$;

grant execute on function public.register_student_account(varchar, varchar, varchar) to anon, authenticated;
notify pgrst, 'reload schema';
