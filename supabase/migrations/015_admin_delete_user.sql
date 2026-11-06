-- Admins may permanently delete student and staff accounts. Deleting a student
-- also cascades their registrations; deleting staff nulls their scan attribution.
-- Keep an account from being removed while its student is checked into an event.
create or replace function public.admin_delete_user(
  p_admin_token text,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_role varchar(20);
  v_registration_count int := 0;
begin
  if not exists (
    select 1
    from public.app_sessions s
    join public.users u on u.id = s.user_id
    where s.token_hash = encode(digest(p_admin_token, 'sha256'), 'hex')
      and s.expires_at > now()
      and u.role = 'ADMIN'
  ) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'FORBIDDEN',
      'message', 'สงวนสิทธิ์เฉพาะแอดมิน'
    );
  end if;

  select role into v_role
  from public.users
  where id = p_user_id
  for update;

  if not found or v_role not in ('STUDENT', 'STAFF') then
    return jsonb_build_object(
      'success', false,
      'error_code', 'USER_NOT_FOUND',
      'message', 'ไม่พบบัญชีนักศึกษาหรือสตาฟที่ลบได้'
    );
  end if;

  if v_role = 'STUDENT' and exists (
    select 1 from public.event_registrations
    where user_id = p_user_id and status = 'ATTENDING'
  ) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'STUDENT_ATTENDING',
      'message', 'ยังลบบัญชีไม่ได้ เนื่องจากนักศึกษากำลังเข้าร่วมกิจกรรม ต้องเช็กเอาต์ก่อน'
    );
  end if;

  select count(*) into v_registration_count
  from public.event_registrations
  where user_id = p_user_id;

  delete from public.users where id = p_user_id;

  return jsonb_build_object(
    'success', true,
    'deleted_registrations', v_registration_count
  );
end;
$$;

revoke all on function public.admin_delete_user(text, uuid) from public;
grant execute on function public.admin_delete_user(text, uuid) to anon, authenticated;

-- Retire the student self-signup RPC added in migration 014. Account creation
-- remains an admin-controlled process through roster import and admin tools.
drop function if exists public.register_student_account(varchar, varchar, varchar);

notify pgrst, 'reload schema';
