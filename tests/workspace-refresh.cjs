const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript');
const source=fs.readFileSync('app/page.tsx','utf8');
const start=source.indexOf('  const refreshWorkspace=useMemo(');
const end=source.indexOf('  const loadEventDashboard=',start);
const code=ts.transpileModule(source.slice(start,end)+'\nreturn refreshWorkspace;',{
 compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}
}).outputText;
(async()=>{
 let calls=0,stored=[],requests=[],currentToken='staff',expired=0;
 const client={rpc:()=>{calls++;return new Promise(resolve=>requests.push(resolve))}};
 const refresh=new Function('useMemo','supabase','sessionToken','sessionStorage','setStore','setAcademicCatalog','workspaceStore','workspaceCatalog','expireAdminSession',code)(
 fn=>fn(),client,'staff',{getItem:()=>currentToken},x=>stored.push(x),()=>{},x=>x,x=>x,()=>expired++);
 const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve()};
 const first=refresh();const afterMutation=refresh();const burst=refresh();
 assert.equal(calls,1);assert.equal(first,afterMutation);assert.equal(first,burst);
 requests.shift()({data:{success:true,version:1}});await flush();
 assert.equal(calls,2,'a refresh requested during an older query gets fresh data afterwards');
 requests.shift()({data:{success:true,version:2}});await first;
 assert.equal(stored.at(-1).version,2);
 const failed=refresh();requests.shift()({error:{message:'offline'}});
 await assert.rejects(failed,/offline/);
 const retried=refresh();requests.shift()({data:{success:true,version:3}});await retried;
 assert.equal(stored.at(-1).version,3);
 const old=refresh();currentToken='other';requests.shift()({data:{success:true,version:4}});await old;
 assert.equal(stored.at(-1).version,3,'old session cannot overwrite the new account');
 assert.equal(expired,0);
 console.log('PASS workspace queue, post-mutation freshness, failure recovery and session isolation');
})().catch(error=>{console.error(error);process.exitCode=1});
