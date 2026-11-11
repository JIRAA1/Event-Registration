begin;
create or replace function public.registration_admin(p_token text,p_event uuid,p_action text,p_value text default '') returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare pw text; uname text;
begin
  if event_pass_private.admin_id(p_token) is null then raise exception 'กรุณาเข้าสู่ระบบแอดมิน'; end if;
  if not exists(select 1 from public.events where id=p_event) then raise exception 'ไม่พบกิจกรรม'; end if;
  case p_action
    when 'OPEN','CLOSE' then update public.events set online_registration=(p_action='OPEN') where id=p_event;
    when 'CONTACT' then
      if p_value<>'' and (p_value !~ '^https://[^[:space:]]+$' or length(p_value)>500) then raise exception 'กรุณาระบุลิงก์ติดต่อ HTTPS'; end if;
      update event_pass_private.registration_settings set contact=p_value where singleton=true;
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

notify pgrst,'reload schema';
commit;
