'use client';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {LocationFix} from './location-access';
type Warning={message:string;distance_m:number|null;radius_m:number;student_id:string;full_name:string;student_accuracy:number|null;staff_accuracy:number|null};
export function useSecureScan(context:string){
  const [warning,setWarning]=useState<Warning|null>(null);
  const answer=useRef<((reason:string|null)=>void)|null>(null);
  const busy=useRef(false);
  function settle(reason:string|null){const resolve=answer.current;answer.current=null;setWarning(null);resolve?.(reason);}
  useEffect(()=>()=>{const resolve=answer.current;answer.current=null;resolve?.(null);},[context]);
  useEffect(()=>{setWarning(null);},[context]);
  async function scan(args:{p_session_token:string;p_event_id:string;p_scan_mode:string;p_ticket:string},read:()=>LocationFix|null){
    if(busy.current||!supabase)return null;
    busy.current=true;
    try {
      let response=await supabase.rpc('redeem_location_qr',{...args,p_location:read()});
      if(response.data?.code==='GPS_CONFIRM_REQUIRED'){
        const reason=await new Promise<string|null>(resolve=>{answer.current=resolve;setWarning(response.data as Warning);});
        if(reason===null)return null;
        response=await supabase.rpc('redeem_location_qr',{...args,p_location:read(),p_confirm:true,p_reason:reason});
      }
      return response;
    }finally{busy.current=false;}
  }
  return {scan,confirmation:warning?<Confirmation warning={warning} done={settle}/>:null};
}
function Confirmation({warning:w,done}:{warning:Warning;done:(reason:string|null)=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  const [reason,setReason]=useState('');
  useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog ref={ref} onCancel={e=>{e.preventDefault();done(null);}} aria-labelledby="gps-warning-title" className="m-auto w-[min(94vw,480px)] rounded-2xl p-6 backdrop:bg-black/60">
    <h2 id="gps-warning-title" className="text-xl font-bold">โปรดยืนยันตัวนักศึกษาก่อนสแกน</h2>
    <p className="my-3 font-bold">{w.full_name} · {w.student_id}</p>
    <p>{w.message}</p>
    <p className="my-3 text-lg font-bold">{w.distance_m===null?'คำนวณระยะไม่ได้':`อยู่ห่างจากสตาฟประมาณ ${Math.round(w.distance_m)} เมตร`} (ระยะที่กำหนด {w.radius_m} เมตร)</p>
    <p className="text-sm">ความคลาดเคลื่อน GPS: นักศึกษา {w.student_accuracy===null?'ไม่ทราบ':`${Math.round(w.student_accuracy)} ม.`} / สตาฟ {w.staff_accuracy===null?'ไม่ทราบ':`${Math.round(w.staff_accuracy)} ม.`}</p>
    <p className="my-3">ให้นักศึกษาแสดงตัวและหลักฐานประจำตัวต่อหน้า การอนุมัติครั้งนี้จะบันทึกชื่อสตาฟ เวลา และเหตุผล</p>
    <form onSubmit={e=>{e.preventDefault();if(reason.trim().length>=5)done(reason.trim());}}>
      <label className="block">เหตุผลที่อนุมัติ<textarea autoFocus required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} className="mt-2 w-full rounded border p-2" placeholder="เช่น ตรวจบัตรนักศึกษาและตัวจริงแล้ว GPS เครื่องขัดข้อง"/></label>
      <div className="mt-4 flex gap-3"><button type="button" onClick={()=>done(null)} className="rounded border p-3">ไม่อนุมัติ</button><button disabled={reason.trim().length<5} className="rounded bg-[#7c0a02] p-3 text-white disabled:opacity-40">ยืนยันและบันทึกการเข้าร่วม</button></div>
      <p className="mt-2 text-xs">หาก QR หมดอายุระหว่างตรวจสอบ ต้องสแกน QR ใหม่</p>
    </form>
  </dialog>;
}
