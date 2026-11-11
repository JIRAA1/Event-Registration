'use client';
import {memo,useEffect,useMemo,useRef,useState} from 'react';
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
export const RegistrationAdmin=memo(function RegistrationAdmin({eventId,token,refresh,mode='queue'}:{eventId:string;token:string;refresh:()=>Promise<void>;mode?:'queue'|'settings'}) {
  const [data,setData]=useState<QueueState>();
  const [contact,setContact]=useState<string|null>(null);
  const [device,setDevice]=useState<{username:string;password:string}>();
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [revision,reload]=useState(0);
  const [url,setUrl]=useState('');
  const [notes,setNotes]=useState<Record<string,string>>({});
  const [pageIndex,setPageIndex]=useState(0);
  const listTop=useRef<HTMLDivElement>(null);
  const pageCount=Math.max(1,Math.ceil((data?.queue.length||0)/15));
  const page=Math.min(pageIndex,pageCount-1);
  useEffect(()=>{if(pageIndex!==page)setPageIndex(page);},[pageIndex,page]);
  function changePage(next:number){
    setPageIndex(next);
    listTop.current?.scrollIntoView({block:'start'});
  }
  const [selected,setSelected]=useState<string[]>([]);
  const eligible=data?.queue.filter(row=>row.status==='PENDING').map(row=>row.id) || [];
  const checked=useMemo(()=>new Set(selected),[selected]);
  const chosen=eligible.filter(id=>checked.has(id));
  const exportIds=chosen.length?chosen:(data?.queue.map(row=>row.id)??[]);
  async function approveSelected(){
    await signupRpc('registration_approve_many',{p_token:token,p_event:eventId,p_ids:chosen});
    setSelected([]);setNotice(`อนุมัติแล้ว ${chosen.length} รายการ`);await refresh();
  }
  async function exportApplicants(){
    const rows=await signupRpc<(string|null)[][]>('registration_export',{p_token:token,p_event:eventId,p_ids:exportIds});
    if(rows.length!==exportIds.length){
      setNotice('คิวมีการเปลี่ยนแปลง กรุณาตรวจรายชื่อแล้วกดส่งออกอีกครั้ง');return;
    }
    const header=['รหัสนักศึกษา','ชื่อและนามสกุล','คณะ','สาขา','ชั้นปี','หมู่เรียน','ช่องทางสมัคร','สถานะ','เวลาสมัคร'];
    const csv=[header,...rows].map(row=>row.map(value=>{
      let cell=String(value??'');
      if(/^\s*[=+@-]|^[\t\r\n]/.test(cell))cell="'"+cell;
      return '"'+cell.replace(/"/g,'""')+'"';
    }).join(',')).join('\r\n');
    const link=document.createElement('a');
    link.href=URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}));
    link.download='รายชื่อผู้สมัคร-'+eventId+'.csv';link.click();
    setTimeout(()=>URL.revokeObjectURL(link.href),1000);
    setNotice(`ส่งออกรายชื่อ ${rows.length} รายการแล้ว`);
  }
  useEffect(()=>setUrl(window.location.origin+'/register/'+eventId),[eventId]);
  useEffect(()=>{
    if(!token || !isSupabaseConfigured)return;
    let active=true;
    let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try{
        if(!document.hidden){
          const next=await signupRpc<QueueState>('registration_admin',{p_token:token,p_event:eventId,p_action:'QUEUE'});
          if(active)setData(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
        }
      }catch(e){if(active)setNotice(errorText(e));}
      if(active && mode==='queue')timer=setTimeout(poll,5000);
    };
    void poll();return ()=>{active=false;clearTimeout(timer);};
  },[eventId,token,revision,mode]);
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
  return <section className="space-y-4">
    {notice && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{notice}</p>}
    {!data && <p role="status">กำลังโหลดข้อมูล…</p>}
    {data && <>
      {mode==='queue' && <>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-slate-50 p-3"><b>{data.open?'เปิดรับสมัครออนไลน์':'ปิดรับสมัครออนไลน์'}</b>
        <button disabled={busy} className="action-secondary" onClick={()=>void run(async()=>{setData(await admin(data.open?'CLOSE':'OPEN'));})}>{data.open?'ปิดรับออนไลน์':'เปิดรับออนไลน์'}</button>
        <a className="action-secondary" href={url} target="_blank" rel="noreferrer">ดูหน้าสมัคร</a>
        <button className="action-secondary" onClick={()=>void run(async()=>{await navigator.clipboard.writeText(url);setNotice('คัดลอกลิงก์แล้ว');})}>คัดลอกลิงก์สมัคร</button></div>
      <div ref={listTop} className="scroll-mt-3"/><h3 className="font-bold">คิวของกิจกรรมนี้ ({data.queue.length})</h3>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={busy||!exportIds.length} className="action-secondary" onClick={()=>void run(exportApplicants)}>
          ส่งออก{chosen.length?'ที่เลือก':'รายชื่อในคิว'} {exportIds.length} รายการ (CSV)
        </button>
        {eligible.length>0 && <><label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={busy} checked={chosen.length===eligible.length}
          onChange={e=>setSelected(e.target.checked?eligible:[])}/>เลือกที่รอยืนยันทุกหน้า ({eligible.length})</label>
          <button className="action-primary" disabled={busy||!chosen.length} onClick={()=>void run(approveSelected)}>อนุมัติที่เลือก ({chosen.length})</button></>}
      </div>
      {!data.queue.length && <p className="text-sm text-slate-600">ไม่มีใบสมัครรอตรวจ</p>}
      {data.queue.slice(page*15,page*15+15).map(r=><article key={r.id} className="space-y-2 rounded-xl border p-3">
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" disabled={busy||r.status!=='PENDING'} checked={chosen.includes(r.id)}
          onChange={e=>setSelected(ids=>e.target.checked?[...ids,r.id]:ids.filter(id=>id!==r.id))}/><b>{r.profile.prefix}{r.profile.full_name} · {r.student_id}</b></label><p className="text-sm">{r.kiosk?'หน้างาน':'ออนไลน์'} · {r.id.slice(0,8).toUpperCase()} · {r.status==='CORRECT'?'รอผู้สมัครแก้ไข':'รอยืนยัน'}</p>
        <p className="text-sm">{r.profile.faculty} · {r.profile.major} · ปี {r.profile.study_year} · หมู่ {r.profile.class_group} · โทร {r.profile.phone}</p>
        {r.profile.birth_date && <input className="h-11 w-full rounded-xl border px-3" aria-label="ข้อความให้แก้ไข" placeholder="ระบุข้อมูลที่ต้องแก้ไข" value={notes[r.id]||''} maxLength={300} onChange={e=>setNotes({...notes,[r.id]:e.target.value})}/>}
        <div className="flex flex-wrap gap-2"><button className="action-primary" disabled={busy||r.status!=='PENDING'} onClick={()=>void run(()=>review(r.id,'APPROVE'))}>ยืนยันตัวตนและอนุมัติ</button>
        {r.profile.birth_date && <button className="action-secondary" disabled={busy||!notes[r.id]?.trim()} onClick={()=>void run(()=>review(r.id,'CORRECT'))}>ส่งกลับให้แก้ไข</button>}
        <button className="action-danger" disabled={busy} onClick={()=>void run(()=>review(r.id,'CANCEL'))}>ยกเลิกใบสมัคร</button></div>
      </article>)}
      <nav aria-label="หน้ารายชื่อผู้สมัคร" className="flex flex-wrap items-center justify-between gap-2">
        <button className="action-secondary" disabled={busy||page===0} onClick={()=>changePage(page-1)}>ก่อนหน้า</button>
        <span className="text-sm" aria-live="polite">หน้า {page+1} / {pageCount} · หน้าละ 15 คน</span>
        <button className="action-secondary" disabled={busy||page+1>=pageCount} onClick={()=>changePage(page+1)}>ถัดไป</button>
      </nav>
      </>}
      {mode==='settings' && <div className="rounded-xl border p-4">
        <h3 className="font-bold">เครื่องลงทะเบียน iPad</h3>
        <div className="mt-3 space-y-3">
          <p className="break-all text-sm">{data.station?'บัญชีเครื่อง '+data.station:'ยังไม่มีบัญชีเครื่องสำหรับกิจกรรมนี้'}</p>
          <button className="action-secondary" disabled={busy} onClick={()=>void run(async()=>{
            if(data.station&&!confirm('ออกรหัสผ่านใหม่และยกเลิกเซสชันเครื่องเดิม?'))return;
            setDevice(await signupRpc('registration_admin',{p_token:token,p_event:eventId,p_action:'STATION'}));
          })}>{data.station?'ออกรหัสผ่านเครื่องใหม่':'สร้างบัญชีเครื่องหน้างาน'}</button>
          {device && <div className="break-all rounded-xl bg-amber-50 p-3 text-sm"><p>{device.username}</p><p>รหัสผ่านเครื่อง {device.password}</p><button className="underline" onClick={()=>setDevice(undefined)}>ซ่อนรหัสผ่าน</button></div>}
          <a className="block text-sm underline" href="/kiosk" target="_blank" rel="noreferrer">เปิดหน้าเครื่องลงทะเบียน</a>
          <label className="block border-t pt-4 text-sm">ลิงก์ติดต่อแอดมินบนหน้า Login (ทุกกิจกรรม)<input type="url" value={contact??data.contact} onChange={e=>setContact(e.target.value)} placeholder="https://..." className="mt-1 block h-11 w-full rounded-xl border px-3"/></label>
          <button className="action-primary" disabled={busy||contact===null} onClick={()=>void run(async()=>{setData(await admin('CONTACT',contact?.trim()||''));setContact(null);setNotice('บันทึกช่องทางติดต่อแล้ว');})}>บันทึกช่องทางติดต่อ</button>
        </div>
      </div>}
    </>}
  </section>;
});
