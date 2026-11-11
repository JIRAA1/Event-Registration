begin;
set local search_path=public,extensions,pg_temp;
do $test$
declare
  admin_id uuid; student_id uuid; second_id uuid; event_a uuid; event_b uuid;
  admin_token text:=encode(gen_random_bytes(32),'hex');
  student_token text; device jsonb; station_token text; result jsonb; ticket jsonb; checkin_time timestamptz;
begin
  insert into users(student_id,full_name,password_hash,enrollment_year,role)
    values('instant-admin','QA Admin',crypt(admin_token,gen_salt('bf')),0,'ADMIN') returning id into admin_id;
  insert into app_sessions(user_id,token_hash,expires_at) values(admin_id,encode(digest(admin_token,'sha256'),'hex'),now()+interval '1 hour');
  insert into users(student_id,full_name,password_hash,enrollment_year,study_year,role)
    values('16899991','QA Senior',crypt('01012549',gen_salt('bf')),2568,2,'STUDENT') returning id into student_id;
  insert into users(student_id,full_name,password_hash,enrollment_year,study_year,role)
    values('16899992','QA Walkin',crypt('01012549',gen_salt('bf')),2568,2,'STUDENT') returning id into second_id;
  insert into events(title,online_registration) values('Immediate QA',true) returning id into event_a;
  insert into events(title,online_registration) values('Other QA',true) returning id into event_b;
  result:=registration_login_join(event_a,'16899991','01012549');
  student_token:=result->>'session_token';
  assert not (result ? 'pending');
  assert (select r.status='REGISTERED' and r.passcode_id is null from event_registrations r where r.event_id=event_a and r.user_id=student_id);
  ticket:=issue_event_qr(student_token,event_a);
  assert (ticket->>'success')::boolean;
  assert redeem_event_qr(admin_token,event_a,'CHECKIN',(ticket->>'token')::uuid)->>'new_status'='ATTENDING';
  update events set scan_mode='CHECKOUT' where id=event_a;
  ticket:=issue_event_qr(student_token,event_a);
  assert redeem_event_qr(admin_token,event_a,'CHECKOUT',(ticket->>'token')::uuid)->>'new_status'='COMPLETED';
  assert load_workspace(student_token)->'registrations'->0->>'passcode' is null;
  result:=admin_add_reserve_passcodes(admin_token,event_a,array['LATE-ONE']);
  assert result->>'matched_count'='1';
  assert load_workspace(student_token)->'registrations'->0->>'passcode'='LATE-ONE';
  assert admin_match_waiting_passcodes(admin_token,event_a)->>'matched_count'='0';

  device:=registration_admin(admin_token,event_a,'STATION');
  station_token:=registration_station_login(device->>'username',device->>'password')->>'token';
  begin
    perform registration_station_checkin(station_token,event_b,'16899992','01012549');
    raise exception 'wrong station event accepted' using errcode='23505';
  exception when raise_exception then assert sqlerrm like '%เซสชัน%'; end;
  begin
    perform registration_station_checkin(station_token,event_a,'16899992','wrong');
    raise exception 'bad password accepted' using errcode='23505';
  exception when raise_exception then assert sqlerrm like '%รหัสผ่าน%'; end;
  assert not exists(select 1 from event_registrations r where r.user_id=second_id);
  result:=registration_station_checkin(station_token,event_a,'16899992','01012549');
  assert result->>'status'='ATTENDING';
  select r.checkin_at into checkin_time from event_registrations r where r.user_id=second_id and r.event_id=event_a;
  assert not exists(select 1 from app_sessions s where s.user_id=second_id);
  perform registration_station_checkin(station_token,event_a,'16899992','01012549');
  assert (select r.checkin_at=checkin_time and r.checkin_station from event_registrations r where r.user_id=second_id and r.event_id=event_a);
  student_token:=login_student('16899992','01012549')->>'session_token';
  ticket:=issue_event_qr(student_token,event_a);
  assert ticket->>'mode'='CHECKOUT';
  perform admin_add_reserve_passcodes(admin_token,event_a,array['LATE-TWO']);
  assert load_workspace(student_token)->'registrations'->0->>'passcode' is null;
  assert redeem_event_qr(admin_token,event_a,'CHECKOUT',(ticket->>'token')::uuid)->>'new_status'='COMPLETED';
  assert load_workspace(student_token)->'registrations'->0->>'passcode'='LATE-TWO';
  assert (select count(distinct r.passcode_id)=2 from event_registrations r where r.event_id=event_a);
  assert registration_station_checkin(station_token,event_a,'16899992','01012549')->>'status'='COMPLETED';
end;
$test$;
rollback;
