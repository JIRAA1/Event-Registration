begin;
-- Read/broadcast metadata only. No attendance or passcode rows are rewritten.
create or replace function public.load_workspace(p_session_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_user public.users%rowtype;
begin
  select u.* into v_user from public.app_sessions s join public.users u on u.id=s.user_id
    where s.token_hash=encode(digest(p_session_token,'sha256'),'hex') and s.expires_at>now();
  if not found then return jsonb_build_object('success',false,'message','เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่'); end if;
  return jsonb_build_object(
    'success',true,
    'user',jsonb_build_object('id',v_user.id,'student_id',v_user.student_id,'full_name',v_user.full_name,'faculty',v_user.faculty,'major',v_user.major,'class_group',v_user.class_group,'enrollment_year',v_user.enrollment_year,'study_year',v_user.study_year,'phone',v_user.phone,'role',v_user.role),
    'applications',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'event_id',e.id,'title',e.title,'online',not a.kiosk,'status',a.status,'note',a.note) order by a.created_at)
      from event_pass_private.applications a join public.events e on e.id=a.event_id where v_user.role='STUDENT' and a.student_id=v_user.student_id
      and a.status in ('PENDING','CORRECT') and not exists(select 1 from public.event_registrations r where r.user_id=v_user.id and r.event_id=e.id)),'[]'::jsonb),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'location',e.location,'activity_hours',e.activity_hours,'status',e.status,'redirect_url_year1',e.redirect_url_year1,'scan_mode',e.scan_mode,'banner_url',e.banner_url) order by e.created_at desc) from public.events e where v_user.role in ('STAFF','ADMIN') or exists(select 1 from public.event_registrations r where r.event_id=e.id and r.user_id=v_user.id)),'[]'::jsonb),
    'users',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'student_id',u.student_id,'full_name',u.full_name,'faculty',u.faculty,'major',u.major,'class_group',u.class_group,'enrollment_year',u.enrollment_year,'study_year',u.study_year,'birth_date',case when v_user.role='ADMIN' then u.birth_date else null end,'phone',case when v_user.role='ADMIN' or u.id=v_user.id then u.phone else null end,'role',u.role)) from public.users u where (v_user.role='ADMIN') or (v_user.role='STAFF' and u.role in ('STAFF','ADMIN')) or (u.id=v_user.id)),'[]'::jsonb),
    'registrations',coalesce((select jsonb_agg(jsonb_build_object('event_id',r.event_id,'user_id',r.user_id,'status',r.status,'passcode_forfeited',r.passcode_forfeited,'passcode',case when v_user.role in ('STAFF','ADMIN') or r.status='COMPLETED' then pc.code else null end,'checkin_at',r.checkin_at,'checkout_at',r.checkout_at,'is_walkin',r.is_walkin,'checkin_station',r.checkin_station,'checked_in_by',r.checked_in_by,'checked_out_by',r.checked_out_by,'checkin_staff_name',checkin_staff.full_name,'checkout_staff_name',checkout_staff.full_name)) from public.event_registrations r left join public.event_passcodes pc on pc.id=r.passcode_id left join public.users checkin_staff on checkin_staff.id=r.checked_in_by left join public.users checkout_staff on checkout_staff.id=r.checked_out_by where v_user.role in ('STAFF','ADMIN') or r.user_id=v_user.id),'[]'::jsonb),
    'passcodes',case when v_user.role in ('STAFF','ADMIN') then coalesce((select jsonb_agg(jsonb_build_object('event_id',p.event_id,'code',p.code,'is_reserve',p.is_reserve,'assigned_to',p.assigned_to)) from public.event_passcodes p),'[]'::jsonb) else '[]'::jsonb end,
    'academic_catalog',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'majors',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name) order by m.name) from public.academic_majors m where m.faculty_id=f.id),'[]'::jsonb)) order by f.name) from public.academic_faculties f),'[]'::jsonb)
  );
end; $$;

revoke all on function public.load_workspace(text) from public;
grant execute on function public.load_workspace(text) to anon, authenticated;


create or replace function public.broadcast_student_registration_status()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid;
  v_event_id uuid;
  v_status varchar(20);
  v_checkin_at timestamptz;
  v_checkout_at timestamptz;
  v_passcode text;
  v_forfeited boolean;
  v_session record;
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
    v_event_id := old.event_id;
  else
    v_user_id := new.user_id;
    v_event_id := new.event_id;
    v_status := new.status;
    v_forfeited := new.passcode_forfeited;
    v_checkin_at := new.checkin_at;
    v_checkout_at := new.checkout_at;
    if new.status = 'COMPLETED' and new.passcode_id is not null then
      select code into v_passcode
      from public.event_passcodes
      where id = new.passcode_id and assigned_to = new.user_id;
    end if;
  end if;

  for v_session in
    select s.token_hash
    from public.app_sessions s
    where s.user_id = v_user_id and s.expires_at > now()
  loop
    perform realtime.send(
      jsonb_build_object(
        'event_id', v_event_id,
        'user_id', v_user_id,
        'status', v_status,
        'checkin_at', v_checkin_at,
        'checkout_at', v_checkout_at,
        'passcode', v_passcode,
        'passcode_forfeited', v_forfeited,
        'operation', tg_op
      ),
      'registration_status',
      'aru-student:' || v_session.token_hash,
      true
    );
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
commit;
