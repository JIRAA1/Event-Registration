begin;
create or replace function public.admin_update_event_details(
  p_admin_token text,p_event_id uuid,p_title text default null,p_location text default null,
  p_activity_hours int default null,p_status text default null
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare account_role text;
begin
  select u.role into account_role from public.app_sessions s join public.users u on u.id=s.user_id
    where s.token_hash=encode(digest(p_admin_token,'sha256'),'hex') and s.expires_at>now();
  if not found then
    return jsonb_build_object('success',false,'error_code','SESSION_EXPIRED','message','เซสชันหมดอายุหรือถูกยกเลิก กรุณาเข้าสู่ระบบใหม่');
  end if;
  if account_role<>'ADMIN' then
    return jsonb_build_object('success',false,'error_code','FORBIDDEN','message','บัญชีที่เข้าสู่ระบบไม่มีสิทธิ์แอดมิน');
  end if;
  if (p_title is not null and length(trim(p_title)) not between 1 and 255)
    or (p_location is not null and length(trim(p_location)) not between 1 and 255)
    or (p_activity_hours is not null and p_activity_hours<1)
    or (p_status is not null and p_status not in ('ACTIVE','UPCOMING','CLOSED')) then
    raise exception 'กรุณาตรวจชื่อ สถานที่ ชั่วโมง และสถานะกิจกรรม';
  end if;
  update public.events set title=coalesce(trim(p_title),title),location=coalesce(trim(p_location),location),
    activity_hours=coalesce(p_activity_hours,activity_hours),status=coalesce(p_status,status)
    where id=p_event_id;
  if not found then raise exception 'ไม่พบกิจกรรมนี้'; end if;
  return jsonb_build_object('success',true);
end; $$;
revoke all on function public.admin_update_event_details(text,uuid,text,text,int,text) from public;
grant execute on function public.admin_update_event_details(text,uuid,text,text,int,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
