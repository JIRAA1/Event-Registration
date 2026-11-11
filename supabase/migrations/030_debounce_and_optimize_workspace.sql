-- 030_debounce_and_optimize_workspace.sql
-- 1. Add indexes for faster user queries and role checks
-- 2. Convert users_broadcast_admin_dashboard from row-level to statement-level trigger
--    to prevent flooding the database with hundreds of realtime broadcasts during bulk imports
-- 3. Optimize load_workspace to not aggregate student accounts when role is STAFF

begin;

create index if not exists idx_users_role on public.users(role);
create index if not exists idx_users_faculty on public.users(faculty);
create index if not exists idx_users_created_at on public.users(created_at);

-- Statement-level broadcast function for bulk changes
create or replace function public.broadcast_admin_event_dashboard_change_stmt()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_session record;
begin
  for v_session in
    select s.token_hash
    from public.app_sessions s
    join public.users u on u.id = s.user_id
    where u.role = 'ADMIN' and s.expires_at > now()
  loop
    perform realtime.send(
      jsonb_build_object(
        'changed_at', clock_timestamp(),
        'source_table', tg_table_name,
        'operation', tg_op
      ),
      'dashboard_changed',
      'aru-admin-dashboard:' || v_session.token_hash,
      true
    );
  end loop;
  return null;
end;
$$;

drop trigger if exists users_broadcast_admin_dashboard on public.users;
create trigger users_broadcast_admin_dashboard
  after insert or update or delete on public.users
  for each statement execute function public.broadcast_admin_event_dashboard_change_stmt();

-- Optimized load_workspace
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
    'registrations',coalesce((select jsonb_agg(jsonb_build_object('event_id',r.event_id,'user_id',r.user_id,'status',r.status,'passcode',case when v_user.role in ('STAFF','ADMIN') or r.status='COMPLETED' then pc.code else null end,'checkin_at',r.checkin_at,'checkout_at',r.checkout_at,'is_walkin',r.is_walkin,'checked_in_by',r.checked_in_by,'checked_out_by',r.checked_out_by,'checkin_staff_name',checkin_staff.full_name,'checkout_staff_name',checkout_staff.full_name)) from public.event_registrations r left join public.event_passcodes pc on pc.id=r.passcode_id left join public.users checkin_staff on checkin_staff.id=r.checked_in_by left join public.users checkout_staff on checkout_staff.id=r.checked_out_by where v_user.role in ('STAFF','ADMIN') or r.user_id=v_user.id),'[]'::jsonb),
    'passcodes',case when v_user.role in ('STAFF','ADMIN') then coalesce((select jsonb_agg(jsonb_build_object('event_id',p.event_id,'code',p.code,'is_reserve',p.is_reserve,'assigned_to',p.assigned_to)) from public.event_passcodes p),'[]'::jsonb) else '[]'::jsonb end,
    'academic_catalog',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'majors',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name) order by m.name) from public.academic_majors m where m.faculty_id=f.id),'[]'::jsonb)) order by f.name) from public.academic_faculties f),'[]'::jsonb)
  );
end; $$;

revoke all on function public.load_workspace(text) from public;
grant execute on function public.load_workspace(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
