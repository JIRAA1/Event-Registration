'use client';

import {useEffect, useRef, useState} from 'react';
import {QRCodeCanvas} from 'qrcode.react';
import {supabase} from '@/lib/supabase';

type Ticket = {token:string; mode:string};

export function StudentQr({session,eventId}:{session:string;eventId:string}) {
  const [ticket,setTicket] = useState<Ticket | null>(null);
  const [remaining,setRemaining] = useState(0);
  const [message,setMessage] = useState('กำลังโหลด QR…');
  const [action,setAction] = useState<'retry'|'transfer'|null>(null);
  const request = useRef<(transfer:boolean)=>void>(()=>{});

  useEffect(()=>{
    let disposed = false;
    let version = 0;
    let timer: ReturnType<typeof setTimeout>;
    let deadline = 0;
    let heldCard = false;
    function clearCard() {
      version++;
      clearTimeout(timer);
      deadline = 0;
      setTicket(null);
      setAction(null);
    }
    async function load(transfer=false) {
      if (document.hidden || disposed) return;
      clearTimeout(timer);
      const current = ++version;
      const started = Date.now();
      setAction(null);
      try {
        if (!supabase || !navigator.onLine) throw new Error();
        const {data,error} = await supabase.rpc('issue_event_qr',{
          p_session_token:session,p_event_id:eventId,p_transfer:transfer,
        });
        if (disposed || current!==version) return;
        if (error) throw error;
        if (!data?.success) {
          clearCard();
          setMessage(data?.code==='OTHER_SESSION' && heldCard ? 'บัตรถูกย้ายไปอีกเบราว์เซอร์แล้ว' : data?.message || 'ออก QR ไม่สำเร็จ');
          setAction(data?.code==='OTHER_SESSION'?'transfer':'retry');
          return;
        }
        deadline = started + Number(data.ttl_ms);
        const left = deadline-Date.now();
        if (left<=0) {
          clearCard();
          setMessage('กำลังต่ออายุบัตร…');
          timer=setTimeout(()=>void load(),250);
          return;
        }
        heldCard = true;
        setTicket({token:data.token,mode:data.mode});
        setRemaining(Math.ceil(left/1000));
        // Revalidate ownership while visible. The server reuses a still-valid ticket.
        timer=setTimeout(()=>void load(),Math.min(10000,left));
      } catch {
        if (disposed || current!==version) return;
        clearCard();
        setMessage('โหลด QR ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง');
        setAction('retry');
      }
    }
    function resume() {
      clearCard();
      setMessage('กำลังตรวจสอบบัตร…');
      if (!document.hidden) void load();
    }
    request.current=load;
    resume();
    const tick=setInterval(()=>{
      if (deadline) setRemaining(Math.max(0,Math.ceil((deadline-Date.now())/1000)));
    },250);
    document.addEventListener('visibilitychange',resume);
    window.addEventListener('pageshow',resume);
    window.addEventListener('online',resume);
    window.addEventListener('offline',resume);
    return ()=>{
      disposed=true;
      clearInterval(tick);
      clearTimeout(timer);
      document.removeEventListener('visibilitychange',resume);
      window.removeEventListener('pageshow',resume);
      window.removeEventListener('online',resume);
      window.removeEventListener('offline',resume);
    };
  },[eventId,session]);

  return <div className="my-5 text-center">
    {ticket && remaining>0 ? <>
      <div className="qr-ticket flex justify-center rounded-2xl p-2">
        <QRCodeCanvas value={'ARU1:'+ticket.token} size={256} marginSize={4} level="M" fgColor="#000000" bgColor="#ffffff" role="img" aria-label="QR กิจกรรมแบบใช้ครั้งเดียว"/>
      </div>
      <p className="mt-2 text-sm font-semibold">{ticket.mode==='CHECKIN'?'บัตรสแกนเข้า':'บัตรสแกนออก'} · เหลือ {remaining} วินาที</p>
    </> : <div className="rounded-xl bg-slate-50 px-4 py-8">
      <p role="status" className="text-sm">{ticket?'กำลังต่ออายุบัตร…':message}</p>
      {action && <button type="button" className="mt-4 rounded-xl bg-[#7c0a02] px-5 py-3 text-sm font-bold text-white"
        onClick={()=>{setMessage('กำลังตรวจสอบบัตร…');request.current(action==='transfer');}}>
        {action==='transfer'?'ย้ายบัตรมาเครื่องนี้':'โหลด QR ใหม่'}
      </button>}
    </div>}
  </div>;
}
