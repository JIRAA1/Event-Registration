'use client';
import {useEffect,useState} from 'react';
import BrowserGate from '../browser-gate';
import {RegistrationForm} from '../register/registration-form';
import {RegistrationFrame} from '../register/registration-frame';
import {signupRpc,errorText,type Station} from '@/lib/event-registration';

export default function KioskPage(){return <BrowserGate><StationLogin/></BrowserGate>;}
function StationLogin(){
  const [station,setStation]=useState<Station>();
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    if(sessionStorage.getItem('aru-session-token'))return;
    try{setStation(JSON.parse(sessionStorage.getItem('aru-station')||'null'));}catch{sessionStorage.removeItem('aru-station');}
  },[]);
  async function login(form:HTMLFormElement){
    setBusy(true);setError('');
    const f=new FormData(form);
    try{
      const personalToken=sessionStorage.getItem('aru-session-token');
      if(personalToken){
        const result=await signupRpc<{success:boolean;message?:string}>('logout_event_session',{p_session_token:personalToken});
        if(!result.success)throw new Error(result.message||'กรุณาออกจากบัญชีส่วนตัวก่อนเปิดเครื่องหน้างาน');
        sessionStorage.removeItem('aru-session-token');
        sessionStorage.removeItem('aru-user-v1');
      }
      const data=await signupRpc<Station>('registration_station_login',{p_username:f.get('username'),p_password:f.get('password')});
      localStorage.removeItem('aru-event-demo-v1');
      sessionStorage.setItem('aru-station',JSON.stringify(data));setStation(data);
    }catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  async function exit(){
    if(!station || !confirm('ออกจากบัญชีเครื่องลงทะเบียนหน้างาน?'))return;
    try{await signupRpc('registration_station_logout',{p_token:station.token});}
    catch(e){setError(errorText(e));}
    for(const key of Object.keys(sessionStorage))if(key.startsWith('aru-signup:')&&key.includes(':station:'))sessionStorage.removeItem(key);
    sessionStorage.removeItem('aru-station');setStation(undefined);
  }
  if(station)return <RegistrationForm station={station.token} eventId={station.event} onExit={()=>void exit()}/>;
  return <RegistrationFrame kiosk title="เปิดเครื่องลงทะเบียน"><form className="space-y-4"
    onSubmit={e=>{e.preventDefault();if(!busy)void login(e.currentTarget);}}>
    <h2 className="text-xl font-bold">เข้าสู่ระบบด้วยบัญชีเครื่อง</h2>
    <label className="block">ชื่อบัญชีเครื่อง<input name="username" required className="mt-1 block h-11 w-full rounded-xl border px-3"/></label>
    <label className="block">รหัสผ่านเครื่อง<input type="password" name="password" required className="mt-1 block h-11 w-full rounded-xl border px-3"/></label>
    {error&&<p role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-800">{error}</p>}<button disabled={busy} className="action-primary w-full">{busy?'กำลังเข้าสู่ระบบ…':'เข้าสู่ระบบเครื่อง'}</button>
  </form><footer><a href="/" className="text-sm underline">กลับหน้า Event Pass</a></footer></RegistrationFrame>;
}
