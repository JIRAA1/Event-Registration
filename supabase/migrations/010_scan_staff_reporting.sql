alter table public.event_registrations
  add column if not exists checked_in_by uuid references public.users(id) on delete set null,
  add column if not exists checked_out_by uuid references public.users(id) on delete set null;

create or replace function public.process_qr_scan(
  p_session_token text,
  p_event_id uuid,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_event public.events%rowtype;
  v_reg public.event_registrations%rowtype;
  v_user public.users%rowtype;
  v_staff public.users%rowtype;
  v_status text;
begin
  select u.* into v_staff
  from public.app_sessions s join public.users u on u.id = s.user_id
  where s.token_hash = encode(digest(p_session_token, 'sha256'), 'hex')
    and s.expires_at > now() and u.role in ('STAFF','ADMIN');
  if not found then
    return jsonb_build_object('success',false,'code','FORBIDDEN','message','กรุณาเข้าสู่ระบบสตาฟก่อนสแกน');
  end if;

  select * into v_event from public.events where id = p_event_id for share;
  if not found or v_event.status <> 'ACTIVE' then
    return jsonb_build_object('success',false,'code','EVENT_CLOSED','message','กิจกรรมปิดหรือไม่อยู่ในสถานะเปิดใช้งาน');
  end if;

  select r.* into v_reg
  from public.event_registrations r
  where r.event_id = p_event_id and r.user_id = p_user_id
  for update;
  if not found then
    return jsonb_build_object('success',false,'code','NOT_REGISTERED','message','ไม่พบรายชื่อในกิจกรรมนี้');
  end if;

  select * into v_user from public.users where id = p_user_id;
  if v_event.scan_mode = 'CHECKIN' then
    if v_reg.status <> 'REGISTERED' then
      return jsonb_build_object('success',false,'code','ALREADY_CHECKED_IN','student_id',v_user.student_id,'full_name',v_user.full_name,'message','สแกนเข้างานซ้ำ');
    end if;
    v_status := 'ATTENDING';
    update public.event_registrations
    set status=v_status,checkin_at=now(),checked_in_by=v_staff.id,updated_at=now()
    where id=v_reg.id;
  else
    if v_reg.status = 'COMPLETED' then
      return jsonb_build_object('success',false,'code','ALREADY_COMPLETED','student_id',v_user.student_id,'full_name',v_user.full_name,'message','สแกนออกงานซ้ำ');
    end if;
    if v_reg.status <> 'ATTENDING' then
      return jsonb_build_object('success',false,'code','NOT_CHECKED_IN','student_id',v_user.student_id,'full_name',v_user.full_name,'message','ยังไม่ได้สแกนเข้างาน');
    end if;
    v_status := 'COMPLETED';
    update public.event_registrations
    set status=v_status,checkout_at=now(),checked_out_by=v_staff.id,updated_at=now()
    where id=v_reg.id;
  end if;

  return jsonb_build_object(
    'success',true,'code','SCAN_OK','new_status',v_status,
    'student_id',v_user.student_id,'full_name',v_user.full_name,
    'faculty',v_user.faculty,'major',v_user.major,'class_group',v_user.class_group,
    'study_year',v_user.study_year,
    'message',case when v_status='ATTENDING' then 'เช็คอินสำเร็จ' else 'เช็คเอาต์สำเร็จ' end
  );
end;
$$;

grant execute on function public.process_qr_scan(text, uuid, uuid) to anon, authenticated;

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
      'enrollment_year',v_user.enrollment_year,'study_year',v_user.study_year,
      'phone',v_user.phone,'role',v_user.role
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
        'study_year',u.study_year,
        'phone',case when v_user.role = 'ADMIN' or u.id=v_user.id then u.phone else null end,
        'role',u.role
      ))
      from public.users u where v_user.role in ('STAFF','ADMIN') or u.id=v_user.id
    ), '[]'::jsonb),
    'registrations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_id',r.event_id,'user_id',r.user_id,'status',r.status,
        'passcode',case when v_user.role in ('STAFF','ADMIN') or r.status='COMPLETED' then pc.code else null end,
        'checkin_at',r.checkin_at,'checkout_at',r.checkout_at,'is_walkin',r.is_walkin,
        'checked_in_by',r.checked_in_by,'checked_out_by',r.checked_out_by,
        'checkin_staff_name',checkin_staff.full_name,
        'checkout_staff_name',checkout_staff.full_name
      ))
      from public.event_registrations r
      left join public.event_passcodes pc on pc.id=r.passcode_id
      left join public.users checkin_staff on checkin_staff.id=r.checked_in_by
      left join public.users checkout_staff on checkout_staff.id=r.checked_out_by
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
