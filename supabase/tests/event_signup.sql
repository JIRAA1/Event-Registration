-- Run against an isolated database after migrations 001-031.
begin;
set local search_path=public,extensions,pg_temp;
do $test$
declare
  admin_id uuid;
  event_a uuid;
  event_b uuid;
  admin_token text:=encode(gen_random_bytes(32),'hex');
  proof text:=encode(gen_random_bytes(32),'hex');
  kiosk_proof text:=encode(gen_random_bytes(32),'hex');
  profile jsonb;
  application_id uuid;
  kiosk_id uuid;
  device jsonb;
  station_token text;
  result jsonb;
  password text;
begin
  insert into users(student_id,full_name,password_hash,enrollment_year,role)
    values('qa-'||substr(admin_token,1,12),'Registration QA',crypt(admin_token,gen_salt('bf')),0,'ADMIN') returning id into admin_id;
  insert into app_sessions(user_id,token_hash,expires_at) values(admin_id,encode(digest(admin_token,'sha256'),'hex'),now()+interval '1 hour');
  insert into events(title) values('Registration QA A') returning id into event_a;
  insert into events(title) values('Registration QA B') returning id into event_b;
  result:=registration_admin(admin_token,event_a,'CONTACT','https://example.org/contact');
  assert result->>'contact'='https://example.org/contact';
  assert registration_info(event_b)->>'contact'='https://example.org/contact';
  assert registration_admin(admin_token,event_a,'CONTACT','')->>'contact'='';
  begin
    perform registration_admin('invalid-token',event_a,'CONTACT','https://example.org/unauthorized');
    raise exception 'unauthorized contact update accepted' using errcode='23505';
  exception when raise_exception then assert sqlerrm like '%แอดมิน%'; end;
  profile:=jsonb_build_object('student_id','๐๖๙๑๒๓๔๕','full_name','QA Student','faculty','คณะครุศาสตร์','major','คณิตศาสตร์',
    'birth_date','01012549','phone','0800000000','study_year','2','class_group','1','prefix','นาย');

  begin
    perform registration_account_step(event_a,'06912345');
    raise exception 'closed lookup accepted' using errcode='23505';
  exception when raise_exception then assert sqlerrm like '%ปิดรับ%'; end;
  perform registration_admin(admin_token,event_a,'OPEN');
  assert registration_account_step(event_a,'๐๖๙๑๒๓๔๕')='new';
  begin
    perform registration_apply(event_a,profile || '{"class_group":"5"}'::jsonb,proof);
    raise exception 'invalid group accepted' using errcode='23505';
  exception when raise_exception then assert sqlerrm like '%หมู่เรียน%'; end;
  begin
    perform registration_apply(event_a,profile - 'prefix',proof);
    raise exception 'missing title accepted' using errcode='23505';
  exception when raise_exception then assert sqlerrm like '%กรุณาตรวจ%'; end;
  application_id:=(registration_apply(event_a,profile,proof)->>'id')::uuid;
  assert registration_account_step(event_a,'06912345')='existing';
  password:=registration_receipt(event_a,proof,null,true)->>'password';
  assert password is not distinct from '01012549';
  result:=login_student('06912345',password);
  assert load_workspace(result->>'session_token')->'applications'->0->>'status'='PENDING';
  assert jsonb_array_length(load_workspace(result->>'session_token')->'registrations')=0;
  assert registration_apply(event_a,profile,proof)->>'id'=application_id::text;
  begin
    perform registration_apply(event_a,profile || '{"student_id":"06912345"}'::jsonb,kiosk_proof);
    raise exception 'duplicate request accepted' using errcode='23505';
  exception when raise_exception then assert sqlerrm like '%บัญชีเดิม%'; end;
  perform registration_review(admin_token,application_id,'CORRECT','ตรวจสอบชื่อ');
  assert registration_receipt(event_a,proof)->>'status'='CORRECT';
  result:=login_student('06912345',password);
  assert load_workspace(result->>'session_token')->'applications'->0->>'online'='true';
  assert registration_correction(result->>'session_token',event_a,application_id)->>'note'='ตรวจสอบชื่อ';
  begin
    perform registration_correction(admin_token,event_a,application_id);
    raise exception 'wrong session accepted' using errcode='23505';
  exception when raise_exception then assert sqlerrm like '%เจ้าของ%'; end;
  perform registration_admin(admin_token,event_a,'CLOSE');
  perform registration_correction(result->>'session_token',event_a,application_id,profile||'{"phone":"0812345678"}');
  assert registration_receipt(event_a,proof)->>'status'='PENDING';
  assert (select a.profile->>'phone' from event_pass_private.applications a where id=application_id)='0812345678';
  perform registration_admin(admin_token,event_a,'OPEN');
  perform registration_review(admin_token,application_id,'CORRECT','ตรวจสอบอีกครั้ง');
  perform registration_apply(event_a,profile,proof);
  insert into event_passcodes(event_id,code,is_reserve) values(event_a,'QA-ONLINE',true);
  perform registration_review(admin_token,application_id,'APPROVE');
  perform registration_review(admin_token,application_id,'APPROVE');
  assert registration_account_step(event_a,'06912345')='existing';
  assert (select full_name='นายQA Student' and class_group='1' from users where student_id='06912345');
  assert registration_receipt(event_a,proof,null,true)->>'password' is null;
  assert (registration_login_join(event_a,'06912345',password)->>'already')::boolean;
  assert not (registration_login_join(event_a,'06912345','incorrect')->>'success')::boolean;
  begin
    perform registration_login_join(event_b,'06912345',password);
    raise exception 'closed event accepted' using errcode='23505';
  exception when raise_exception then assert sqlerrm like '%ปิดรับ%'; end;

  update users set password_hash=crypt('previous-personal-password',gen_salt('bf')) where student_id='06912345';
  password:='previous-personal-password';
  device:=registration_admin(admin_token,event_b,'STATION');
  station_token:=registration_station_login(device->>'username',device->>'password')->>'token';
  kiosk_id:=(registration_apply(event_b,profile,kiosk_proof,station_token)->>'id')::uuid;
  begin
    perform registration_receipt(event_b,kiosk_proof);
    raise exception 'device receipt exposed' using errcode='23505';
  exception when raise_exception then assert sqlerrm like '%ไม่พบ%'; end;
  perform registration_review(admin_token,kiosk_id,'APPROVE');
  assert registration_receipt(event_b,kiosk_proof,station_token)->>'status'='APPROVED';
  insert into event_passcodes(event_id,code,is_reserve) values(event_b,'QA-RESERVE',true);
  perform registration_review(admin_token,kiosk_id,'APPROVE');
  result:=registration_receipt(event_b,kiosk_proof,station_token,true);
  assert not (result->>'issued')::boolean and result->>'password' is null;
  assert (login_student('06912345',password)->>'success')::boolean;
  assert (select count(*)=1 from users where student_id='06912345');
  assert (select count(*)=2 from event_registrations r join users u on u.id=r.user_id where u.student_id='06912345');
  insert into events(title,online_registration) values('Bulk QA',true) returning id into event_a;
  application_id:=(registration_apply(event_a,profile||'{"student_id":"06912347"}',encode(gen_random_bytes(32),'hex'))->>'id')::uuid;
  kiosk_id:=(registration_apply(event_a,profile||'{"student_id":"06912346"}',encode(gen_random_bytes(32),'hex'))->>'id')::uuid;
  insert into event_passcodes(event_id,code,is_reserve) values(event_a,'QA-BULK-1',true);
  insert into event_passcodes(event_id,code,is_reserve) values(event_a,'QA-BULK-2',true);
  assert jsonb_array_length(registration_export(admin_token,event_a))=2;
  result:=registration_export(admin_token,event_a,array[application_id]);
  assert jsonb_array_length(result)=1 and result->0->>0='06912347' and result->0->>7='รอยืนยัน';
  assert registration_export(admin_token,event_b,array[application_id])='[]'::jsonb;
  assert registration_export(admin_token,event_a,array[]::uuid[])='[]'::jsonb;
  perform registration_approve_many(admin_token,event_a,array[application_id,kiosk_id]);
  assert (select count(distinct passcode_id)=2 from event_registrations where event_id=event_a);
  result:=registration_export(admin_token,event_a);
  assert result='[]'::jsonb;
  insert into events(title,online_registration) values('Year one QA',true) returning id into event_a;
  update users set study_year=1 where student_id='06912345';
  result:=registration_login_join(event_a,'06912345',password);
  assert (result->>'success')::boolean and not (result ? 'pending');
  assert (select count(*)=1 from event_registrations where event_id=event_a and passcode_id is null);
  assert registration_export(admin_token,event_a)='[]'::jsonb;
  perform registration_station_logout(station_token);
end;
$test$;
rollback;
