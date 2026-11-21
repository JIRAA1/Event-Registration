// Isolated local PostgreSQL only. Never reads deployment credentials.
const {Client}=require('../tmp/scan-db-lab/node_modules/pg');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const config={host:'127.0.0.1',port:55484,user:'lab',database:'postgres'};
(async()=>{
 const root=new Client(config);await root.connect();
 const db='attendance_test_'+Date.now();await root.query(`create database ${db}`);await root.end();
 const c=new Client({...config,database:db}),other=new Client({...config,database:db});await Promise.all([c.connect(),other.connect()]);
 let checks=0;
 const ok=(v,label)=>{assert.ok(v,label);checks++;console.log('PASS',label);};
 const rpc=async(name,args,client=c)=>(await client.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
 const loc=(lon=100)=>({lat:14,lon,accuracy:10,timestamp:Date.now()});
 try{
  await c.query("do $$begin create role anon;exception when duplicate_object then null;end$$;do $$begin create role authenticated;exception when duplicate_object then null;end$$;create schema extensions;create schema realtime;create table realtime.messages(extension text);create function realtime.topic() returns text language sql as $$select ''::text$$;create function realtime.send(jsonb,text,text,boolean) returns void language plpgsql as $$begin end$$;");
  const migrations=fs.readdirSync('supabase/migrations').sort();
  for(const f of migrations.filter(f=>f<'041'))await c.query(fs.readFileSync('supabase/migrations/'+f,'utf8'));
  for(const f of fs.readdirSync('supabase/tests').filter(f=>f.endsWith('.sql')).sort()){
   await c.query(fs.readFileSync('supabase/tests/'+f,'utf8'));console.log('BASELINE PASS',f);
  }
  await c.query(fs.readFileSync('supabase/migrations/041_attendance_security.sql','utf8'));
  console.log('PASS migration applied to existing schema');
  await c.query('set search_path=public,extensions');
  const event=(await c.query("insert into events(title,online_registration) values('GPS regression',true) returning id")).rows[0].id;
  for(const [id,role] of [['gpsadmin','ADMIN'],['gpsstaff','STAFF'],['gps1','STUDENT'],['gps2','STUDENT'],['gps3','STUDENT']]){
   const u=(await c.query("insert into users(student_id,full_name,password_hash,enrollment_year,role,study_year) values($1,$1,crypt('password',gen_salt('bf')),2569,$2,1) returning id",[id,role])).rows[0].id;
   if(role==='STUDENT')await c.query('insert into event_registrations(event_id,user_id) values($1,$2)',[event,u]);
  }
  const d1='1'.repeat(64),d2='2'.repeat(64),d3='3'.repeat(64);
  const login=(id,device,client=c)=>rpc('login_device',[id,'password',device],client);
  const staff=(await login('gpsstaff',d1)).session_token,admin=(await login('gpsadmin',d1)).session_token;
  const student=(await login('gps1',d1)).session_token;
  await assert.rejects(login('gps1',d2));ok(true,'active account cannot login another browser');
  await assert.rejects(rpc('login_student',['gps1','password']));ok(true,'old login cannot bypass binding');
  await assert.rejects(rpc('admin_scan_security',[staff,event,100,50]));ok(true,'staff cannot change admin radius');
  await rpc('admin_scan_security',[admin,event,75,25]);
  assert.equal((await rpc('admin_scan_security',[admin,event])).radius_m,75);ok(true,'admin event radius persists');
  const issue=async(token=student,device=d1,fix=loc())=>rpc('issue_location_qr',[token,event,device,fix]);
  const scan=(ticket,fix=loc(),confirm=false,reason=null,token=staff,mode='CHECKIN',client=c)=>rpc('redeem_location_qr',[token,event,mode,ticket,fix,confirm,reason],client);
  let ticket=await issue();ok(ticket.success&&ticket.ttl_ms<=30000,'short-lived location QR');
  let result=await scan(ticket.token,loc(101));ok(result.code==='GPS_CONFIRM_REQUIRED'&&result.distance_m>100000,'distant QR requires confirmation with distance');
  ok(!(await scan(ticket.token,loc(),false,null,student)).success,'student cannot scan');
  result=await scan(ticket.token);ok(result.success&&result.new_status==='ATTENDING','nearby scan succeeds');
  ok(!(await scan(ticket.token)).success,'used ticket cannot be replayed');
  ok(!(await rpc('logout_event_session',[student])).success,'attending student cannot logout');
  await assert.rejects(login('gps2',d1));ok(true,'attending browser cannot switch accounts');
  await assert.rejects(login('gps1',d2));ok(true,'attending account cannot switch devices');
  ticket=await issue(student,d1,null);
  result=await scan(ticket.token,loc(),false,null,staff,'CHECKOUT');ok(result.code==='GPS_CONFIRM_REQUIRED'&&result.distance_m===null,'missing GPS never invents distance');
  ok(!(await scan(ticket.token,loc(),true,'no',staff,'CHECKOUT')).success,'override needs meaningful reason');
  result=await scan(ticket.token,loc(),true,'Checked student identity in person',staff,'CHECKOUT');ok(result.success,'staff can explicitly override missing GPS');
  ok((await c.query("select count(*)::int n from event_pass_private.security_audit where action='GPS_OVERRIDE_CHECKOUT'")).rows[0].n===1,'override audited once');
  const s2=(await login('gps2',d1)).session_token;ok(!!s2,'device reusable after checkout');
  ticket=await issue(s2,d1,{...loc(),accuracy:500});result=await scan(ticket.token);ok(result.code==='GPS_CONFIRM_REQUIRED'&&result.distance_m===0,'inaccurate fix requires confirmation');
  await c.query("update event_pass_private.qr_tickets set expires_at=now()-interval '1 second' where token=$1",[ticket.token]);
  ok(!(await scan(ticket.token,loc(),true,'Identity checked')).success,'override cannot revive expired QR');
  ticket=await issue(s2,d1,loc());result=await scan(ticket.token,{...loc(),timestamp:Date.now()-60000});ok(result.code==='GPS_CONFIRM_REQUIRED','stale staff GPS requires review');
  const results=await Promise.all([scan(ticket.token),scan(ticket.token,loc(),false,null,staff,'CHECKIN',other)]);
  ok(results.filter(r=>r.success).length===1,'concurrent duplicate scan commits once');
  await rpc('admin_reset_student_device',[admin,'gps2','Lost phone identity verified']);
  ok(!(await issue(s2,d1)).success,'admin reset invalidates previous session');
  ok(!!(await login('gps2',d2)).session_token,'admin reset permits new device while retaining attendance');
  await assert.rejects(rpc('admin_reset_student_device',[staff,'gps2','test reason']));ok(true,'staff cannot reset student device');
  const racers=await Promise.allSettled([login('gps3',d2),login('gps3',d3,other)]);
  // d2 is attending as gps2, so only d3 should succeed.
  ok(racers.filter(r=>r.status==='fulfilled').length===1,'concurrent login respects device attendance lock');
  await c.query('set role anon');
  await assert.rejects(rpc('redeem_device_event_qr',[staff,event,'CHECKIN',ticket.token]));
  await assert.rejects(rpc('redeem_event_qr',[staff,event,'CHECKIN',ticket.token]));
  await assert.rejects(rpc('process_qr_scan',[staff,event,'00000000-0000-0000-0000-000000000001']));
  ok(true,'legacy scanning endpoints not callable by API roles');
  ok((await rpc('admin_scan_security',[admin,event])).radius_m===75,'new security-definer endpoint accessible through API role');
  await c.query('reset role');
  console.log(`SUCCESS ${checks} security checks; database ${db}`);
 }finally{await Promise.all([c.end(),other.end()]);}
})().catch(e=>{console.error(e.message,e.where||'',e.stack);process.exitCode=1;});
