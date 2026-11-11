-- Run after migrations 001-028 in an isolated database.
begin;
set local search_path=public,extensions,pg_temp;
do $test$
declare
  admin_id uuid; token text:=encode(gen_random_bytes(32),'hex'); roster jsonb;
  result jsonb; student_token text; qa_event uuid; existing_hash text; bad jsonb;
begin
  insert into users(student_id,full_name,password_hash,enrollment_year,role)
    values('roster-qa','QA',crypt(token,gen_salt('bf')),0,'ADMIN') returning id into admin_id;
  insert into app_sessions(user_id,token_hash,expires_at)
    values(admin_id,encode(digest(token,'sha256'),'hex'),now()+interval '1 hour');
  roster:=jsonb_build_array(jsonb_build_object('student_id','16915039','full_name','นายชวัลวิทย์ สถาปนพงษ์',
    'faculty','คณะครุศาสตร์','major','การศึกษาพิเศษและการสอนภาษาไทย (4 ปี)','class_group','1',
    'study_year',1,'enrollment_year',2569,'birth_date','18112550','phone',''));
  result:=admin_import_student_roster(token,roster);
  assert result->>'imported_count'='1';
  result:=login_student('16915039','18112550');
  assert (result->>'success')::boolean;
  student_token:=result->>'session_token';
  assert not exists(select 1 from event_registrations r join users u on r.user_id=u.id where u.student_id='16915039');
  update users set password_hash=crypt('changed-password',gen_salt('bf')) where student_id='16915039';
  select password_hash into existing_hash from users where student_id='16915039';
  assert admin_import_student_roster(token,roster)->>'skipped_count'='1';
  assert (select password_hash=existing_hash from users where student_id='16915039');
  insert into events(title,online_registration) values('Roster QA',true) returning id into qa_event;
  assert exists(select 1 from jsonb_array_elements(student_open_events(student_token)) e where e->>'id'=qa_event::text);
  assert registration_join(qa_event,student_token)->>'already'='false';
  assert exists(select 1 from event_registrations r join users u on u.id=r.user_id where r.event_id=qa_event and u.student_id='16915039');
  assert not exists(select 1 from jsonb_array_elements(student_open_events(student_token)) e where e->>'id'=qa_event::text);
  roster:=jsonb_build_array(roster->0 || '{"student_id":"16815039","study_year":2}');
  perform admin_import_student_roster(token,roster);
  result:=login_student('16815039','18112550');
  assert registration_join(qa_event,result->>'session_token')->>'pending'='true';
  begin
    perform admin_import_student_roster(student_token,roster);
    raise exception 'student imported accounts' using errcode='23505';
  exception when raise_exception then assert sqlerrm like '%แอดมิน%'; end;
  bad:=jsonb_build_array(roster->0 || '{"student_id":"16915040"}',roster->0 || '{"student_id":"16915041","birth_date":"31022550"}');
  begin
    perform admin_import_student_roster(token,bad);
    raise exception 'invalid date accepted' using errcode='23505';
  exception when datetime_field_overflow then null; end;
  assert not exists(select 1 from users where student_id in ('16915040','16915041'));
end;
$test$;
rollback;
