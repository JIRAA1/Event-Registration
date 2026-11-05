create or replace function public.admin_import_event_students(
  p_admin_token text,
  p_event_id uuid,
  p_students jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_student jsonb;
  v_admin_id uuid;
  v_user_id uuid;
  v_registration_id uuid;
  v_passcode_id uuid;
  v_passcode text;
  v_student_id varchar(20);
  v_full_name varchar(255);
  v_faculty varchar(150);
  v_major varchar(150);
  v_class_group varchar(50);
  v_enrollment_year int;
  v_study_year int;
  v_birth_date varchar(8);
  v_phone varchar(20);
  v_existing_role varchar(20);
  v_imported_count int := 0;
  v_skipped_count int := 0;
  v_passcodes_assigned_count int := 0;
begin
  select u.id into v_admin_id
  from public.app_sessions s
  join public.users u on u.id = s.user_id
  where s.token_hash = encode(digest(p_admin_token, 'sha256'), 'hex')
    and s.expires_at > now()
    and u.role = 'ADMIN';

  if v_admin_id is null then
    return jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'สงวนสิทธิ์เฉพาะแอดมิน');
  end if;
  if jsonb_typeof(p_students) <> 'array' then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_INPUT', 'message', 'รูปแบบรายชื่อ CSV ไม่ถูกต้อง');
  end if;
  if not exists(select 1 from public.events where id = p_event_id) then
    return jsonb_build_object('success', false, 'error_code', 'EVENT_NOT_FOUND', 'message', 'ไม่พบกิจกรรมนี้');
  end if;

  begin
    for v_student in select value from jsonb_array_elements(p_students) loop
      v_student_id := nullif(trim(v_student->>'student_id'), '');
      v_full_name := nullif(trim(v_student->>'full_name'), '');
      v_faculty := nullif(trim(v_student->>'faculty'), '');
      v_major := nullif(trim(v_student->>'major'), '');
      v_class_group := nullif(trim(v_student->>'class_group'), '');
      v_enrollment_year := coalesce(nullif(trim(v_student->>'enrollment_year'), '')::int, 2569);
      v_birth_date := nullif(trim(v_student->>'birth_date'), '');
      v_phone := nullif(trim(v_student->>'phone'), '');

      if v_student_id is null or v_full_name is null or v_birth_date is null then
        raise exception 'กรุณาระบุ student_id, full_name และ birth_date ให้ครบทุกแถว';
      end if;

      select role into v_existing_role from public.users where student_id = v_student_id for update;
      if v_existing_role is not null and v_existing_role <> 'STUDENT' then
        raise exception 'รหัสผู้ใช้ % เป็นบัญชีเจ้าหน้าที่ ไม่สามารถนำเข้าเป็นนักศึกษาได้', v_student_id;
      end if;
      if exists(
        select 1 from public.users u
        join public.event_registrations r on r.user_id = u.id
        where u.student_id = v_student_id and r.event_id = p_event_id
      ) then
        v_skipped_count := v_skipped_count + 1;
        continue;
      end if;

      v_study_year := greatest(1, least(8, extract(year from now())::int + 544 - v_enrollment_year));
      insert into public.users(student_id,password_hash,full_name,faculty,major,class_group,enrollment_year,study_year,birth_date,phone,role)
        values(v_student_id,crypt(coalesce(v_birth_date,''),gen_salt('bf')),v_full_name,v_faculty,v_major,v_class_group,v_enrollment_year,v_study_year,v_birth_date,v_phone,'STUDENT')
        on conflict(student_id) do update set
          full_name=excluded.full_name,
          faculty=excluded.faculty,
          major=excluded.major,
          class_group=excluded.class_group,
          enrollment_year=excluded.enrollment_year,
          study_year=excluded.study_year,
          birth_date=excluded.birth_date,
          phone=excluded.phone
        returning id into v_user_id;

      v_passcode_id := null;
      v_passcode := null;
      if v_enrollment_year <= 2568 then
        select id,code into v_passcode_id,v_passcode
        from public.event_passcodes
        where event_id=p_event_id and is_reserve=true and assigned_to is null
        order by id
        limit 1
        for update skip locked;
        if v_passcode_id is null then
          raise exception 'Passcode สำรองไม่พอสำหรับรายชื่อทั้งหมด กรุณาเติม Passcode แล้วนำเข้าใหม่';
        end if;
        update public.event_passcodes set assigned_to=v_user_id,assigned_at=now() where id=v_passcode_id;
      end if;

      v_registration_id := null;
      insert into public.event_registrations(event_id,user_id,passcode_id,status,is_walkin,registered_by)
        values(p_event_id,v_user_id,v_passcode_id,'REGISTERED',false,v_admin_id)
        on conflict(event_id,user_id) do nothing
        returning id into v_registration_id;

      if v_registration_id is null then
        if v_passcode_id is not null then
          update public.event_passcodes set assigned_to=null,assigned_at=null where id=v_passcode_id and assigned_to=v_user_id;
        end if;
        v_skipped_count := v_skipped_count + 1;
        continue;
      end if;

      v_imported_count := v_imported_count + 1;
      if v_passcode_id is not null then v_passcodes_assigned_count := v_passcodes_assigned_count + 1; end if;
    end loop;
  exception when others then
    return jsonb_build_object('success',false,'error_code','IMPORT_FAILED','message',sqlerrm);
  end;

  return jsonb_build_object(
    'success',true,
    'imported_count',v_imported_count,
    'skipped_count',v_skipped_count,
    'passcodes_assigned_count',v_passcodes_assigned_count
  );
end;
$$;

grant execute on function public.admin_import_event_students(text, uuid, jsonb) to anon, authenticated;
notify pgrst, 'reload schema';
