begin;
drop function public.registration_export(text,uuid);
create function public.registration_export(p_token text,p_event uuid,p_ids uuid[] default null) returns jsonb
language plpgsql stable security definer set search_path=public,extensions,pg_temp as $$
begin
  if event_pass_private.admin_id(p_token) is null then raise exception 'กรุณาเข้าสู่ระบบแอดมิน'; end if;
  return coalesce((select jsonb_agg(jsonb_build_array(
    a.student_id,concat(a.profile->>'prefix',a.profile->>'full_name'),a.profile->>'faculty',a.profile->>'major',
    a.profile->>'study_year',a.profile->>'class_group',case when a.kiosk then 'หน้างาน' else 'ออนไลน์' end,
    case when a.status='PENDING' then 'รอยืนยัน' else 'รอแก้ไข' end,a.created_at
  ) order by a.created_at,a.id)
    from event_pass_private.applications a
    where a.event_id=p_event and a.status in ('PENDING','CORRECT')
      and (p_ids is null or a.id=any(p_ids))),'[]'::jsonb);
end; $$;
revoke all on function public.registration_export(text,uuid,uuid[]) from public;
grant execute on function public.registration_export(text,uuid,uuid[]) to anon,authenticated;
notify pgrst,'reload schema';
commit;
