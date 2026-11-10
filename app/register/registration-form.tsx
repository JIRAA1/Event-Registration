'use client';

import {useEffect,useRef,useState} from 'react';
import {QRCodeCanvas} from 'qrcode.react';
import {errorText,newReceipt,normalizeDigits,signupRpc,type ApplicationProfile,type Receipt,type SignupInfo} from '@/lib/event-registration';

const input='mt-1 block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base';
const fields=[
  ['student_id','รหัสนักศึกษา'],['full_name','ชื่อและนามสกุล'],['class_group','หมู่เรียน'],
  ['birth_date','วันเกิด 8 หลัก (ววดดปปปป พ.ศ.)'],['phone','เบอร์โทรศัพท์'],
] as const;

export function RegistrationForm({eventId,station,onExit}:{eventId:string;station?:string;onExit?:()=>void}) {
  const storageKey='aru-signup:'+eventId+(station?':station:'+station.slice(-12):':online');
  const [info,setInfo]=useState<SignupInfo>();
  const [error,setError]=useState('');
  const [method,setMethod]=useState<'new'|'existing'>(station?'new':'existing');
  const [secret,setSecret]=useState('');
  const [receipt,setReceipt]=useState<Receipt>();
  const [initial,setInitial]=useState<ApplicationProfile>();
  const [faculty,setFaculty]=useState('');
  const [busy,setBusy]=useState(false);
  const [edit,setEdit]=useState(false);
  const [password,setPassword]=useState('');
  const [copied,setCopied]=useState(false);
  const [origin,setOrigin]=useState('');
  const [formKey,setFormKey]=useState(0);
  const lock=useRef(false);
  const loginUrl=origin+'/?event='+encodeURIComponent(eventId);
  useEffect(()=>{
    let active=true;
    setOrigin(window.location.origin);
    const saved=sessionStorage.getItem(storageKey);
    if(saved)setSecret(saved);
    else {
      const raw=sessionStorage.getItem(storageKey+':draft');
      if(raw){
        try{
          const draft=JSON.parse(raw) as {key:string};
          void signupRpc<Receipt>('registration_receipt',{p_event:eventId,p_receipt:draft.key,p_station:station||null}).then(data=>{
            if(active && sessionStorage.getItem(storageKey+':draft')===raw){
              sessionStorage.setItem(storageKey,draft.key);sessionStorage.removeItem(storageKey+':draft');setReceipt(data);setSecret(draft.key);
            }
          }).catch(()=>{});
        }catch{sessionStorage.removeItem(storageKey+':draft');}
      }
    }
    signupRpc<SignupInfo>('registration_info',{p_event:eventId}).then(data=>{if(active)setInfo(data);}).catch(e=>{if(active)setError(errorText(e));});
    return ()=>{active=false};
  },[eventId,storageKey,station]);
  const status=receipt?.status;
  useEffect(()=>{
    if(!secret || edit || status==='APPROVED' || status==='CANCELLED')return;
    let active=true;
    let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try {
        const data=await signupRpc<Receipt>('registration_receipt',{p_event:eventId,p_receipt:secret,p_station:station||null});
        if(!active)return;
        setReceipt(data);setError('');
      }catch(e){if(active)setError(errorText(e));}
      if(active)timer=setTimeout(poll,3500);
    };
    void poll();
    return ()=>{active=false;clearTimeout(timer);};
  },[secret,eventId,station,edit,status]);
  function clear() {
    sessionStorage.removeItem(storageKey);sessionStorage.removeItem(storageKey+':draft');
    setSecret('');setReceipt(undefined);setPassword('');setInitial(undefined);setFaculty('');
    setCopied(false);setEdit(false);setError('');setFormKey(k=>k+1);
  }
  useEffect(()=>{
    if(!station || !secret || status!=='APPROVED')return;
    const deadline=Date.now()+90000;
    const check=()=>{if(Date.now()>=deadline)clear();};
    const timer=setTimeout(check,90000);document.addEventListener('visibilitychange',check);
    return ()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',check);};
  },[station,secret,status,storageKey,password]);
  async function nextVisitor() {
    if(station && secret && status!=='APPROVED' && status!=='CANCELLED'){
      await signupRpc('registration_cancel_station_request',{p_event:eventId,p_receipt:secret,p_station:station});
    }
    clear();
  }
  useEffect(()=>{
    if(!station || status==='APPROVED')return;
    let timer:ReturnType<typeof setTimeout>;
    let deadline=0;
    const expire=()=>{
      if(lock.current){reset();return;}
      // Clear the shared display even if the device is temporarily offline.
      if(secret)void signupRpc('registration_cancel_station_request',{p_event:eventId,p_receipt:secret,p_station:station}).catch(()=>{});
      clear();
    };
    const reset=()=>{clearTimeout(timer);deadline=Date.now()+300000;timer=setTimeout(expire,300000);};
    const resume=()=>{if(!document.hidden && Date.now()>=deadline)expire();};
    reset();window.addEventListener('pointerdown',reset);window.addEventListener('keydown',reset);
    document.addEventListener('visibilitychange',resume);
    return ()=>{clearTimeout(timer);window.removeEventListener('pointerdown',reset);window.removeEventListener('keydown',reset);document.removeEventListener('visibilitychange',resume);};
  },[station,secret,status,storageKey,formKey]);
  async function run(action:()=>Promise<void>) {
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');
    try{await action();}catch(e){setError(errorText(e));}finally{lock.current=false;setBusy(false);}
  }
  async function submit(form:HTMLFormElement) {
    const values=new FormData(form);
    const get=(k:string)=>String(values.get(k)||'').trim();
    const studentId=normalizeDigits(get('student_id'));
    if(method==='existing' && !station && !edit){
      const data=await signupRpc<{success:boolean;already:boolean;message?:string;user:{role:string};session_token:string}>('registration_login_join',{
        p_event:eventId,p_student_id:studentId,p_password:String(values.get('password')||''),
      });
      if(!data.success)throw new Error(data.message||'กรุณาใช้บัญชีนักศึกษา');
      sessionStorage.setItem('aru-join-feedback',data.already?'คุณลงทะเบียนกิจกรรมนี้แล้ว':'ลงทะเบียนเข้าร่วมกิจกรรมแล้ว');
      sessionStorage.setItem('aru-user-v1',JSON.stringify(data.user));sessionStorage.setItem('aru-session-token',data.session_token);
      window.location.assign(loginUrl);return;
    }
    const profile:ApplicationProfile={student_id:studentId,full_name:get('full_name'),class_group:get('class_group'),faculty,major:get('major'),
      study_year:get('study_year'),birth_date:normalizeDigits(get('birth_date')),phone:normalizeDigits(get('phone'))};
    // Keep a retry key before sending, so a lost response can be retried with the same request.
    const draft=JSON.parse(sessionStorage.getItem(storageKey+':draft')||'null') as {id:string;key:string}|null;
    const key=secret || (draft?.id===studentId?draft.key:newReceipt());
    sessionStorage.setItem(storageKey+':draft',JSON.stringify({id:studentId,key}));
    await signupRpc('registration_apply',{p_event:eventId,p_profile:profile,p_receipt:key,p_station:station||null});
    sessionStorage.setItem(storageKey,key);sessionStorage.removeItem(storageKey+':draft');
    setEdit(false);setReceipt(undefined);setSecret(key);
  }
  return <main className="canvas-grid min-h-screen px-3 py-5 sm:py-10"><section className="bento mx-auto max-w-xl space-y-4 p-5 sm:p-8">
    <header><p className="text-sm font-bold text-[#7c0a02]">{station?'จุดลงทะเบียนหน้างาน':'ลงทะเบียนเข้าร่วมกิจกรรม'}</p>
      <h1 className="mt-1 text-2xl font-bold">{info?.event?.title || 'ARU Event Pass'}</h1><p className="text-sm text-slate-600">{info?.event?.location}</p></header>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {!info ? <button className="action-secondary" onClick={()=>window.location.reload()}>{error?'ลองโหลดอีกครั้ง':'กำลังโหลดกิจกรรม…'}</button>
      : !info.event ? <p>ไม่พบกิจกรรมนี้</p>
      : secret && !edit ? <div className="space-y-4">
        {!receipt ? <p role="status">กำลังตรวจสอบคำขอ…</p> : <>
          <p className="text-sm text-slate-600">คำขอ {receipt.id.slice(0,8).toUpperCase()}</p>
          {status==='PENDING' && <h2 className="text-lg font-bold">ได้รับใบสมัครแล้ว · รอแอดมินยืนยัน</h2>}
          {status==='CORRECT' && <><p>กรุณาแก้ไข: {receipt.note}</p><button className="action-primary" onClick={()=>{setInitial(receipt.profile||undefined);setFaculty(receipt.profile?.faculty||'');setEdit(true);}}>แก้ไขใบสมัคร</button></>}
          {status==='CANCELLED' && <p>คำขอนี้ถูกยกเลิกแล้ว</p>}
          {status==='APPROVED' && <>
            <div className="space-y-2 rounded-2xl bg-emerald-50 p-4"><h2 className="text-lg font-bold">ลงทะเบียนสำเร็จ</h2>
              <p>ชื่อผู้ใช้ <b>{receipt.student_id}</b></p>
              {password?<><p>รหัสผ่านเริ่มต้น <b className="break-all font-mono">{password}</b></p><button className="action-secondary" onClick={()=>void run(async()=>{await navigator.clipboard.writeText(receipt.student_id+'\n'+password);setCopied(true);})}>{copied?'คัดลอกแล้ว':'คัดลอกข้อมูลเข้าสู่ระบบ'}</button></>:
              receipt.issued && !receipt.claimed?<button className="action-primary" disabled={busy} onClick={()=>void run(async()=>{
                const data=await signupRpc<Receipt>('registration_receipt',{p_event:eventId,p_receipt:secret,p_station:station||null,p_claim:true});
                setReceipt(data);setPassword(data.password||'');
              })}>แสดงรหัสผ่านเริ่มต้นครั้งเดียว</button>:<p>{receipt.issued?'แสดงรหัสผ่านไปแล้ว หากไม่ได้บันทึกกรุณาติดต่อแอดมิน':'ใช้รหัสผ่าน Event Pass เดิม'}</p>}
            </div>
            {station?<div className="qr-ticket grid justify-items-center gap-2 p-2"><QRCodeCanvas value={loginUrl} size={180} marginSize={4}/><p>ใช้มือถือสแกนเพื่อเปิด Event Pass</p><small>หน้าจอจะล้างข้อมูลใน 90 วินาที</small></div>:<a className="action-primary w-full" href={loginUrl}>เข้าสู่ Event Pass</a>}
          </>}
        </>}
        {(station || status==='CANCELLED' || status==='APPROVED') && <button className="action-secondary w-full" onClick={()=>{
          if((status==='PENDING'||status==='CORRECT') && !confirm('ยกเลิกคำขอของคนนี้และเริ่มคนถัดไป?'))return;
          void run(nextVisitor);
        }}>{station?'เสร็จแล้ว · คนถัดไป':'ปิดข้อมูลใบสมัคร'}</button>}
      </div>
      : info.event.closed || (!station && !info.event.open) ? <p className="rounded-xl bg-amber-50 p-4">ปิดรับสมัครออนไลน์แล้ว กรุณาติดต่อจุดลงทะเบียนหน้างาน</p>
      : <>
        {!station && !edit && <div className="grid grid-cols-2 gap-2">{(['existing','new'] as const).map(m=><button key={m} type="button" aria-pressed={method===m} className={method===m?'action-primary':'action-secondary'} onClick={()=>{setMethod(m);setError('');}}>{m==='existing'?'มีบัญชี Event Pass':'สมัครบัญชีใหม่'}</button>)}</div>}
        <form key={method+formKey} className="space-y-3" onSubmit={e=>{e.preventDefault();const form=e.currentTarget;void run(()=>submit(form));}}>
          {method==='existing' && !station && !edit ? <>
            <label className="block text-sm">รหัสนักศึกษา<input name="student_id" required className={input} autoComplete="username"/></label>
            <label className="block text-sm">รหัสผ่าน<input type="password" name="password" required className={input} autoComplete="current-password"/></label>
          </>:<>
            {fields.map(([name,label])=><label key={name} className="block text-sm">{label}<input required name={name} defaultValue={initial?.[name]} readOnly={edit && name==='student_id'}
              inputMode={['birth_date','student_id','phone'].includes(name)?'numeric':'text'} maxLength={name==='full_name'?255:name==='class_group'?50:name==='phone'?10:8} autoComplete="off" className={input}/></label>)}
            <label className="block text-sm">คณะ<select required value={faculty} onChange={e=>setFaculty(e.target.value)} className={input}><option value="">เลือกคณะ</option>{Object.keys(info.catalog||{}).map(f=><option key={f}>{f}</option>)}</select></label>
            <label className="block text-sm">สาขา<select key={faculty} name="major" required defaultValue={initial?.faculty===faculty?initial.major:''} className={input}><option value="">เลือกสาขา</option>{info.catalog?.[faculty]?.map(m=><option key={m}>{m}</option>)}</select></label>
            <label className="block text-sm">ชั้นปี<select name="study_year" defaultValue={initial?.study_year||''} required className={input}><option value="">เลือกชั้นปี</option>{[1,2,3,4,5,6,7,8].map(y=><option key={y}>{y}</option>)}</select></label>
          </>}
          <button disabled={busy} className="action-primary w-full">{busy?'กำลังส่ง…':method==='existing' && !station && !edit?'ยืนยันบัญชีและเข้ากิจกรรม':'ส่งใบสมัครให้แอดมินยืนยัน'}</button>
        </form>
      </>}
    {info?.contact && <a href={info.contact} target="_blank" rel="noreferrer" className="action-secondary">ติดต่อแอดมิน</a>}
    {station?<button className="block text-sm underline" onClick={onExit}>ออกจากบัญชีเครื่อง</button>:<a className="block text-sm underline" href={loginUrl}>กลับหน้า Event Pass</a>}
  </section></main>;
}
