begin;

create function public.admin_delete_students(p_admin_token text, p_user_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  locked_count integer;
begin
  if not exists (select 1 from public.app_sessions s join public.users u on u.id=s.user_id
    where s.token_hash=encode(digest(p_admin_token,'sha256'),'hex') and s.expires_at>now() and u.role='ADMIN') then
    return jsonb_build_object('success',false,'message','สงวนสิทธิ์เฉพาะแอดมิน');
  end if;
  perform id from public.users where id=any(p_user_ids) and role='STUDENT' order by id for update;
  get diagnostics locked_count = row_count;
  if locked_count=0 or locked_count<>cardinality(p_user_ids) then
    return jsonb_build_object('success',false,'message','รายชื่อนักศึกษาเปลี่ยนไป กรุณาตรวจสอบอีกครั้ง');
  end if;
  perform id from public.event_registrations where user_id=any(p_user_ids) order by id for update;
  if exists(select 1 from public.event_registrations where user_id=any(p_user_ids) and status='ATTENDING') then
    return jsonb_build_object('success',false,'message','มีนักศึกษากำลังเข้าร่วมกิจกรรม ยังไม่ได้ลบบัญชีในชุดนี้');
  end if;
  delete from public.users where id=any(p_user_ids);
  return jsonb_build_object('success',true,'deleted_count',locked_count);
end; $$;

create function public.admin_delete_passcodes(p_admin_token text, p_event_id uuid, p_codes text[])
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  locked_count integer;
begin
  if not exists (select 1 from public.app_sessions s join public.users u on u.id=s.user_id
    where s.token_hash=encode(digest(p_admin_token,'sha256'),'hex') and s.expires_at>now() and u.role='ADMIN') then
    return jsonb_build_object('success',false,'message','สงวนสิทธิ์เฉพาะแอดมิน');
  end if;
  perform id from public.event_passcodes where event_id=p_event_id and code=any(p_codes)
    and assigned_to is null order by id for update;
  get diagnostics locked_count = row_count;
  if locked_count=0 or locked_count<>cardinality(p_codes) or exists (
    select 1 from public.event_registrations r join public.event_passcodes p on p.id=r.passcode_id
    where p.event_id=p_event_id and p.code=any(p_codes)
  ) then
    return jsonb_build_object('success',false,'message','รหัสถูกจับคู่หรือรายการเปลี่ยนไป ยังไม่ได้ลบรหัสในชุดนี้');
  end if;
  delete from public.event_passcodes where event_id=p_event_id and code=any(p_codes);
  return jsonb_build_object('success',true,'deleted_count',locked_count);
end; $$;

revoke all on function public.admin_delete_students(text,uuid[]), public.admin_delete_passcodes(text,uuid,text[]) from public;
grant execute on function public.admin_delete_students(text,uuid[]), public.admin_delete_passcodes(text,uuid,text[]) to anon,authenticated;
notify pgrst,'reload schema';
commit;
