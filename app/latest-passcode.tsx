'use client';

import {useState} from 'react';
import {Check, Clipboard, Ticket} from 'lucide-react';

export function LatestPasscode({eventTitle,passcode,checkoutAt,openEvent}:{eventTitle:string;passcode?:string;checkoutAt?:string;openEvent:()=>void}) {
  const [feedback,setFeedback]=useState('');
  const [copying,setCopying]=useState(false);
  const timestamp=checkoutAt?Date.parse(checkoutAt):NaN;
  async function copy() {
    if(!passcode||copying)return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(passcode);
      setFeedback('คัดลอก Passcode แล้ว');
    } catch {
      setFeedback('คัดลอกอัตโนมัติไม่ได้ กรุณากดค้างที่รหัสเพื่อเลือกและคัดลอก');
    } finally {setCopying(false);}
  }
  return <section aria-label="Passcode กิจกรรมล่าสุด" className="min-w-0 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 shadow-sm sm:p-6">
    <div className="flex items-start gap-3">
      <span className="shrink-0 rounded-xl bg-amber-200 p-2.5 text-amber-950"><Ticket size={24}/></span>
      <div className="min-w-0"><h2 className="text-lg font-extrabold text-slate-900 sm:text-xl">Passcode กิจกรรมล่าสุด</h2><p className="mt-1 break-words text-base font-semibold text-slate-800">{eventTitle}</p></div>
    </div>
    <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-emerald-800"><Check size={18}/>สแกนออกแล้ว{Number.isFinite(timestamp)&&<span className="text-slate-600">· {new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(timestamp)}</span>}</p>
    {passcode ? <>
      <p className="mt-4 rounded-xl border border-amber-200 bg-white px-4 py-5 text-center"><code className="select-all break-all font-mono text-2xl font-extrabold tracking-wider text-[#7c0a02] sm:text-3xl">{passcode}</code></p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row"><button type="button" onClick={()=>void copy()} disabled={copying} className="action-primary sm:flex-1"><Clipboard size={20}/>{copying?'กำลังคัดลอก…':'คัดลอก Passcode'}</button><button type="button" onClick={openEvent} className="action-secondary">ดูรายละเอียดกิจกรรม</button></div>
      <p role="status" aria-live="polite" className="mt-2 text-sm text-slate-700">{feedback}</p>
    </> : <div className="mt-4 rounded-xl border border-amber-200 bg-white p-4"><p className="font-bold text-amber-950">กำลังรอ Passcode จากผู้จัดกิจกรรม</p><p className="mt-1 text-sm text-slate-600">บันทึกการสแกนออกแล้ว รหัสจะแสดงที่นี่เมื่อได้รับการจัดสรร</p></div>}
  </section>;
}
