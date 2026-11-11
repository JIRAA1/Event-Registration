'use client';

import {useEffect,useRef,useState} from 'react';
import {QRCodeCanvas} from 'qrcode.react';
import {RegistrationFrame} from './registration-frame';
import styles from './registration.module.css';
import {PasswordInput} from '../password-input';
import {LoginHelp} from './registration-admin';
import {BirthDateField} from '../birth-date-field';
import {errorText,newReceipt,normalizeDigits,signupRpc,type ApplicationProfile,type Receipt,type SignupInfo} from '@/lib/event-registration';

const input='mt-1 block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base';
const fields=[
  ['full_name','ชื่อและนามสกุล'],
  ['phone','เบอร์โทรศัพท์'],
] as const;

export function RegistrationForm({eventId,station,onExit,correctionId}:{eventId:string;station?:string;onExit?:()=>void;correctionId?:string}) {
  const storageKey='aru-signup:'+eventId+(station?':station:'+station.slice(-12):':online');
  const [info,setInfo]=useState<SignupInfo>();
  const [error,setError]=useState('');
  const [studentNumber,setStudentNumber]=useState('');
  const [lookup,setLookup]=useState<{id:string;step:'existing'|'new'|'pending'|'error';message?:string}>();
  const [lookupRetry,setLookupRetry]=useState(0);
  const [secret,setSecret]=useState('');
  const [receipt,setReceipt]=useState<Receipt>();
  const [initial,setInitial]=useState<ApplicationProfile>();
  const [faculty,setFaculty]=useState('');
  const [busy,setBusy]=useState(false);
  const [edit,setEdit]=useState(false);
  const [correctionNote,setCorrectionNote]=useState('');
  const [resubmitted,setResubmitted]=useState(false);
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
    if(correctionId){
      signupRpc<{profile:ApplicationProfile;note:string}>('registration_correction',{
        p_token:sessionStorage.getItem('aru-session-token'),p_event:eventId,p_id:correctionId
      }).then(({profile,note})=>{
        if(!active)return;
        setInitial(profile);setStudentNumber(profile.student_id);setFaculty(profile.faculty);
        setCorrectionNote(note);setEdit(true);
      }).catch(e=>{if(active)setError(errorText(e));});
    }else if(saved)setSecret(saved);
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
  },[eventId,storageKey,station,correctionId]);
  const number=normalizeDigits(studentNumber);
  const method=station || edit?'new':lookup?.id===number?lookup.step:'lookup';
  useEffect(()=>{
    if(station || secret || edit || !info?.event?.open || !/^[0-9]{7,8}$/.test(number))return;
    let active=true;
    const timer=setTimeout(async()=>{
      try{
        const step=await signupRpc<'existing'|'new'|'pending'>('registration_account_step',{p_event:eventId,p_student_id:number});
        if(active)setLookup({id:number,step});
      }catch(e){if(active)setLookup({id:number,step:'error',message:errorText(e)});}
    },450);
    return ()=>{active=false;clearTimeout(timer);};
  },[station,secret,edit,info,eventId,number,lookupRetry]);
  const status=receipt?.status;
  const claim=useRef<{key:string;result:Promise<Receipt>}|null>(null);
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!secret || !(status==='APPROVED' || (!station && status==='PENDING')) || !receipt?.issued || receipt.claimed)return;
    let active=true;
    if(claim.current?.key!==secret){
      claim.current={key:secret,result:signupRpc<Receipt>('registration_receipt',{p_event:eventId,p_receipt:secret,p_station:station||null,p_claim:true})};
    }
    claim.current.result.then(data=>{
      if(active){setPassword(data.password||'');setReceipt({...data,claimed:true});setError('');}
    }).catch(e=>{if(active){claim.current=null;setError(errorText(e));}});
    return ()=>{active=false;};
  },[secret,status,receipt?.issued,receipt?.claimed,eventId,station,retry]);
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
    setLookup(undefined);setStudentNumber('');claim.current=null;setSecret('');setReceipt(undefined);setPassword('');setInitial(undefined);setFaculty('');
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
    if(method==='lookup' || method==='error' || method==='pending'){
      setLookup(undefined);setLookupRetry(n=>n+1);return;
    }
    if(method==='existing' && !station && !edit){
      const data=await signupRpc<{success:boolean;already:boolean;pending?:boolean;message?:string;user:{role:string};session_token:string}>('registration_login_join',{
        p_event:eventId,p_student_id:studentId,p_password:String(values.get('password')||''),
      });
      if(!data.success)throw new Error(data.message||'กรุณาใช้บัญชีนักศึกษา');
      sessionStorage.setItem('aru-join-feedback',data.pending?'รอยืนยันเข้าร่วมกิจกรรม':data.already?'คุณลงทะเบียนกิจกรรมนี้แล้ว':'ลงทะเบียนเข้าร่วมกิจกรรมแล้ว');
      sessionStorage.setItem('aru-user-v1',JSON.stringify(data.user));sessionStorage.setItem('aru-session-token',data.session_token);
      window.location.assign(loginUrl);return;
    }
    const profile:ApplicationProfile={student_id:studentId,prefix:get('prefix'),full_name:get('full_name'),class_group:get('class_group'),faculty,major:get('major'),
      study_year:get('study_year'),birth_date:normalizeDigits(get('birth_date')),phone:normalizeDigits(get('phone'))};
    if(correctionId){
      await signupRpc('registration_correction',{p_token:sessionStorage.getItem('aru-session-token'),p_event:eventId,p_id:correctionId,p_profile:profile});
      setResubmitted(true);return;
    }
    // Keep a retry key before sending, so a lost response can be retried with the same request.
    const draft=JSON.parse(sessionStorage.getItem(storageKey+':draft')||'null') as {id:string;key:string}|null;
    const key=secret || (draft?.id===studentId?draft.key:newReceipt());
    sessionStorage.setItem(storageKey+':draft',JSON.stringify({id:studentId,key}));
    const applied=await signupRpc<{id:string;account_created?:boolean}>('registration_apply',{p_event:eventId,p_profile:profile,p_receipt:key,p_station:station||null});
    sessionStorage.setItem(storageKey,key);sessionStorage.removeItem(storageKey+':draft');
    if(applied.account_created){
      setPassword(profile.birth_date);
      setReceipt({id:applied.id,status:'PENDING',student_id:studentId,note:'',issued:true,claimed:false,password:null,profile:null});
    }else setReceipt(undefined);
    setEdit(false);setSecret(key);
  }
  return <RegistrationFrame kiosk={!!station} title={info?.event?.title || 'ลงทะเบียนเข้าร่วมกิจกรรม'} location={info?.event?.location}>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {!info ? (error ? <button className="action-secondary" onClick={()=>window.location.reload()}>ลองโหลดอีกครั้ง</button> : <p role="status">กำลังโหลดกิจกรรม…</p>)
      : !info.event ? <p>ไม่พบกิจกรรมนี้</p>
      : resubmitted ? <p role="status" className="rounded-xl bg-emerald-50 p-4">ส่งใบสมัครที่แก้ไขแล้ว รอแอดมินยืนยันอีกครั้ง</p>
      : correctionId && !edit ? (!error && <p role="status">กำลังเปิดใบสมัครที่ต้องแก้ไข…</p>)
      : secret && !edit ? <div className="space-y-4">
        {!receipt ? <p role="status">กำลังตรวจสอบคำขอ…</p> : <>
          <p className="text-sm text-slate-600">คำขอ {receipt.id.slice(0,8).toUpperCase()}</p>
          {status==='PENDING' && !receipt.issued && <h2 className="text-lg font-bold">ได้รับใบสมัครแล้ว · รอแอดมินยืนยัน</h2>}
          {status==='CORRECT' && <><p>กรุณาแก้ไข: {receipt.note}</p><button className="action-primary" onClick={()=>{setInitial(receipt.profile||undefined);setStudentNumber(receipt.student_id);setFaculty(receipt.profile?.faculty||'');setEdit(true);}}>แก้ไขใบสมัคร</button></>}
          {status==='CANCELLED' && <p>คำขอนี้ถูกยกเลิกแล้ว</p>}
          {(status==='APPROVED' || (!station && receipt.issued && status==='PENDING')) && <>
            <div className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"><h2 className="text-lg font-bold">ลงทะเบียนสำเร็จ</h2>
              <p className="font-semibold">{info.event.title}</p>
              {status==='PENDING' && <p>รอยืนยันเข้าร่วมกิจกรรมจากแอดมิน คุณเข้าสู่ระบบเพื่อตรวจสถานะได้เลย</p>}
              <p>ชื่อผู้ใช้ <b className="font-mono text-lg">{receipt.student_id}</b></p>
              {password?<><p>รหัสผ่านเริ่มต้น <b className="break-all font-mono text-lg">{password}</b></p><p className="text-sm">แคปหน้าจอนี้เพื่อเก็บข้อมูลเข้าสู่ระบบ</p><button className="action-secondary" onClick={()=>void run(async()=>{await navigator.clipboard.writeText(receipt.student_id+'\n'+password);setCopied(true);})}>{copied?'คัดลอกแล้ว':'คัดลอกข้อมูลเข้าสู่ระบบ'}</button></>:
              receipt.issued && !receipt.claimed?(error?<button className="action-secondary" onClick={()=>setRetry(n=>n+1)}>ลองโหลดรหัสผ่านอีกครั้ง</button>:<p role="status">กำลังโหลดรหัสผ่าน…</p>):<p>{receipt.issued?'แสดงรหัสผ่านไปแล้ว หากไม่ได้บันทึกกรุณาติดต่อแอดมิน':'ใช้รหัสผ่าน Event Pass เดิม'}</p>}
            </div>
            {station?<div className="qr-ticket grid justify-items-center gap-2 p-2"><QRCodeCanvas value={loginUrl} size={180} marginSize={4}/><p>ใช้มือถือสแกนเพื่อเปิด Event Pass</p><small>หน้าจอจะล้างข้อมูลใน 90 วินาที</small></div>:<a className="action-primary w-full" href={loginUrl}>เข้าสู่ Event Pass</a>}
          </>}
        </>}
        {(station || status==='CANCELLED' || status==='APPROVED') && <button className={station && status==='APPROVED'?'action-primary w-full':'action-secondary w-full'} onClick={()=>{
          if((status==='PENDING'||status==='CORRECT') && !confirm('ยกเลิกคำขอของคนนี้และเริ่มคนถัดไป?'))return;
          void run(nextVisitor);
        }}>{station?'เสร็จแล้ว · คนถัดไป':'ปิดข้อมูลใบสมัคร'}</button>}
      </div>
      : info.event.closed || (!correctionId && !station && !info.event.open) ? <p className="rounded-xl bg-amber-50 p-4">ปิดรับสมัครออนไลน์แล้ว กรุณาติดต่อจุดลงทะเบียนหน้างาน</p>
      : <>
        <form key={formKey} className="space-y-3" onSubmit={e=>{e.preventDefault();const form=e.currentTarget;void run(()=>submit(form));}}>
          <h2 className="text-xl font-bold">{edit?'แก้ไขใบสมัคร':station?'กรอกข้อมูลผู้เข้าร่วม':'สมัครเข้าร่วมกิจกรรม'}</h2>
          {edit && <p className="rounded-xl bg-amber-50 p-3">ข้อความจากแอดมิน · {correctionNote || receipt?.note}</p>}
          <label className="block text-sm">รหัสนักศึกษา<input name="student_id" required className={input} autoComplete={station?'off':'username'}
            inputMode="numeric" pattern="[0-9๐-๙]{7,8}" maxLength={8} placeholder="รหัสนักศึกษา 7–8 หลัก" value={studentNumber}
            readOnly={edit || busy} onChange={e=>{const next=normalizeDigits(e.target.value);if(next!==studentNumber){setStudentNumber(next);setLookup(undefined);setError('');if(!station)setFaculty('');}}}/></label>
          {method==='lookup' ? <p role="status" className="text-sm text-slate-600">{number.length>=7?'กำลังตรวจสอบรหัสนักศึกษา…':'กรอกรหัสนักศึกษาเพื่อเริ่มสมัคร'}</p>
          : method==='error' ? <p role="alert">{lookup?.message}</p>
          : method==='pending' ? <p role="status">มีใบสมัครรอยืนยันสำหรับกิจกรรมนี้แล้ว กรุณากลับไปยังหน้าที่ส่งใบสมัครหรือติดต่อแอดมิน</p>
          : method==='existing' ? <>
            <label className="block text-sm">รหัสผ่าน<PasswordInput name="password" required className={input} autoComplete="current-password"/></label><p className="text-sm text-slate-600">รหัสผ่านเริ่มต้นของนักศึกษาคือวันเดือนปีเกิด พ.ศ. 8 หลัก เช่น 22062549 หากเปลี่ยนแล้วให้ใช้รหัสผ่านปัจจุบัน</p>
          </>:<div className={styles.profile}>
            <label className="block text-sm">คำนำหน้า<select name="prefix" required defaultValue={initial?.prefix||''} className={input}>
              <option value="">เลือกคำนำหน้า</option><option>นาย</option><option>นางสาว</option></select></label>
            {fields.map(([name,label])=><label key={name} className="block text-sm">{label}<input required name={name} defaultValue={initial?.[name]}
              inputMode={name==='phone'?'numeric':'text'} maxLength={name==='full_name'?255:10} autoComplete="off" className={input}/></label>)}
            <BirthDateField defaultValue={initial?.birth_date}/>
            <label className="block text-sm">คณะ<select required value={faculty} onChange={e=>setFaculty(e.target.value)} className={input}><option value="">เลือกคณะ</option>{Object.keys(info.catalog||{}).map(f=><option key={f}>{f}</option>)}</select></label>
            <label className="block text-sm">สาขา<select key={faculty} name="major" required defaultValue={initial?.faculty===faculty?initial.major:''} className={input}><option value="">เลือกสาขา</option>{info.catalog?.[faculty]?.map(m=><option key={m}>{m}</option>)}</select></label>
            <label className="block text-sm">ชั้นปี<select name="study_year" defaultValue={initial?.study_year||''} required className={input}><option value="">เลือกชั้นปี</option>{[1,2,3,4,5,6,7,8].map(y=><option key={y}>{y}</option>)}</select></label>
            <label className="block text-sm">หมู่เรียน<select name="class_group" required defaultValue={initial?.class_group||''} className={input}>
              <option value="">เลือกหมู่เรียน</option>{[1,2,3,4].map(n=><option key={n}>{n}</option>)}</select></label>
          </div>}
          {method!=='lookup' && <button disabled={busy} className="action-primary w-full">{busy?'กำลังส่ง…':method==='error'||method==='pending'?'ตรวจสอบอีกครั้ง':method==='existing'?'ยืนยันบัญชีและสมัครเข้าร่วม':station||edit?'ส่งใบสมัครให้แอดมินยืนยัน':'ลงทะเบียนและรับบัญชี'}</button>}
        </form>
      </>}
    <LoginHelp popupOnly loginFailed={error.includes('รหัสผ่านไม่ถูกต้อง')}/>
    <footer>{info?.contact && <a href={info.contact} target="_blank" rel="noreferrer" className="action-secondary">ติดต่อแอดมิน</a>}
    {station?<button className="block text-sm underline" onClick={onExit}>ออกจากบัญชีเครื่อง</button>:<a className="block text-sm underline" href={loginUrl}>กลับหน้า Event Pass</a>}
    </footer>
  </RegistrationFrame>;
}
