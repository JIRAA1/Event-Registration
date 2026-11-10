'use client';
import {useEffect,useState} from 'react';
import {errorText,signupRpc,type QueueState,type SignupInfo} from '@/lib/event-registration';
import {isSupabaseConfigured} from '@/lib/supabase';

export function LoginHelp({loginFailed}:{loginFailed:boolean}){
  const [link,setLink]=useState('');
  useEffect(()=>{
    let active=true;
    if(isSupabaseConfigured)void signupRpc<SignupInfo>('registration_info',{}).then(data=>{if(active)setLink(data.contact);}).catch(()=>{});
    return ()=>{active=false;};
  },[]);
  return <div className="mt-4 flex flex-wrap justify-between gap-3 text-sm">
    {link && <a className="font-bold text-[#7c0a02] underline" href={link} target="_blank" rel="noreferrer">เข้าใช้บัญชีไม่ได้? ติดต่อแอดมิน</a>}
    {!link && loginFailed && <p>ติดต่อแอดมินที่จุดลงทะเบียนหน้างาน พร้อมแจ้งรหัสนักศึกษา</p>}

  </div>;
}
export function RegistrationAdmin({eventId,token,refresh}:{eventId:string;token:string;refresh:()=>Promise<void>}) {
  const [data,setData]=useState<QueueState>();
  const [contact,setContact]=useState<string|null>(null);
  const [device,setDevice]=useState<{username:string;password:string}>();
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [revision,reload]=useState(0);
  const [url,setUrl]=useState('');
  const [notes,setNotes]=useState<Record<string,string>>({});
  useEffect(()=>setUrl(window.location.origin+'/register/'+eventId),[eventId]);
  useEffect(()=>{
    if(!token || !isSupabaseConfigured)return;
    let active=true;
    let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try{
        if(!document.hidden){
          const next=await signupRpc<QueueState>('registration_admin',{p_token:token,p_event:eventId,p_action:'QUEUE'});
          if(active)setData(next);
        }
      }catch(e){if(active)setNotice(errorText(e));}
      if(active)timer=setTimeout(poll,5000);
    };
    void poll();return ()=>{active=false;clearTimeout(timer);};
  },[eventId,token,revision]);
  async function run(task:()=>Promise<void>){
    setBusy(true);setNotice('');
    try{await task();reload(n=>n+1);}catch(e){setNotice(errorText(e));}finally{setBusy(false);}
  }
  function admin(action:string,value=''){
    return signupRpc<QueueState>('registration_admin',{p_token:token,p_event:eventId,p_action:action,p_value:value});
  }
  async function review(id:string,decision:string){
    if(decision==='CANCEL'&&!confirm('ยกเลิกใบสมัครนี้เพื่อให้ยื่นใหม่?'))return;
    await signupRpc('registration_review',{p_token:token,p_id:id,p_decision:decision,p_note:notes[id]||''});
    await refresh();setNotice(decision==='APPROVE'?'อนุมัติและเพิ่มรายชื่อแล้ว':'อัปเดตคำขอแล้ว');
  }
  if(!isSupabaseConfigured)return <p className="bento p-4">เชื่อมต่อ Supabase เพื่อเปิดรับสมัครและใช้เครื่องหน้างาน</p>;
  return <section className="bento space-y-4 p-5">
    <h2 className="text-lg font-bold">รับสมัครและอนุมัติรายชื่อ</h2>
    {notice && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{notice}</p>}
    {data && <>
      <div className="flex flex-wrap items-center gap-3"><b>{data.open?'เปิดรับสมัครออนไลน์':'ปิดรับสมัครออนไลน์'}</b>
        <button disabled={busy} className="action-secondary" onClick={()=>void run(async()=>{setData(await admin(data.open?'CLOSE':'OPEN'));})}>{data.open?'ปิดรับออนไลน์':'เปิดรับออนไลน์'}</button>
        <a className="action-secondary" href={url} target="_blank" rel="noreferrer">ดูหน้าสมัคร</a>
        <button className="action-secondary" onClick={()=>void run(async()=>{await navigator.clipboard.writeText(url);setNotice('คัดลอกลิงก์แล้ว');})}>คัดลอกลิงก์สมัคร</button></div>
      <h3 className="font-bold">คิวของกิจกรรมนี้ ({data.queue.length})</h3>
      {!data.queue.length && <p className="text-sm text-slate-600">ไม่มีใบสมัครรอตรวจ</p>}
      {data.queue.map(r=><article key={r.id} className="space-y-2 rounded-xl border p-3">
        <b>{r.profile.prefix}{r.profile.full_name} · {r.student_id}</b><p className="text-sm">{r.kiosk?'หน้างาน':'ออนไลน์'} · {r.id.slice(0,8).toUpperCase()} · {r.status==='CORRECT'?'รอผู้สมัครแก้ไข':'รอยืนยัน'}</p>
        <p className="text-sm">{r.profile.faculty} · {r.profile.major} · ปี {r.profile.study_year} · หมู่ {r.profile.class_group} · โทร {r.profile.phone}</p>
        <input className="h-11 w-full rounded-xl border px-3" aria-label="ข้อความให้แก้ไข" placeholder="ระบุข้อมูลที่ต้องแก้ไข" value={notes[r.id]||''} maxLength={300} onChange={e=>setNotes({...notes,[r.id]:e.target.value})}/>
        <div className="flex flex-wrap gap-2"><button className="action-primary" disabled={busy||r.status!=='PENDING'} onClick={()=>void run(()=>review(r.id,'APPROVE'))}>ยืนยันตัวตนและอนุมัติ</button>
        <button className="action-secondary" disabled={busy||!notes[r.id]?.trim()} onClick={()=>void run(()=>review(r.id,'CORRECT'))}>ส่งกลับให้แก้ไข</button>
        <button className="action-danger" disabled={busy} onClick={()=>void run(()=>review(r.id,'CANCEL'))}>ยกเลิกใบสมัคร</button></div>
      </article>)}
      <details className="rounded-xl border p-3"><summary className="cursor-pointer font-bold">ตั้งค่าเครื่อง iPad และช่องทางติดต่อ</summary>
        <div className="mt-3 space-y-3">
          <p className="break-all text-sm">{data.station?'บัญชีเครื่อง '+data.station:'ยังไม่มีบัญชีเครื่องสำหรับกิจกรรมนี้'}</p>
          <button className="action-secondary" disabled={busy} onClick={()=>void run(async()=>{
            if(data.station&&!confirm('ออกรหัสผ่านใหม่และยกเลิกเซสชันเครื่องเดิม?'))return;
            setDevice(await signupRpc('registration_admin',{p_token:token,p_event:eventId,p_action:'STATION'}));
          })}>{data.station?'ออกรหัสผ่านเครื่องใหม่':'สร้างบัญชีเครื่องหน้างาน'}</button>
          {device && <div className="break-all rounded-xl bg-amber-50 p-3 text-sm"><p>{device.username}</p><p>รหัสผ่านเครื่อง {device.password}</p><button className="underline" onClick={()=>setDevice(undefined)}>ซ่อนรหัสผ่าน</button></div>}
          <a className="block text-sm underline" href="/kiosk" target="_blank" rel="noreferrer">เปิดหน้าเครื่องลงทะเบียน</a>
          <label className="block text-sm">ลิงก์ติดต่อแอดมินบนหน้า Login (ทุกกิจกรรม)<input type="url" value={contact??data.contact} onChange={e=>setContact(e.target.value)} placeholder="https://..." className="mt-1 block h-11 w-full rounded-xl border px-3"/></label>
          <button className="action-primary" disabled={busy||contact===null} onClick={()=>void run(async()=>{setData(await admin('CONTACT',contact?.trim()||''));setContact(null);setNotice('บันทึกช่องทางติดต่อแล้ว');})}>บันทึกช่องทางติดต่อ</button>
        </div>
      </details>
    </>}
  </section>;
}
