begin;
set local search_path = public, extensions, pg_temp;
do $test$
declare
  staff uuid; admin_id uuid; student uuid; activity uuid; ticket uuid;
  reg event_registrations%rowtype;
  answer jsonb; year int; secret text;
begin
  insert into users(student_id,full_name,password_hash,enrollment_year,role) values
    ('mode-test-staff','Staff','test',0,'STAFF') returning id into staff;
  insert into users(student_id,full_name,password_hash,enrollment_year,role) values
    ('mode-test-admin','Admin','test',0,'ADMIN') returning id into admin_id;
  insert into app_sessions(user_id,token_hash,expires_at) values
    (staff,encode(digest('mode-staff','sha256'),'hex'),now()+interval '1 hour'),
    (admin_id,encode(digest('mode-admin','sha256'),'hex'),now()+interval '1 hour');
  insert into events(title,scan_mode) values ('Device mode QA','CHECKIN') returning id into activity;
  for year in 1..8 loop
    secret := 'mode-test-' || year;
    insert into users(student_id,full_name,password_hash,enrollment_year,study_year,role)
      values(secret,'Student','test',2569,year,'STUDENT') returning id into student;
    insert into app_sessions(user_id,token_hash,expires_at)
      values(student,encode(digest(secret,'sha256'),'hex'),now()+interval '1 hour');
    insert into event_registrations(event_id,user_id) values(activity,student);
    if year in (1,3) then
      insert into event_passcodes(event_id,code,is_reserve) values(activity,secret,true);
    end if;
    answer := issue_event_qr(secret,activity);
    assert answer->>'mode' = 'CHECKIN' and answer ? 'token';
    ticket := (answer->>'token')::uuid;
    answer := redeem_device_event_qr('mode-admin',activity,'CHECKOUT',ticket);
    assert not coalesce((answer->>'success')::boolean,false);
    answer := redeem_device_event_qr('mode-staff',activity,'CHECKIN',ticket);
    assert answer->>'new_status' is not distinct from 'ATTENDING';
    select * into strict reg from event_registrations where event_id=activity and user_id=student;
    assert reg.status='ATTENDING' and reg.checkin_at is not null and reg.checkout_at is null and reg.checked_in_by=staff;
    answer := redeem_device_event_qr('mode-staff',activity,'CHECKIN',ticket);
    assert not coalesce((answer->>'success')::boolean,false);
    answer := issue_event_qr(secret,activity);
    assert answer->>'mode' = 'CHECKOUT' and answer ? 'token';
    ticket := (answer->>'token')::uuid;
    answer := redeem_device_event_qr('mode-staff',activity,'CHECKIN',ticket);
    assert not coalesce((answer->>'success')::boolean,false);
    answer := redeem_device_event_qr('mode-admin',activity,'CHECKOUT',ticket);
    assert answer->>'new_status' is not distinct from 'COMPLETED';
    select * into strict reg from event_registrations where event_id=activity and user_id=student;
    assert reg.status='COMPLETED' and reg.checkout_at >= reg.checkin_at and reg.checked_out_by=admin_id;
    assert (reg.passcode_id is not null) = (year in (2,3));
    assert not coalesce((redeem_device_event_qr('mode-admin',activity,'CHECKOUT',ticket)->>'success')::boolean,false);
    assert not (issue_event_qr(secret,activity) ? 'token');
  end loop;
  assert (select scan_mode='CHECKIN' from events where id=activity);
  insert into event_passcodes(event_id,code,is_reserve) values(activity,'late-test',true);
  perform admin_match_passcodes_batch('mode-admin',activity,25);
  assert (select count(*)=1 from event_registrations where event_id=activity and status='COMPLETED'
          and passcode_id=(select id from event_passcodes where event_id=activity and code='late-test'));
end;
$test$;
rollback;
