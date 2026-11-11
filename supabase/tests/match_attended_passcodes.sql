begin;
set local search_path=public,extensions,pg_temp;
do $test$
declare
  admin_id uuid; s1 uuid; s2 uuid; s3 uuid; event_id uuid;
  admin_token text:=encode(gen_random_bytes(32),'hex');
  res jsonb;
begin
  -- 1. Create admin and students
  insert into users(student_id,full_name,password_hash,enrollment_year,role)
    values('admin-qa','Admin QA',crypt(admin_token,gen_salt('bf')),0,'ADMIN') returning id into admin_id;
  insert into app_sessions(user_id,token_hash,expires_at) values(admin_id,encode(digest(admin_token,'sha256'),'hex'),now()+interval '1 hour');

  insert into users(student_id,full_name,password_hash,enrollment_year,study_year,role,faculty)
    values('67000001','Student Unattended',crypt('01012549',gen_salt('bf')),2567,2,'STUDENT','วิทยาศาสตร์') returning id into s1;
  insert into users(student_id,full_name,password_hash,enrollment_year,study_year,role,faculty)
    values('67000002','Student Attending',crypt('01012549',gen_salt('bf')),2567,2,'STUDENT','วิทยาศาสตร์') returning id into s2;
  insert into users(student_id,full_name,password_hash,enrollment_year,study_year,role,faculty)
    values('67000003','Student Completed',crypt('01012549',gen_salt('bf')),2567,2,'STUDENT','ครุศาสตร์') returning id into s3;

  insert into events(title,status,scan_mode) values('Attended QA','ACTIVE','CHECKIN') returning id into event_id;

  -- 2. Test admin_enroll_roster_to_event
  res := admin_enroll_roster_to_event(admin_token, event_id);
  assert (res->>'success')::boolean;
  assert (res->>'enrolled_count')::int >= 3;

  -- Verify all 3 students have status REGISTERED and passcode_id is null
  assert (select count(*) = 3 from event_registrations where event_id = event_id and user_id in (s1,s2,s3) and status = 'REGISTERED' and passcode_id is null);

  -- 3. Simulate checkin and checkout
  -- s2 checks in (ATTENDING)
  update event_registrations set status = 'ATTENDING', checkin_at = now() - interval '10 minutes' where event_id = event_id and user_id = s2;
  -- s3 checks in and checks out (COMPLETED)
  update event_registrations set status = 'COMPLETED', checkin_at = now() - interval '30 minutes', checkout_at = now() where event_id = event_id and user_id = s3;

  -- 4. Admin adds 2 reserve passcodes
  res := admin_add_reserve_passcodes(admin_token, event_id, array['CODE-ALPHA', 'CODE-BETA']);
  assert (res->>'success')::boolean;
  assert (res->>'matched_count')::int = 2;

  -- Verify who got the passcodes:
  -- s3 (COMPLETED) MUST have a passcode!
  assert (select passcode_id is not null from event_registrations where event_id = event_id and user_id = s3);
  -- s2 (ATTENDING) MUST have a passcode!
  assert (select passcode_id is not null from event_registrations where event_id = event_id and user_id = s2);
  -- s1 (REGISTERED - no show) MUST NOT have a passcode!
  assert (select passcode_id is null from event_registrations where event_id = event_id and user_id = s1);

  -- 5. If admin tries to match again, 0 should match because s1 is not attended
  res := admin_match_waiting_passcodes(admin_token, event_id);
  assert (res->>'matched_count')::int = 0;

end;
$test$;
rollback;
