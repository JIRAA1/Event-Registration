const fs=require('node:fs');
const assert=require('node:assert/strict');
const ts=require('typescript');
const source=fs.readFileSync('app/page.tsx','utf8').replace(/\r\n/g,'\n');
const start=source.indexOf('  useEffect(()=>{\n    const client=supabase;',source.indexOf('function AdminView'));
const end=source.indexOf('  useEffect(()=>{void refreshWorkspace();},[adminTab',start);
const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
(async()=>{
 let cleanup,handler,subscription,dash=0,workspace=0;
 const intervals=[],timeouts=[];const events={};const document={hidden:false,addEventListener:(n,f)=>events[n]=f,removeEventListener:n=>delete events[n]};
 const channel={on:(name,args,fn)=>{handler=fn;return channel},subscribe:fn=>{subscription=fn;return channel}};
 const client={channel:()=>channel,removeChannel:()=>{}};
 const window={setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length}};
 new Function('useEffect','supabase','loadEventDashboard','refreshWorkspace','sessionToken','isImportingRef','setDashboardRows','setDashboardLive','hashSessionToken','document','window','setTimeout','clearTimeout','clearInterval',code)(
 fn=>cleanup=fn(),client,async()=>{dash++;return []},async()=>{workspace++},'test',{current:false},()=>{},()=>{},async()=> 'hash',document,window,(fn,ms)=>{timeouts.push(fn);return timeouts.length},()=>{},()=>{});
 const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve()};
 await flush();subscription('SUBSCRIBED');await flush();
 const before=dash;await intervals.find(x=>x.ms===30000).fn();await flush();assert.ok(dash>before,'live presence must poll');
 document.hidden=true;const hidden=dash;intervals.forEach(x=>x.fn());await flush();assert.equal(dash,hidden);document.hidden=false;
 for(let i=0;i<100;i++)handler();assert.equal(timeouts.length,1,'events must not indefinitely debounce');
 const count=workspace;events.visibilitychange();await flush();assert.ok(workspace>count,'returning visible refreshes rows');
 cleanup();const after=dash;intervals.forEach(x=>x.fn());await flush();assert.equal(dash,after,'unmounted requests stop');
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
