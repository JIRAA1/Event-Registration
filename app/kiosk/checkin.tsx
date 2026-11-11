'use client';
import {useEffect,useRef,useState} from 'react';
import {QRCodeCanvas} from 'qrcode.react';
import {PasswordInput} from '../password-input';
import {LoginHelp} from '../register/registration-admin';
import {RegistrationFrame} from '../register/registration-frame';
import {errorText,normalizeDigits,signupRpc,type SignupInfo,type Station} from '@/lib/event-registration';

export function KioskCheckin({station,onExit}:{station:Station;onExit:()=>void}){
  const [info,setInfo]=useState<SignupInfo>();
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState<{student_id:string;full_name:string;status:string}>();
  const [url,setUrl]=useState('');
  const form=useRef<HTMLFormElement>(null);
  const lock=useRef(false);
  useEffect(()=>{
    let active=true;
    setUrl(window.location.origin+'/?event='+encodeURIComponent(station.event));
    signupRpc<SignupInfo>('registration_info',{p_event:station.event}).then(data=>{if(active)setInfo(data);})
      .catch(error=>{if(active)setError(errorText(error));});
    return ()=>{active=false;};
  },[station.event]);
  useEffect(()=>{
    if(!result)return;
    const expires=Date.now()+90000;
    const clear=()=>{if(Date.now()>=expires)setResult(undefined);};
    const timer=setTimeout(clear,90000);
    document.addEventListener('visibilitychange',clear);
    return ()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',clear);};
  },[result]);
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>;
    const reset=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(!lock.current)form.current?.reset();},300000);};
    reset();document.addEventListener('pointerdown',reset);document.addEventListener('keydown',reset);
    return ()=>{clearTimeout(timer);document.removeEventListener('pointerdown',reset);document.removeEventListener('keydown',reset);};
  },[]);
  async function checkin(element:HTMLFormElement){
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');
    const data=new FormData(element);
    try{
      const response=await signupRpc<NonNullable<typeof result>>('registration_station_checkin',{
        p_station:station.token,p_event:station.event,p_student_id:normalizeDigits(String(data.get('student_id')||'')),
        p_password:String(data.get('password')||''),
      });
      element.reset();setResult(response);
    }catch(error){setError(errorText(error));}
    finally{lock.current=false;setBusy(false);}
  }
  return <RegistrationFrame kiosk title={info?.event?.title||'เช็กอินเข้าร่วมกิจกรรม'} location={info?.event?.location}>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-800">{error}</p>}
    {result?<div className="space-y-4 text-center">
      <h2 className="text-xl font-bold text-emerald-800">{result.status==='COMPLETED'?'เข้าร่วมกิจกรรมสำเร็จแล้ว':'กำลังเข้าร่วมกิจกรรม'}</h2>
      <p>{result.full_name} · {result.student_id}</p>
      <div className="qr-ticket flex justify-center rounded-xl p-4"><QRCodeCanvas value={url} size={220} marginSize={4}/></div>
      <p>ใช้มือถือสแกนเพื่อเปิด Event Pass แล้วเข้าสู่ระบบด้วยบัญชีของคุณ</p>
      <p className="text-sm text-slate-600">หน้าจอนี้จะล้างข้อมูลใน 90 วินาที</p>
      <button className="action-primary w-full" onClick={()=>{setResult(undefined);setError('');}}>เสร็จแล้ว · คนถัดไป</button>
    </div>:<form ref={form} className="space-y-4" autoComplete="off" onSubmit={event=>{event.preventDefault();void checkin(event.currentTarget);}}>
      <h2 className="text-xl font-bold">ยืนยันบัญชีเพื่อเช็กอินเข้างาน</h2>
      <label className="block text-sm">รหัสนักศึกษา<input name="student_id" required inputMode="numeric" pattern="[0-9๐-๙]{7,8}" maxLength={8} className="mt-1 block w-full rounded-xl border px-3"/></label>
      <label className="block text-sm">รหัสผ่าน<PasswordInput name="password" required autoComplete="off" className="mt-1 block w-full rounded-xl border px-3"/></label>
      <p className="text-sm text-slate-600">รหัสผ่านเริ่มต้นคือวันเกิด พ.ศ. 8 หลัก เช่น 01012549 หากเปลี่ยนแล้วให้ใช้รหัสผ่านปัจจุบัน</p>
      <button disabled={busy||!info?.event||info.event.closed} className="action-primary w-full">{busy?'กำลังเช็กอิน…':'ยืนยันและเช็กอินเข้างาน'}</button>
    </form>}
    <LoginHelp popupOnly loginFailed={error.includes('รหัสผ่านไม่ถูกต้อง')}/>
    <footer><button disabled={busy} onClick={onExit} className="action-secondary">ออกจากบัญชีเครื่อง</button></footer>
  </RegistrationFrame>;
}
