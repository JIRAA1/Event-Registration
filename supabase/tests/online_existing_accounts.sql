begin;
set local search_path=public,extensions,pg_temp;
do $test$
declare e uuid; profile jsonb; receipt text:=encode(gen_random_bytes(32),'hex'); app uuid;
begin
  insert into events(title,online_registration) values('Existing accounts only',true) returning id into e;
  select jsonb_build_object('student_id','16999881','prefix','นาย','full_name','QA Student','faculty',f.name,'major',m.name,'class_group','1','study_year','1','birth_date','01012549','phone','0812345678') into profile
    from academic_faculties f join academic_majors m on m.faculty_id=f.id limit 1;
  assert profile is not null;
  assert registration_account_step(e,'16999881')='new';
  begin
    perform registration_apply(e,profile,receipt);
    raise exception 'unknown student created an account' using errcode='23505';
  exception when raise_exception then assert sqlerrm like '%รหัสนักศึกษาไม่ถูกต้อง%'; end;
  assert not exists(select 1 from users where student_id='16999881');
  assert not exists(select 1 from event_pass_private.applications where event_id=e);
  insert into users(student_id,full_name,password_hash,enrollment_year,study_year,role)
    values('16999881','QA Student',crypt('01012549',gen_salt('bf')),2569,1,'STUDENT');
  assert registration_account_step(e,'16999881')='existing';
  assert (registration_login_join(e,'16999881','01012549')->>'success')::boolean;
  -- Existing correction receipts still work after disabling new online accounts.
  insert into event_pass_private.applications(event_id,student_id,profile,kiosk,receipt_hash,status)
    values(e,'16999882',profile||jsonb_build_object('student_id','16999882'),false,encode(digest(receipt,'sha256'),'hex'),'CORRECT') returning id into app;
  perform registration_apply(e,profile||jsonb_build_object('student_id','16999882'),receipt);
  assert (select status='PENDING' from event_pass_private.applications where id=app);
end;
$test$;
rollback;
