begin;
create function public.registration_account_step(p_event uuid,p_student_id text) returns text
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  sid text:=event_pass_private.student_number(p_student_id);
  account_role text;
begin
  if sid is null or sid !~ '^[0-9]{7,8}$' then raise exception 'กรุณากรอกรหัสนักศึกษา 7–8 หลัก'; end if;
  if not exists(select 1 from public.events where id=p_event and online_registration and status<>'CLOSED') then
    raise exception 'ปิดรับสมัครออนไลน์แล้ว กรุณาติดต่อจุดหน้างาน';
  end if;
  select role into account_role from public.users where student_id=sid;
  if found then
    if account_role='STUDENT' then return 'existing'; end if;
    raise exception 'รหัสนี้ใช้สมัครเป็นนักศึกษาไม่ได้ กรุณาติดต่อแอดมิน';
  end if;
  if exists(select 1 from event_pass_private.applications where event_id=p_event and student_id=sid and status in ('PENDING','CORRECT')) then
    return 'pending';
  end if;
  return 'new';
end; $$;
revoke all on function public.registration_account_step(uuid,text) from public;
grant execute on function public.registration_account_step(uuid,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
