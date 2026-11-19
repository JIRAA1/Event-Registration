const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { Client, Pool } = require('../tmp/scan-db-lab/node_modules/pg');

// This harness deliberately accepts no database URL and only connects to the local lab.
const config = { host: '127.0.0.1', port: 55483, user: 'lab', database: 'postgres' };
const database = 'scan_load_' + Date.now();
const userCounts = process.argv.includes('--large') ? [200,300] : [50,100];
const memoryCap = process.argv.includes('--memory-cap');
const output = memoryCap ? 'tmp/scan-db-lab/load-results-500mb.json' : process.argv.includes('--large') ? 'tmp/scan-db-lab/load-results-200-300.json' : 'tmp/scan-db-lab/load-results.json';
const report = {
  database, host: config.host, date: new Date().toISOString(),
  cpu: os.cpus()[0].model, logicalCpus: os.cpus().length,
  memoryGB: +(os.totalmem() / 1024 ** 3).toFixed(1),
  poolConnections: 20, scannerWorkers: 10,
  memoryCap: memoryCap ? 'Windows job committed memory limit 500000000 bytes' : null,
  limitations: ['Local PostgreSQL RPC calls, not HTTP or camera testing',
    'Realtime delivery stubbed; trigger SQL runs but WebSocket delivery is excluded',
    'CPU is not restricted to Supabase Free compute; Windows committed memory differs from VM RAM'],
  scenarios: []
};
let pool, monitor;
async function scenario(count, deviceModes) {
  const prefix = (deviceModes ? 'device' : 'legacy') + count;
  const timings = {};
  let failures = 0, peakConnections = 0, peakActive = 0, sampling = false;
  const query = (sql, args) => pool.query(sql, args);
  async function rpc(name, args, requireSuccess = true) {
    const started = performance.now();
    try {
      const result = await query('select public.' + name + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') result', args);
      const value = result.rows[0].result;
      if (requireSuccess) assert.equal(value.success, true, name + ': ' + JSON.stringify(value));
      return value;
    } catch (error) { failures++; throw error; }
    finally { (timings[name] ||= []).push(performance.now() - started); }
  }
  async function sample() {
    if (sampling) return;
    sampling = true;
    try {
      const { rows: [row] } = await monitor.query(
        "select count(*)::int connections,count(*) filter(where state='active')::int active from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid()");
      peakConnections = Math.max(peakConnections, row.connections);
      peakActive = Math.max(peakActive, row.active);
    } finally { sampling = false; }
  }
  const { rows: [{ id: event }] } = await query("insert into events(title) values($1) returning id", [prefix]);
  const { rows: students } = await query(
    "insert into users(student_id,full_name,password_hash,enrollment_year,study_year,role) select $1||'-'||n,'Load test',crypt('01012549',$3),2569,1+(n-1)%8,'STUDENT' from generate_series(1,$2::int) n returning id,student_id,study_year",
    [prefix, count, await query("select gen_salt('bf') salt").then(r => r.rows[0].salt)]);
  await query("insert into event_registrations(event_id,user_id) select $1,id from users where student_id like $2", [event,prefix+'-%']);
  // Half the students have already checked in for simultaneous opposite-direction testing.
  if (deviceModes) await query("update event_registrations set status='ATTENDING',checkin_at=now()-interval '10 minutes' where event_id=$1 and user_id=any($2::uuid[])", [event,students.slice(0,count/2).map(s=>s.id)]);
  const staff = [];
  for (let i=0;i<10;i++) staff.push((await rpc('login_student',['scanner'+i,'01012549'])).session_token);
  const admin = (await rpc('login_student',['load-admin','01012549'])).session_token;
  const timer = setInterval(() => { void sample(); },50);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  try {
    // All virtual users start together; each follows the normal sequential login flow.
    await Promise.all(students.map(async student => {
      student.token = (await rpc('login_student',[student.student_id,'01012549'])).session_token;
      await rpc('load_workspace',[student.token]);
      const qr = await rpc('issue_event_qr',[student.token,event]);
      student.qr=qr.token;student.mode=qr.mode;
    }));
    const admissionMs = performance.now()-started;
    async function scanWave(targets) {
      let cursor=0;
      const scannerJobs=Array.from({length:10},(_,worker)=>(async()=>{
        while(cursor<targets.length) {
          const student=targets[cursor++];
          const result=await rpc(deviceModes?'redeem_device_event_qr':'redeem_event_qr',[staff[worker],event,student.mode,student.qr]);
          assert.equal(result.new_status,student.mode==='CHECKIN'?'ATTENDING':'COMPLETED');
        }
      })());
      await Promise.all([
        ...scannerJobs,
        ...students.map(s=>rpc('heartbeat_session',[s.token,null])),
        rpc('load_workspace',[admin]),
        rpc('admin_get_event_dashboard',[admin])
      ]);
    }
    const scanStart=performance.now();
    await scanWave(students);
    const firstWaveMs=performance.now()-scanStart;
    const pending = deviceModes ? students.filter(s=>s.mode==='CHECKIN') : students;
    if (!deviceModes) await rpc('set_event_scan_mode',[admin,event,'CHECKOUT']);
    await Promise.all(pending.map(async s=>{
      const qr=await rpc('issue_event_qr',[s.token,event]);s.qr=qr.token;s.mode=qr.mode;
    }));
    await scanWave(pending);
    // Ten scanners submit the same already redeemed ticket simultaneously.
    const duplicate=await Promise.all(staff.map(token=>rpc(deviceModes?'redeem_device_event_qr':'redeem_event_qr',[token,event,'CHECKOUT',pending[0].qr],false)));
    assert.equal(duplicate.filter(r=>r.success).length,0);
    const {rows:[state]}=await query(
      "select count(*)::int total,count(*) filter(where status='COMPLETED' and checkin_at is not null and checkout_at>=checkin_at and checked_out_by is not null)::int valid,count(passcode_id)::int codes from event_registrations where event_id=$1",[event]);
    assert.equal(state.total,count);assert.equal(state.valid,count);assert.equal(state.codes,0);
    // Late matching after everybody completed must remain unique and exclude year 1.
    const older=students.filter(s=>s.study_year>1).length;
    await query("insert into event_passcodes(event_id,code,is_reserve) select $1,'late-'||n,true from generate_series(1,$2::int)n",[event,older]);
    let matched=0;
    while(matched<older) {
      const r=await rpc('admin_match_passcodes_batch',[admin,event,25],false);
      assert.ok(r.matched_count>0);matched+=r.matched_count;
    }
    const {rows:[codes]}=await query(
      "select count(r.passcode_id)::int assigned,count(distinct r.passcode_id)::int unique_codes,count(*) filter(where u.study_year=1 and r.passcode_id is not null)::int year1,count(*) filter(where r.passcode_id is not null and p.assigned_to is distinct from r.user_id)::int wrong_owner from event_registrations r join users u on u.id=r.user_id left join event_passcodes p on p.id=r.passcode_id where r.event_id=$1",[event]);
    assert.equal(codes.assigned,older);assert.equal(codes.unique_codes,older);assert.equal(codes.year1,0);assert.equal(codes.wrong_owner,0);
    await sample();
    const stats = Object.fromEntries(Object.entries(timings).map(([name,values])=>{
      values.sort((a,b)=>a-b);
      return [name,{calls:values.length,meanMs:+(values.reduce((a,b)=>a+b,0)/values.length).toFixed(1),
        p95Ms:+values[Math.ceil(values.length*.95)-1].toFixed(1),maxMs:+values.at(-1).toFixed(1)}];
    }));
    const result={startedAt,finishedAt:new Date().toISOString(),users:count,mode:deviceModes?'independent mixed directions':'legacy shared mode',
      admissionMs:Math.round(admissionMs),firstScanWaveMs:Math.round(firstWaveMs),
      elapsedMs:Math.round(performance.now()-started),failures,peakConnections,peakActive,
      completed:state.valid,latePasscodes:matched,duplicateRejected:duplicate.length,stats};
    report.scenarios.push(result);console.log(JSON.stringify(result));
  } finally {clearInterval(timer);}
}
(async()=>{
 const control=new Client(config);await control.connect();
 try {await control.query('create database '+database);} finally {await control.end();}
 pool=new Pool({...config,database,max:20,statement_timeout:15000,connectionTimeoutMillis:15000});
 monitor=new Client({...config,database});await monitor.connect();
 try {
 await pool.query("create schema extensions;create schema realtime;create table realtime.messages(extension text);create function realtime.topic() returns text language sql as $$select ''::text$$;create function realtime.send(jsonb,text,text,boolean) returns void language plpgsql as $$begin end$$;");
 for(const file of fs.readdirSync('supabase/migrations').sort())await pool.query(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 // Similar order of magnitude to the supplied production user count, entirely synthetic.
 await pool.query("insert into users(student_id,full_name,password_hash,enrollment_year,study_year) select 'roster-'||n,'Synthetic roster','unused',2569,1+n%8 from generate_series(1,3500)n");
 await pool.query("insert into users(student_id,full_name,password_hash,enrollment_year,role) select 'scanner'||n,'Scanner',crypt('01012549',gen_salt('bf')),0,'STAFF' from generate_series(0,9)n");
 await pool.query("insert into users(student_id,full_name,password_hash,enrollment_year,role) values('load-admin','Load Admin',crypt('01012549',gen_salt('bf')),0,'ADMIN')");
 await Promise.all(Array.from({length:20},()=>pool.query('select pg_sleep(0.05)')));
 console.log('IDLE_BASELINE');
 await new Promise(resolve=>setTimeout(resolve,2500));
 for (const count of userCounts) for (const modes of [false,true]) await scenario(count,modes);
 fs.writeFileSync(output,JSON.stringify(report,null,2));
 console.log('ALL SCENARIOS PASSED. Report: '+output);
 }finally{await pool.end();await monitor.end();}
})().catch(error=>{console.error(error);process.exitCode=1});
