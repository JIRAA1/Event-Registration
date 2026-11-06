-- Persistent faculty and major directory controlled by administrators.
create table if not exists public.academic_faculties (
  id uuid primary key default gen_random_uuid(),
  name varchar(150) not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.academic_majors (
  id uuid primary key default gen_random_uuid(),
  faculty_id uuid not null references public.academic_faculties(id) on delete cascade,
  name varchar(150) not null,
  created_at timestamptz not null default now(),
  unique(faculty_id, name)
);

-- Seed the catalog already used by the application; existing directories are preserved.
do $seed$
declare v_catalog jsonb := '{"คณะครุศาสตร์":["คณิตศาสตร์","วิทยาศาสตร์","สังคมศึกษา","การศึกษาปฐมวัย","คอมพิวเตอร์ศึกษา","พลศึกษา","การสอนภาษาไทย","การสอนภาษาอังกฤษ","การประถมศึกษา","การศึกษาพิเศษ","การศึกษาพิเศษและการสอนภาษาไทย","การศึกษา","ศิลปศึกษา","ดนตรีศึกษา","นาฏศิลป์ศึกษา","การสอนภาษาจีน","ธุรกิจและอาชีวศึกษา"],"คณะมนุษยศาสตร์และสังคมศาสตร์":["ภาษาอังกฤษ","ภาษาไทย","ภาษาญี่ปุ่น","การพัฒนาชุมชนและสังคม","สหวิทยาการอิสลามเพื่อการพัฒนา","สหวิทยาการเพื่อการจัดการฮาลาล","ประวัติศาสตร์","ภาษาจีน","นิเทศศาสตร์","นิเทศศาสตร์ดิจิทัล","นิติศาสตร์","รัฐประศาสนศาสตร์","การปกครองท้องถิ่น","การจัดการรัฐกิจและการปกครองท้องถิ่น","ประยุกต์ศิลป์","ศิลปะการแสดง","ดนตรีสากล","ดนตรีสร้างสรรค์","ดนตรีศึกษา","ศิลปศึกษา","นาฏศิลป์ศึกษา","การสอนภาษาจีน"],"คณะวิทยาศาสตร์และเทคโนโลยี":["เกษตรศาสตร์","เคมี","วิทยาการคอมพิวเตอร์","คณิตศาสตร์ประยุกต์","เทคโนโลยีสารสนเทศ","อาชีวอนามัยและความปลอดภัย","วิทยาศาสตร์และการจัดการเทคโนโลยีอาหาร","จุลชีววิทยา","คหกรรมศาสตร์","วิทยาศาสตร์สิ่งแวดล้อม","เทคโนโลยีการเกษตรสมัยใหม่","สาธารณสุขศาสตร์","วิศวกรรมไฟฟ้า","วิศวกรรมการจัดการ","เทคโนโลยีอุตสาหกรรม (ต่อเนื่อง)","วิทยาศาสตร์ศึกษา","วิศวกรรมปัญญาประดิษฐ์ (ต่อเนื่อง)","เทคโนโลยีสิ่งแวดล้อม"],"คณะวิทยาการจัดการ":["การบัญชี","การจัดการ","การตลาด","การบริหารทรัพยากรมนุษย์","การจัดการโลจิสติกส์และซัพพลายเชน","การท่องเที่ยว","คอมพิวเตอร์ธุรกิจ","เศรษฐศาสตร์การเงินการธนาคาร","การจัดการธุรกิจโรงแรม","การจัดการธุรกิจการค้าสมัยใหม่","ธุรกิจและอาชีวศึกษา"]}'::jsonb;
  v_entry record;
  v_faculty_id uuid;
  v_major text;
begin
  for v_entry in select key, value from jsonb_each(v_catalog) loop
    insert into public.academic_faculties(name) values(v_entry.key)
      on conflict(name) do update set name=excluded.name
      returning id into v_faculty_id;
    for v_major in select jsonb_array_elements_text(v_entry.value) loop
      insert into public.academic_majors(faculty_id, name) values(v_faculty_id, v_major)
        on conflict(faculty_id, name) do nothing;
    end loop;
  end loop;
end;
$seed$;

alter table public.academic_faculties enable row level security;
alter table public.academic_majors enable row level security;
revoke all on public.academic_faculties, public.academic_majors from anon, authenticated;

create or replace function public.admin_manage_academic_catalog(
  p_admin_token text,
  p_action text,
  p_faculty_id uuid default null,
  p_faculty_name text default null,
  p_major_id uuid default null,
  p_major_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_faculty_name text := nullif(trim(coalesce(p_faculty_name, '')), '');
  v_major_name text := nullif(trim(coalesce(p_major_name, '')), '');
  v_old_faculty_name text;
  v_old_major_name text;
begin
  if not exists (
    select 1 from public.app_sessions s join public.users u on u.id=s.user_id
    where s.token_hash=encode(digest(p_admin_token, 'sha256'), 'hex')
      and s.expires_at > now() and u.role='ADMIN'
  ) then
    return jsonb_build_object('success',false,'error_code','FORBIDDEN','message','สงวนสิทธิ์เฉพาะแอดมิน');
  end if;

  if p_action in ('ADD_FACULTY','UPDATE_FACULTY') and (length(coalesce(v_faculty_name,'')) < 2 or length(v_faculty_name) > 150) then
    return jsonb_build_object('success',false,'error_code','INVALID_INPUT','message','ชื่อคณะต้องมี 2 ถึง 150 ตัวอักษร');
  end if;
  if p_action in ('ADD_MAJOR','UPDATE_MAJOR') and (length(coalesce(v_major_name,'')) < 2 or length(v_major_name) > 150) then
    return jsonb_build_object('success',false,'error_code','INVALID_INPUT','message','ชื่อสาขาต้องมี 2 ถึง 150 ตัวอักษร');
  end if;

  if p_action = 'ADD_FACULTY' then
    insert into public.academic_faculties(name) values(v_faculty_name);
  elsif p_action = 'UPDATE_FACULTY' then
    select name into v_old_faculty_name from public.academic_faculties where id=p_faculty_id for update;
    if not found then return jsonb_build_object('success',false,'error_code','NOT_FOUND','message','ไม่พบคณะนี้'); end if;
    update public.academic_faculties set name=v_faculty_name where id=p_faculty_id;
    update public.users set faculty=v_faculty_name where faculty=v_old_faculty_name;
  elsif p_action = 'DELETE_FACULTY' then
    select name into v_old_faculty_name from public.academic_faculties where id=p_faculty_id for update;
    if not found then return jsonb_build_object('success',false,'error_code','NOT_FOUND','message','ไม่พบคณะนี้'); end if;
    if exists(select 1 from public.users where faculty=v_old_faculty_name) then
      return jsonb_build_object('success',false,'error_code','FACULTY_IN_USE','message','ยังลบคณะนี้ไม่ได้ มีผู้ใช้สังกัดอยู่ กรุณาย้ายหรือแก้ข้อมูลผู้ใช้ก่อน');
    end if;
    delete from public.academic_faculties where id=p_faculty_id;
  elsif p_action = 'ADD_MAJOR' then
    if not exists(select 1 from public.academic_faculties where id=p_faculty_id) then
      return jsonb_build_object('success',false,'error_code','FACULTY_NOT_FOUND','message','กรุณาเลือกคณะที่มีอยู่');
    end if;
    insert into public.academic_majors(faculty_id,name) values(p_faculty_id,v_major_name);
  elsif p_action = 'UPDATE_MAJOR' then
    select m.name,f.name into v_old_major_name,v_old_faculty_name
      from public.academic_majors m join public.academic_faculties f on f.id=m.faculty_id
      where m.id=p_major_id for update of m;
    if not found then return jsonb_build_object('success',false,'error_code','NOT_FOUND','message','ไม่พบสาขานี้'); end if;
    update public.academic_majors set name=v_major_name where id=p_major_id;
    update public.users set major=v_major_name where faculty=v_old_faculty_name and major=v_old_major_name;
  elsif p_action = 'DELETE_MAJOR' then
    select m.name,f.name into v_old_major_name,v_old_faculty_name
      from public.academic_majors m join public.academic_faculties f on f.id=m.faculty_id
      where m.id=p_major_id for update of m;
    if not found then return jsonb_build_object('success',false,'error_code','NOT_FOUND','message','ไม่พบสาขานี้'); end if;
    if exists(select 1 from public.users where faculty=v_old_faculty_name and major=v_old_major_name) then
      return jsonb_build_object('success',false,'error_code','MAJOR_IN_USE','message','ยังลบสาขานี้ไม่ได้ มีผู้ใช้เลือกสาขานี้อยู่ กรุณาย้ายหรือแก้ข้อมูลผู้ใช้ก่อน');
    end if;
    delete from public.academic_majors where id=p_major_id;
  else
    return jsonb_build_object('success',false,'error_code','INVALID_ACTION','message','ไม่รู้จักคำสั่งจัดการรายการนี้');
  end if;

  return jsonb_build_object('success',true);
exception when unique_violation then
  return jsonb_build_object('success',false,'error_code','DUPLICATE_NAME','message','ชื่อนี้มีอยู่ในรายการแล้ว');
end;
$$;

revoke all on function public.admin_manage_academic_catalog(text,text,uuid,text,uuid,text) from public;
grant execute on function public.admin_manage_academic_catalog(text,text,uuid,text,uuid,text) to anon, authenticated;

-- Expose the managed directory through the existing, session-guarded workspace RPC.
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
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'location',e.location,'activity_hours',e.activity_hours,'status',e.status,'redirect_url_year1',e.redirect_url_year1,'scan_mode',e.scan_mode,'banner_url',e.banner_url) order by e.created_at desc) from public.events e where v_user.role in ('STAFF','ADMIN') or exists(select 1 from public.event_registrations r where r.event_id=e.id and r.user_id=v_user.id)),'[]'::jsonb),
    'users',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'student_id',u.student_id,'full_name',u.full_name,'faculty',u.faculty,'major',u.major,'class_group',u.class_group,'enrollment_year',u.enrollment_year,'study_year',u.study_year,'birth_date',case when v_user.role='ADMIN' then u.birth_date else null end,'phone',case when v_user.role='ADMIN' or u.id=v_user.id then u.phone else null end,'role',u.role)) from public.users u where v_user.role in ('STAFF','ADMIN') or u.id=v_user.id),'[]'::jsonb),
    'registrations',coalesce((select jsonb_agg(jsonb_build_object('event_id',r.event_id,'user_id',r.user_id,'status',r.status,'passcode',case when v_user.role in ('STAFF','ADMIN') or r.status='COMPLETED' then pc.code else null end,'checkin_at',r.checkin_at,'checkout_at',r.checkout_at,'is_walkin',r.is_walkin,'checked_in_by',r.checked_in_by,'checked_out_by',r.checked_out_by,'checkin_staff_name',checkin_staff.full_name,'checkout_staff_name',checkout_staff.full_name)) from public.event_registrations r left join public.event_passcodes pc on pc.id=r.passcode_id left join public.users checkin_staff on checkin_staff.id=r.checked_in_by left join public.users checkout_staff on checkout_staff.id=r.checked_out_by where v_user.role in ('STAFF','ADMIN') or r.user_id=v_user.id),'[]'::jsonb),
    'passcodes',case when v_user.role in ('STAFF','ADMIN') then coalesce((select jsonb_agg(jsonb_build_object('event_id',p.event_id,'code',p.code,'is_reserve',p.is_reserve,'assigned_to',p.assigned_to)) from public.event_passcodes p),'[]'::jsonb) else '[]'::jsonb end,
    'academic_catalog',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'majors',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name) order by m.name) from public.academic_majors m where m.faculty_id=f.id),'[]'::jsonb)) order by f.name) from public.academic_faculties f),'[]'::jsonb)
  );
end; $$;

grant execute on function public.load_workspace(text) to anon, authenticated;
notify pgrst, 'reload schema';
