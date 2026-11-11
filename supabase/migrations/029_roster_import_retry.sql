begin;
create or replace function public.admin_import_student_roster(p_admin_token text,p_students jsonb) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare
  person jsonb; sid text; birth text; full_name text; study_year int; enrollment_year int;
  created_count int:=0; skipped_count int:=0; inserted_id uuid; birthday date;
begin
  if event_pass_private.admin_id(p_admin_token) is null then raise exception 'สงวนสิทธิ์เฉพาะแอดมิน'; end if;
  if jsonb_typeof(p_students) is distinct from 'array' or jsonb_array_length(p_students)=0 then
    raise exception 'กรุณาระบุรายชื่อนักศึกษา';
  end if;
  for person in select value from jsonb_array_elements(p_students) order by value->>'student_id' loop
    sid:=event_pass_private.student_number(person->>'student_id');
    birth:=person->>'birth_date';
    full_name:=trim(person->>'full_name');
    if sid is null or sid !~ '^[0-9]{7,8}$' or coalesce(length(full_name),0) not between 2 and 255
      or coalesce(birth,'') !~ '^[0-9]{8}$' or coalesce(person->>'study_year','') !~ '^[1-8]$'
      or coalesce(person->>'enrollment_year','') !~ '^[0-9]{4}$'
      or coalesce(length(trim(person->>'faculty')),0) not between 1 and 150
      or coalesce(length(trim(person->>'major')),0) not between 1 and 150
      or coalesce(length(trim(person->>'class_group')),0) not between 1 and 50
      then raise exception 'ข้อมูลนักศึกษา % ไม่ถูกต้อง กรุณาตรวจชื่อ ชั้นปี คณะ สาขา หมู่ และวันเกิด',sid; end if;
    birthday:=make_date(substr(birth,5,4)::int-543,substr(birth,3,2)::int,substr(birth,1,2)::int);
    if birthday>current_date then raise exception 'วันเกิดของ % อยู่ในอนาคต',sid; end if;
    -- Avoid bcrypt work for accounts already committed by an earlier batch or retry.
    if exists(select 1 from public.users where student_id=sid) then
      if exists(select 1 from public.users where student_id=sid and role<>'STUDENT') then
        raise exception 'รหัส % เป็นบัญชีเจ้าหน้าที่ กรุณาตรวจไฟล์ก่อนนำเข้า',sid;
      end if;
      skipped_count:=skipped_count+1;
      continue;
    end if;
    study_year:=(person->>'study_year')::int;
    enrollment_year:=(person->>'enrollment_year')::int;
    insert into public.users(student_id,password_hash,full_name,faculty,major,class_group,study_year,enrollment_year,birth_date,phone,role)
      values(sid,crypt(birth,gen_salt('bf')),full_name,trim(person->>'faculty'),trim(person->>'major'),
        trim(person->>'class_group'),study_year,enrollment_year,birth,nullif(trim(person->>'phone'),''),'STUDENT')
      on conflict(student_id) do nothing returning id into inserted_id;
    if found then created_count:=created_count+1;
    else
      if exists(select 1 from public.users where student_id=sid and role<>'STUDENT') then
        raise exception 'รหัส % เป็นบัญชีเจ้าหน้าที่ กรุณาตรวจไฟล์ก่อนนำเข้า',sid;
      end if;
      skipped_count:=skipped_count+1;
    end if;
  end loop;
  return jsonb_build_object('success',true,'imported_count',created_count,'skipped_count',skipped_count);
end; $$;

notify pgrst,'reload schema';
commit;
