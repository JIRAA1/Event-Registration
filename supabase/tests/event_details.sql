begin;
set local search_path=public,extensions,pg_temp;
do $test$
declare a uuid; e uuid; token text:=encode(gen_random_bytes(32),'hex');
begin
  insert into users(student_id,full_name,password_hash,enrollment_year,role) values('details-admin','QA Admin',crypt(token,gen_salt('bf')),0,'ADMIN') returning id into a;
  insert into app_sessions(user_id,token_hash,expires_at) values(a,encode(digest(token,'sha256'),'hex'),now()+interval '1 hour');
  insert into events(title,location,activity_hours) values('Before','Old place',4) returning id into e;
  perform admin_update_event_details(token,e,' New title ',' New place ',6);
  assert (select title='New title' and location='New place' and activity_hours=6 and status='ACTIVE' from events where id=e);
  perform admin_update_event_details(token,e,p_status=>'CLOSED');
  assert (select title='New title' and location='New place' and activity_hours=6 and status='CLOSED' from events where id=e);
  begin
    perform admin_update_event_details('invalid',e,p_location=>'Wrong');
    raise exception 'unauthorized write' using errcode='23505';
  exception when raise_exception then assert sqlerrm like '%แอดมิน%'; end;
  begin
    perform admin_update_event_details(token,e,p_location=>'   ');
    raise exception 'blank accepted' using errcode='23505';
  exception when raise_exception then assert sqlerrm like '%กรุณาตรวจ%'; end;
  assert (select location='New place' from events where id=e);
end;
$test$;
rollback;
