alter table public.events
  add column if not exists banner_url text;

create or replace function public.admin_update_event_banner(
  p_admin_token text,
  p_event_id uuid,
  p_banner_url text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_url text := nullif(trim(coalesce(p_banner_url, '')), '');
begin
  if not exists (
    select 1 from public.app_sessions s
    join public.users u on u.id = s.user_id
    where s.token_hash = encode(digest(p_admin_token, 'sha256'), 'hex')
      and s.expires_at > now() and u.role = 'ADMIN'
  ) then
    return jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'สงวนสิทธิ์เฉพาะแอดมิน');
  end if;

  if v_url is not null and v_url !~ '^https?://' then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_URL', 'message', 'URL รูปภาพต้องขึ้นต้นด้วย https:// หรือ http://');
  end if;

  update public.events set banner_url = v_url where id = p_event_id;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'message', 'ไม่พบกิจกรรมนี้');
  end if;
  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.admin_update_event_banner(text, uuid, text) to anon, authenticated;

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
      'enrollment_year',v_user.enrollment_year,'study_year',v_user.study_year,'role',v_user.role
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
        'study_year',u.study_year,'role',u.role
      ))
      from public.users u where v_user.role in ('STAFF','ADMIN') or u.id=v_user.id
    ), '[]'::jsonb),
    'registrations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_id',r.event_id,'user_id',r.user_id,'status',r.status,
        'passcode',case when v_user.role in ('STAFF','ADMIN') or r.status='COMPLETED' then pc.code else null end,
        'checkin_at',r.checkin_at,'checkout_at',r.checkout_at,'is_walkin',r.is_walkin
      ))
      from public.event_registrations r
      left join public.event_passcodes pc on pc.id=r.passcode_id
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

grant execute on function public.load_workspace(text) to anon, authenticated;
notify pgrst, 'reload schema';
