const fs=require('node:fs');
const assert=require('node:assert/strict');
const ts=require('typescript');
const source=fs.readFileSync('app/page.tsx','utf8').replace(/\r\n/g,'\n');
const start=source.indexOf('  useEffect(()=>{\n    const client=supabase;',source.indexOf('function AdminView'));
const end=source.indexOf(' const regs=store.regs.filter',start);
assert.ok(start>0&&end>start);
const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
(async()=>{
 let cleanup,handler,subscription,dash=0,workspace=0,now=100000,release;
 let deferDashboard=false,failWorkspace=false;
 const imports={current:false};
 const intervals=[],timeouts=[],events={};
 const document={hidden:false,addEventListener:(n,f)=>events[n]=f,removeEventListener:n=>delete events[n]};
 const channel={on:(name,args,fn)=>{handler=fn;return channel},subscribe:fn=>{subscription=fn;return channel}};
 const client={channel:()=>channel,removeChannel:()=>{}};
 const window={setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length}};
 new Function('useEffect','supabase','loadEventDashboard','refreshWorkspace','sessionToken','isImportingRef','setDashboardRows','setDashboardLive','hashSessionToken','document','window','setTimeout','clearTimeout','clearInterval','Date',code)(
 fn=>cleanup=fn(),client,async()=>{dash++;if(deferDashboard)await new Promise(resolve=>release=resolve);return []},
 async()=>{workspace++;if(failWorkspace)throw Error('network');},'test',imports,()=>{},()=>{},async()=> 'hash',
 document,window,(fn,ms)=>{timeouts.push(fn);return timeouts.length},()=>{},()=>{},{now:()=>now});
 const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
 const tick=async ms=>{now+=ms;intervals.find(x=>x.ms===ms).fn();await flush()};
 await flush();
 assert.equal(workspace,0,'mount uses the workspace loaded by login');
 subscription('SUBSCRIBED');await flush();
 assert.equal(workspace,1,'subscription reconciles changes during connection setup');
 const initialDash=dash;
 for(let i=0;i<20;i++){await tick(30000);await tick(10000)}
 assert.equal(workspace,1,'idle presence polling never reloads the full workspace');
 assert.ok(dash>initialDash,'presence continues updating while live');
 document.hidden=true;const hidden=dash;await tick(30000);await tick(10000);assert.equal(dash,hidden);document.hidden=false;
 for(let i=0;i<100;i++)handler();
 assert.equal(timeouts.length,1,'broadcast burst coalesces');
 timeouts.shift()();await flush();assert.equal(workspace,2,'scan changes reload attendance and passcodes');
 handler();timeouts.shift()();await flush();assert.equal(workspace,2,'workspace refresh throttles within ten seconds');
 await tick(10000);assert.equal(workspace,3,'pending broadcast is eventually delivered');
 imports.current=true;handler();timeouts.shift()();await flush();await tick(30000);assert.equal(workspace,3);
 imports.current=false;await tick(10000);assert.equal(workspace,4,'changes during import are not lost');
 subscription('CHANNEL_ERROR');await tick(10000);const disconnected=workspace;
 await tick(30000);assert.ok(workspace>disconnected,'fallback refreshes workspace');
 subscription('SUBSCRIBED');await flush();
 const reconnected=workspace;await tick(30000);assert.equal(workspace,reconnected,'fallback stops after reconnect');
 events.visibilitychange();await flush();assert.equal(workspace,reconnected+1,'returning visible refreshes rows');
 deferDashboard=true;await tick(30000);
 events.visibilitychange();release();deferDashboard=false;await flush();
 assert.equal(workspace,reconnected+2,'visibility during an in-flight dashboard request is retained');
 failWorkspace=true;handler();await tick(10000);const failed=workspace;
 failWorkspace=false;await tick(10000);assert.equal(workspace,failed+1,'failed refresh is retried');
 cleanup();const after=dash;intervals.forEach(x=>x.fn());await flush();assert.equal(dash,after,'unmounted requests stop');
 assert.ok(!source.includes('useEffect(()=>{void refreshWorkspace();},[adminTab'),'local tab filters do not reload full workspace');
 // Execute the actual payload reducer to check explicit null versus omitted fields.
 const reducerLine=source.split('\n').find(x=>x.includes('checkin_at:message.checkin_at===undefined'));
 const reducer=ts.transpileModule(reducerLine,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 let state={regs:[{event_id:'e',user_id:'u',status:'COMPLETED',checkin_at:'in',checkout_at:'out',passcode:'secret'}]};
 const apply=message=>new Function('message','user','setStore',reducer)(message,{id:'u'},fn=>state=fn(state));
 apply({event_id:'e',status:'ATTENDING',checkout_at:null,passcode:null});assert.equal(state.regs[0].checkout_at,undefined);assert.equal(state.regs[0].passcode,undefined);assert.equal(state.regs[0].checkin_at,'in');
 apply({event_id:'e',status:'REGISTERED',checkin_at:null});assert.equal(state.regs[0].checkin_at,undefined);
 apply({event_id:'e',status:'COMPLETED',passcode:'late'});assert.equal(state.regs[0].passcode,'late');
 console.log('PASS live presence, visibility, coalescing, cleanup, status rollback and late passcode');
})().catch(e=>{console.error(e);process.exitCode=1});
