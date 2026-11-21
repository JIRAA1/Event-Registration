'use client';
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
export function AttendanceSecuritySettings({token,eventId}:{token:string;eventId:string}){
  const [radius,setRadius]=useState(100),[accuracy,setAccuracy]=useState(50);
  const [loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [student,setStudent]=useState(''),[reason,setReason]=useState('');
  useEffect(()=>{let disposed=false;setLoaded(false);void supabase?.rpc('admin_scan_security',{p_token:token,p_event:eventId}).then(({data,error})=>{if(disposed)return;if(error){setMessage(error.message);return;}setRadius(data.radius_m);setAccuracy(data.accuracy_m);setLoaded(true);});return()=>{disposed=true;};},[token,eventId]);
  async function save(){if(busy||!supabase)return;setBusy(true);try{const {error}=await supabase.rpc('admin_scan_security',{p_token:token,p_event:eventId,p_radius:radius,p_accuracy:accuracy});setMessage(error?.message||'บันทึกระยะ GPS สำหรับกิจกรรมนี้แล้ว');}finally{setBusy(false);}}
  async function reset(){if(busy||!supabase)return;setBusy(true);try{const {error}=await supabase.rpc('admin_reset_student_device',{p_token:token,p_student_id:student,p_reason:reason});setMessage(error?.message||'ปลดล็อกแล้ว ให้นักศึกษาเข้าสู่ระบบใหม่ สถานะการเข้าร่วมกิจกรรมยังคงเดิม');if(!error){setStudent('');setReason('');}}finally{setBusy(false);}}
  return <section className="mb-6 space-y-4 rounded-xl border p-4">
    <h3 className="font-bold">ป้องกันการสแกนแทนกัน</h3>
    <form onSubmit={e=>{e.preventDefault();void save();}} className="space-y-3">
      <label className="block">ระยะห่างจากสตาฟสูงสุด (เมตร)<input required type="number" min={10} max={1000} value={radius} onChange={e=>setRadius(Number(e.target.value))} className="ml-3 w-24 rounded border p-2"/></label>
      <label className="block">ความคลาดเคลื่อน GPS สูงสุด (เมตร)<input required type="number" min={5} max={200} value={accuracy} onChange={e=>setAccuracy(Number(e.target.value))} className="ml-3 w-24 rounded border p-2"/></label>
      <p className="text-sm">หากเกินเกณฑ์หรือไม่มี GPS สตาฟต้องตรวจตัวบุคคลและระบุเหตุผลก่อนอนุมัติ</p>
      <button disabled={busy||!loaded} className="rounded border p-2 disabled:opacity-40">บันทึกเกณฑ์กิจกรรมนี้</button>
    </form>
    <form onSubmit={e=>{e.preventDefault();void reset();}} className="space-y-3 border-t pt-4">
      <h4 className="font-bold">ปลดล็อกเครื่องนักศึกษา</h4>
      <p className="text-sm">ตรวจตัวนักศึกษาก่อนใช้ กดแล้วเซสชันเดิมทั้งหมดจะหมดอายุ และนักศึกษาสามารถเข้าเครื่องใหม่ได้</p>
      <label className="block">รหัสนักศึกษา<input required value={student} onChange={e=>setStudent(e.target.value)} className="ml-3 rounded border p-2"/></label>
      <label className="block">เหตุผล<textarea required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} className="block w-full rounded border p-2"/></label>
      <button disabled={busy||!loaded||reason.trim().length<5} className="rounded bg-[#7c0a02] p-2 text-white disabled:opacity-40">ยืนยันปลดล็อกและยกเลิกเซสชันเดิม</button>
    </form>
    <p role="status">{message}</p>
  </section>;
}
