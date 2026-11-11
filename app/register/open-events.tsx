'use client';
import {useEffect,useRef,useState} from 'react';
import {errorText,signupRpc} from '@/lib/event-registration';

export function OpenEvents({token,refresh}:{token:string;refresh:()=>Promise<void>}){
  const [events,setEvents]=useState<{id:string;title:string;location:string}[]>([]);
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [revision,reload]=useState(0);
  const lock=useRef(false);
  useEffect(()=>{
    if(!token)return;
    let active=true;
    signupRpc<typeof events>('student_open_events',{p_token:token}).then(data=>{if(active)setEvents(data);})
      .catch(error=>{if(active)setNotice(errorText(error));});
    return ()=>{active=false;};
  },[token,revision]);
  async function join(id:string){
    if(lock.current)return;
    lock.current=true;setBusy(true);setNotice('');
    try{
      const result=await signupRpc<{pending?:boolean;already?:boolean}>('registration_join',{p_event:id,p_token:token});
      setNotice(result.pending?'ส่งใบสมัครแล้ว รอแอดมินยืนยันเข้าร่วมกิจกรรม':result.already?'คุณลงทะเบียนกิจกรรมนี้แล้ว':'ลงทะเบียนสำเร็จ เปิด QR ได้จากกิจกรรมที่ฉันลงทะเบียน');
      setEvents(previous=>previous.filter(event=>event.id!==id));
      await refresh();
    }catch(error){setNotice(errorText(error));}
    finally{lock.current=false;setBusy(false);reload(value=>value+1);}
  }
  if(!token)return null;
  return <section className="bento space-y-3 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-bold">กิจกรรมที่เปิดรับสมัคร</h2>
      <button className="action-secondary" disabled={busy} onClick={()=>reload(value=>value+1)}>รีเฟรชกิจกรรม</button>
    </div>
    {notice && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{notice}</p>}
    {!events.length && <p className="text-sm text-slate-600">ยังไม่มีกิจกรรมใหม่ที่เปิดรับสมัคร</p>}
    {events.map(event=><article key={event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
      <div className="min-w-0"><h3 className="break-words font-semibold">{event.title}</h3><p className="text-sm text-slate-600">{event.location}</p></div>
      <button className="action-primary" disabled={busy} onClick={()=>void join(event.id)}>สมัครเข้าร่วมกิจกรรม</button>
    </article>)}
  </section>;
}
