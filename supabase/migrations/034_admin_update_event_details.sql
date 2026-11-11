begin;
create function public.admin_update_event_details(
  p_admin_token text,p_event_id uuid,p_title text default null,p_location text default null,
  p_activity_hours int default null,p_status text default null
) returns jsonb language plpgsql security definer set search_path=public,extensions,pg_temp as $$
begin
  if event_pass_private.admin_id(p_admin_token) is null then
    raise exception 'สงวนสิทธิ์เฉพาะแอดมิน';
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
