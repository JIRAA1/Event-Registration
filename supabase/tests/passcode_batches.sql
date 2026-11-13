begin;
set local search_path=public,extensions,pg_temp;
do $test$
declare admin uuid; e uuid; t text:='batch-test'; r jsonb; total int:=0; codes text[];
begin
 assert not has_function_privilege('anon','public.process_qr_scan(text,uuid,uuid)','EXECUTE');
 assert not has_function_privilege('authenticated','public.process_qr_scan(text,uuid,uuid)','EXECUTE');
 insert into users(student_id,full_name,password_hash,enrollment_year,role) values('batch-admin','QA','test',0,'ADMIN') returning id into admin;
 insert into app_sessions(user_id,token_hash,expires_at) values(admin,encode(digest(t,'sha256'),'hex'),now()+interval '1 hour');
 insert into events(title) values('Batch QA') returning id into e;
 for part in 0..9 loop
   select array_agg('BATCH-'||n) into codes from generate_series(part*50+1,part*50+50) n;
   r:=admin_add_reserve_passcodes(t,e,codes);assert r->>'added_count'='50';
   assert admin_add_reserve_passcodes(t,e,codes)->>'added_count'='0';
 end loop;
 insert into users(student_id,full_name,password_hash,enrollment_year,study_year,role)
 select (16880000+n)::text,'Batch QA','test',2568,2,'STUDENT' from generate_series(1,501) n;
 insert into event_registrations(event_id,user_id) select e,id from users where student_id between '16880001' and '16880501';
 assert not exists(select 1 from event_registrations where event_id=e and passcode_id is not null);
 update event_registrations set status='ATTENDING',checkin_at=now() where event_id=e and user_id in(select id from users where student_id between '16880001' and '16880500');
 for part in 1..20 loop
   r:=admin_match_passcodes_batch(t,e,25);assert r->>'matched_count'='25';total:=total+(r->>'matched_count')::int;
 end loop;
 assert total=500;
 assert (select count(distinct passcode_id)=500 from event_registrations where event_id=e);
 assert (select count(*)=1 from event_registrations where event_id=e and passcode_id is null and status='REGISTERED');
 assert admin_match_passcodes_batch(t,e,25)->>'matched_count'='0';
 assert (select count(*)=500 from event_passcodes where event_id=e and assigned_to is not null);
 begin
  perform admin_match_passcodes_batch('wrong',e,25);
  raise exception 'unauthorized' using errcode='23505';
 exception when raise_exception then assert sqlerrm like '%แอดมิน%';end;
end;
$test$;
rollback;
