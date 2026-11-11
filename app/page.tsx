'use client';

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { StudentQr } from './student-qr';
import { RegistrationAdmin, LoginHelp } from './register/registration-admin';
import BrowserGate from './browser-gate';
import {RosterUpload} from './register/roster-upload';
import {importRosterInBatches} from '@/lib/import-roster';
import {readStudentFile} from '@/lib/student-file';
import {OpenEvents} from './register/open-events';
import {birthDateToInput} from '@/lib/birth-date';
import {PasswordInput} from './password-input';
import {BirthDateField} from './birth-date-field';
import { Camera, CameraOff, Save, Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, BookOpen, Building2, Calendar, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clipboard, Clock3, Download, ExternalLink, Eye, FileSpreadsheet, FileUp, Filter, Gauge, GraduationCap, Layers, LayoutDashboard, Loader2, Lock, LogOut, MapPin, Menu, Phone, Plus, QrCode, RefreshCw, ScanLine, Search, Settings2, ShieldCheck, Sparkles, Ticket, Trash2, Unlock, UserCheck, Users, UserX, X, Zap } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { soundEngine } from '@/lib/sound';
import { ARU_CATALOG } from '@/lib/aru-catalog';

type Role = 'STUDENT' | 'STAFF' | 'ADMIN';
type Status = 'REGISTERED' | 'ATTENDING' | 'COMPLETED';
type User = { id: string; student_id: string; full_name: string; faculty: string; major: string; class_group: string; enrollment_year: number; study_year: number; birth_date?: string; phone?: string; role: Role };
type Event = { id: string; title: string; location: string; activity_hours: number; status: 'ACTIVE'|'UPCOMING'|'CLOSED'; redirect_url_year1: string; scan_mode: 'CHECKIN'|'CHECKOUT'; banner_url?: string; };
type Registration = { event_id: string; user_id: string; status: Status; passcode?: string; checkin_at?: string; checkout_at?: string; checked_in_by?: string; checked_out_by?: string; checkin_staff_name?: string; checkout_staff_name?: string; is_walkin?: boolean; checkin_station?:boolean };
type EventDashboardRow = { event_id:string;title:string;status:Event['status'];registered_count:number;checked_in_count:number;checked_out_count:number;online_students:number;online_staff:number };
type Passcode = { event_id: string; code: string; is_reserve: boolean; assigned_to?: string };
type Store = { users: User[]; events: Event[]; regs: Registration[]; codes: Passcode[]; applications?: {id:string;event_id:string;title:string;online:boolean;status:string;note:string}[] };
type AcademicMajor = { id:string; name:string };
type AcademicFaculty = { id:string; name:string; majors:AcademicMajor[] };
type CatalogAction = 'ADD_FACULTY'|'UPDATE_FACULTY'|'DELETE_FACULTY'|'ADD_MAJOR'|'UPDATE_MAJOR'|'DELETE_MAJOR';

const demoUser: User = { id:'stu-aru-6801234', student_id:'6801234', full_name:'ณัฐวดี ศรีสวัสดิ์', faculty:'คณะครุศาสตร์', major:'คอมพิวเตอร์ศึกษา', class_group:'6801.1', enrollment_year:2568, study_year:2, role:'STUDENT' };
const staffUser: User = { id:'staff-001', student_id:'staff001', full_name:'กิตติพงษ์ ใจดี', faculty:'องค์การนักศึกษา', major:'ฝ่ายกิจกรรม', class_group:'STAFF', enrollment_year:2565, study_year:0, role:'STAFF' };
const adminUser: User = { id:'admin-001', student_id:'admin001', full_name:'ผู้ดูแลระบบ', faculty:'องค์การนักศึกษา', major:'ผู้ดูแลระบบ', class_group:'ADMIN', enrollment_year:2565, study_year:0, role:'ADMIN' };
const initialStore: Store = {
  users:[demoUser,staffUser,adminUser,{id:'stu-6908871',student_id:'6908871',full_name:'ภาคิน วัฒนากุล',faculty:'คณะวิทยาศาสตร์และเทคโนโลยี',major:'วิทยาการคอมพิวเตอร์',class_group:'6901.2',enrollment_year:2569,study_year:1,role:'STUDENT'}],
  events:[
    {id:'evt-aru-01',title:'ปฐมนิเทศนักศึกษาใหม่ ARU 2569',location:'หอประชุมมหาวิทยาลัย',activity_hours:6,status:'ACTIVE',redirect_url_year1:'https://aru.ac.th/student-life',scan_mode:'CHECKIN'},
    {id:'evt-aru-02',title:'ค่ายผู้นำนักศึกษา · ARU Spirit',location:'ศูนย์ฝึกอบรมสวนป่า',activity_hours:12,status:'ACTIVE',redirect_url_year1:'',scan_mode:'CHECKIN'},
    {id:'evt-aru-03',title:'กิจกรรมจิตอาสาพัฒนาชุมชน',location:'ชุมชนรอบมหาวิทยาลัย',activity_hours:4,status:'UPCOMING',redirect_url_year1:'',scan_mode:'CHECKIN'}
  ],
  regs:[{event_id:'evt-aru-01',user_id:demoUser.id,status:'REGISTERED',passcode:'ARU-69-K8P2'},{event_id:'evt-aru-02',user_id:demoUser.id,status:'ATTENDING',passcode:'ARU-68-P4M9',checkin_at:new Date().toISOString()},{event_id:'evt-aru-01',user_id:'stu-6908871',status:'REGISTERED'}],
  codes:[{event_id:'evt-aru-01',code:'ARU-R-1001',is_reserve:true},{event_id:'evt-aru-01',code:'ARU-R-1002',is_reserve:true},{event_id:'evt-aru-01',code:'ARU-R-1003',is_reserve:true},{event_id:'evt-aru-02',code:'ARU-R-2001',is_reserve:true}]
};
const storeKey='aru-event-demo-v1';

function readStore(): Store {
  if (typeof window==='undefined') return initialStore;
  try { const saved=localStorage.getItem(storeKey); return saved?JSON.parse(saved) as Store:initialStore; } catch { return initialStore; }
}
function genId():string {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i=0;i<bytes.length;i++) bytes[i]=Math.floor(Math.random()*256);
  bytes[6]=(bytes[6]&0x0f)|0x40;
  bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
async function hashSessionToken(token:string):Promise<string>{
  const bytes=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function westernDigits(value:string){return value.replace(/[๐-๙]/g,d=>String(d.charCodeAt(0)-0x0e50));}
function csvHeaderKey(value:string){return value.replace(/^\uFEFF/,'').trim().toLocaleLowerCase('th').replace(/[\s_-]+/g,'');}
function cx(...parts:(string|false|undefined|null)[]) { return parts.filter(Boolean).join(' '); }
function initials(name:string) { return name.split(' ').map(w=>w[0]).slice(0,2).join(''); }
function formatThaiDate(date=new Date()) { return new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'short',year:'numeric'}).format(date); }
function workspaceStore(data:{users?:unknown;events?:unknown;registrations?:unknown;passcodes?:unknown;applications?:unknown}):Store {
  return {applications:Array.isArray(data.applications)?data.applications:[],users:(Array.isArray(data.users)?data.users:[]) as User[],events:(Array.isArray(data.events)?data.events:[]) as Event[],regs:(Array.isArray(data.registrations)?data.registrations:[]) as Registration[],codes:(Array.isArray(data.passcodes)?data.passcodes:[]) as Passcode[]};
}
function defaultAcademicCatalog():AcademicFaculty[]{return Object.entries(ARU_CATALOG).map(([name,majors],index)=>({id:`demo-faculty-${index}`,name,majors:majors.map((major,majorIndex)=>({id:`demo-major-${index}-${majorIndex}`,name:major}))}));}
function workspaceCatalog(data:{academic_catalog?:unknown}):AcademicFaculty[]{return Array.isArray(data.academic_catalog)?data.academic_catalog as AcademicFaculty[]:defaultAcademicCatalog();}

export default function Home() {
  return <BrowserGate><EventPass/></BrowserGate>;
}

function EventPass() {
  const [store,setStore]=useState<Store>(initialStore);
  const [academicCatalog,setAcademicCatalog]=useState<AcademicFaculty[]>(defaultAcademicCatalog);
  const [user,setUser]=useState<User|null>(null);
  const [sessionToken,setSessionToken]=useState('');
  const [view,setView]=useState<'home'|'studentStats'|'scanner'|'admin'|'event'>('home');
  const [activeEvent,setActiveEvent]=useState('evt-aru-01');
  const [selectedEvent,setSelectedEvent]=useState('evt-aru-01');
  const [flash,setFlash]=useState<'success'|'checkout'|'error'|''>('');
  const [scanMessage,setScanMessage]=useState<{ok:boolean;title:string;detail:string}|null>(null);
  const [scannerOn,setScannerOn]=useState(false);
  const [modal,setModal]=useState<'walkin'|'event'|'codes'|'staff'|'editUser'|null>(null);
  const [editingUser,setEditingUser]=useState<User|null>(null);
  const [editingFaculty,setEditingFaculty]=useState('');
  const [editingMajor,setEditingMajor]=useState('');
  const [toast,setToast]=useState('');
  const [loginError,setLoginError]=useState('');
  const [workspaceReady,setWorkspaceReady]=useState(false);
  const [scanInput,setScanInput]=useState('');
  const [copied,setCopied]=useState(false);
  const [importError,setImportError]=useState('');
  const [csvFile,setCsvFile]=useState<File|null>(null);
  const [saving,setSaving]=useState(false);
  const [loadingMessage,setLoadingMessage]=useState('');
  const [scannerLocked,setScannerLocked]=useState(false);
  const [walkinStudyYear,setWalkinStudyYear]=useState(1);
  const [walkinFaculty,setWalkinFaculty]=useState('');
  const [walkinMajor,setWalkinMajor]=useState('');
  const [mobileNav,setMobileNav]=useState(false);
  const scannerRef=useRef<{clear:()=>void|Promise<void>;stop:()=>Promise<void>}|null>(null);
  const cooldown=useRef<Map<string,number>>(new Map());
  const loadingRef=useRef(false);
  const storeRef=useRef(store);
  storeRef.current=store;
  const selected=store.events.find(e=>e.id===selectedEvent)||store.events[0]||initialStore.events[0];
  const currentEvent=store.events.find(e=>e.id===activeEvent)||store.events[0]||initialStore.events[0];
  const studentRegs=useMemo(()=>store.regs.filter(r=>r.user_id===user?.id),[store.regs,user?.id]);
  const reserveLeft=store.codes.filter(c=>c.event_id===activeEvent&&c.is_reserve&&!c.assigned_to).length;
  const attendance=store.regs.filter(r=>r.event_id===activeEvent&&r.status!=='REGISTERED').length;
  const registered=store.regs.filter(r=>r.event_id===activeEvent).length;

  async function withLoading<T>(message:string,action:()=>Promise<T>|T):Promise<T|undefined>{
    if(loadingRef.current)return;
    loadingRef.current=true;setLoadingMessage(message);
    try{return await action();}
    finally{loadingRef.current=false;setLoadingMessage('');}
  }

  useEffect(()=>{
    if(!workspaceReady || user?.role!=='STUDENT')return;
    const url=new URL(window.location.href);
    const id=url.searchParams.get('event');
    if(id && store.applications?.some(a=>a.event_id===id)){
      setView('home');sessionStorage.removeItem('aru-join-feedback');
      url.searchParams.delete('event');window.history.replaceState(null,'',url);
    }else if(id && store.regs.some(r=>r.event_id===id && r.user_id===user.id)){
      const feedback=sessionStorage.getItem('aru-join-feedback');
      if(feedback){setToast(feedback);sessionStorage.removeItem('aru-join-feedback');}
      setActiveEvent(id);setView('event');url.searchParams.delete('event');window.history.replaceState(null,'',url);
    }
  },[user,store.regs,store.applications,workspaceReady]);

  const isImportingRef = useRef(false);
  const refreshingWorkspaceRef = useRef(false);
  const refreshWorkspace=useCallback(async()=>{
    if(!sessionToken||!supabase||refreshingWorkspaceRef.current)return;
    refreshingWorkspaceRef.current=true;
    try{
      const {data,error}=await supabase.rpc('load_workspace',{p_session_token:sessionToken});
      if(!error&&data?.success){setStore(workspaceStore(data));setAcademicCatalog(workspaceCatalog(data));}
    }finally{
      refreshingWorkspaceRef.current=false;
    }
  },[sessionToken]);

  const loadEventDashboard=useCallback(async()=>{
    if(!sessionToken||!supabase)return [] as EventDashboardRow[];
    const {data,error}=await supabase.rpc('admin_get_event_dashboard',{p_admin_token:sessionToken});
    return !error&&data?.success&&Array.isArray(data.events)?data.events as EventDashboardRow[]:[];
  },[sessionToken]);

  useEffect(()=>{setStore(readStore());localStorage.removeItem('aru-user-v1');const session=sessionStorage.getItem('aru-user-v1');if(session){try{setUser(JSON.parse(session) as User)}catch{sessionStorage.removeItem('aru-user-v1')}}const token=sessionStorage.getItem('aru-session-token')||'';setSessionToken(token);if(token&&supabase){void supabase.rpc('load_workspace',{p_session_token:token}).then(({data,error})=>{if(!error&&data?.success){setWorkspaceReady(true);setStore(workspaceStore(data));setAcademicCatalog(workspaceCatalog(data));if(data.user){setUser(data.user as User);sessionStorage.setItem('aru-user-v1',JSON.stringify(data.user));}if(data.events?.[0]){setSelectedEvent(data.events[0].id);setActiveEvent(data.events[0].id);}}});}},[]);
  useEffect(()=>{try{localStorage.setItem(storeKey,JSON.stringify(store));}catch{}},[store]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),2800);return()=>clearTimeout(t)},[toast]);
  useEffect(()=>{
    const client=supabase;
    if(!sessionToken||!client)return;
    const heartbeat=()=>{const eventId=view==='scanner'?activeEvent:null;void client.rpc('heartbeat_session',{p_session_token:sessionToken,p_active_event_id:eventId});};
    heartbeat();const timer=window.setInterval(heartbeat,15000);window.addEventListener('focus',heartbeat);document.addEventListener('visibilitychange',heartbeat);
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',heartbeat);document.removeEventListener('visibilitychange',heartbeat);};
  },[sessionToken,view,activeEvent,selectedEvent]);
  useEffect(()=>{
    if(!scannerLocked)return;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=previousOverflow;};
  },[scannerLocked]);
  useEffect(()=>{
    const client=supabase;
    if(!user||user.role!=='STUDENT'||!client||!sessionToken)return;
    let disposed=false;
    let channel:ReturnType<typeof client.channel>|undefined;
    let pollTimer:ReturnType<typeof setInterval>|undefined;
    const observed = new Map(storeRef.current.regs.filter(reg => reg.user_id === user.id).map(reg => [reg.event_id, reg.status]));
    const opened = new Set<string>();
    let pending: {event: Event; status: Status} | undefined;
    const openAfterScan = (event: Event | undefined, status: Status) => {
      if (!event || Number(user.study_year) !== 1 || status === 'REGISTERED') return;
      const key = event.id + '/' + status;
      if (opened.has(key) || !/^https?:\/\//i.test(event.redirect_url_year1)) return;
      if (document.hidden) { pending = {event,status}; return; }
      opened.add(key);
      window.location.assign(event.redirect_url_year1);
    };
    let refreshing = false;
    const refresh = async () => {
      if (disposed || document.hidden) return;
      if (pending) {
        const {event,status} = pending;
        pending = undefined;
        openAfterScan(event,status);
      }
      if (refreshing) return;
      refreshing = true;
      try {
        const {data,error} = await client.rpc('load_workspace',{p_session_token:sessionToken});
        if (disposed || error || !data?.success) return;
        const next = workspaceStore(data);
        for (const reg of next.regs) {
          if (reg.user_id !== user.id) continue;
          const previous = observed.get(reg.event_id);
          observed.set(reg.event_id,reg.status);
          if (previous && previous !== reg.status) openAfterScan(next.events.find(event => event.id === reg.event_id),reg.status);
        }
        setStore(next);
      } finally { refreshing = false; }
    };
    const startFallback=()=>{if(!disposed&&!pollTimer)pollTimer=setInterval(refresh,2500);};
    const stopFallback=()=>{if(pollTimer){clearInterval(pollTimer);pollTimer=undefined;}};
    const receiveUpdate=(message:{event_id?:string;user_id?:string;status?:Status;checkin_at?:string|null;checkout_at?:string|null;passcode?:string|null;operation?:string})=>{
      if(message.user_id!==user.id||!message.event_id)return;
      if(message.operation==='DELETE'){
        setStore(old=>({...old,regs:old.regs.filter(reg=>!(reg.event_id===message.event_id&&reg.user_id===user.id))}));
        void refresh();
        return;
      }
      if(message.status){
        setStore(old=>({...old,regs:old.regs.map(reg=>reg.event_id===message.event_id&&reg.user_id===user.id?{...reg,status:message.status!,checkin_at:message.checkin_at||reg.checkin_at,checkout_at:message.checkout_at||reg.checkout_at,passcode:message.passcode||reg.passcode}:reg)}));
        observed.set(message.event_id,message.status);
        openAfterScan(storeRef.current.events.find(event => event.id === message.event_id),message.status);
        if(message.status==='ATTENDING'||message.status==='COMPLETED')setToast(message.status==='COMPLETED'?'เข้าร่วมกิจกรรมสำเร็จ':'กำลังเข้าร่วมกิจกรรม');
      }
      void refresh();
    };
    document.addEventListener('visibilitychange',refresh);
    window.addEventListener('pageshow',refresh);
    const applicationTimer=window.setInterval(()=>{
      if(!pollTimer && storeRef.current.applications?.length)void refresh();
    },15000);
    startFallback();
    void hashSessionToken(sessionToken).then(tokenHash=>{
      if(disposed)return;
      channel=client.channel(`aru-student:${tokenHash}`,{config:{private:true}})
        .on('broadcast',{event:'registration_status'},({payload})=>receiveUpdate(payload as Parameters<typeof receiveUpdate>[0]))
        .subscribe(status=>{
          if(status==='SUBSCRIBED'){stopFallback();refresh();}
          else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED')startFallback();
        });
    }).catch(()=>startFallback());
    return()=>{disposed=true;window.clearInterval(applicationTimer);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('pageshow',refresh);stopFallback();if(channel)void client.removeChannel(channel);};
  },[user?.id,user?.role,user?.study_year,sessionToken]);

  async function enterAs() {
    setLoginError('');
    if(isSupabaseConfigured&&supabase) {
      const studentId=(document.getElementById('login-id') as HTMLInputElement|null)?.value;
      const password=(document.getElementById('login-password') as HTMLInputElement|null)?.value;
      if(!studentId||!password){setToast('กรุณากรอกรหัสผู้ใช้และรหัสผ่าน');return;}
      setSaving(true); const {data,error}=await supabase.rpc('login_student',{p_student_id:studentId,p_password:password}); setSaving(false);
      if(error||!data?.success){setLoginError(data?.message||'เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบเครือข่ายแล้วลองอีกครั้ง');return;}
       const cloudUser=data.user as User;
      const actualRole=cloudUser.role;
       const token=String(data.session_token||'');const {data:workspace,error:workspaceError}=await supabase.rpc('load_workspace',{p_session_token:token});if(workspaceError||!workspace?.success){setToast(workspace?.message||'โหลดข้อมูลบัญชีไม่สำเร็จ');return;}setWorkspaceReady(true);setStore(workspaceStore(workspace));setAcademicCatalog(workspaceCatalog(workspace));if(workspace.events?.[0]){setSelectedEvent(workspace.events[0].id);setActiveEvent(workspace.events[0].id);}const loadedUser={...cloudUser,...workspace.user} as User;setUser(loadedUser);sessionStorage.setItem('aru-user-v1',JSON.stringify(loadedUser));sessionStorage.setItem('aru-session-token',token);setSessionToken(token);setView(actualRole==='STAFF'?'scanner':actualRole==='ADMIN'?'admin':'home');return;
    }
    const picked=demoUser;sessionStorage.removeItem('aru-session-token');setSessionToken('');
    setUser(picked);sessionStorage.setItem('aru-user-v1',JSON.stringify(picked));setView('home');setToast('เข้าสู่โหมดนักศึกษาตัวอย่างแล้ว');
  }
  async function logout(){
    if (isSupabaseConfigured && supabase && sessionToken) {
      const {data,error}=await supabase.rpc('logout_event_session',{p_session_token:sessionToken});
      if (error || !data?.success) {setToast(data?.message || 'ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง');return;}
    } else if (!isSupabaseConfigured && user?.role==='STUDENT' && studentRegs.some(reg=>reg.status==='ATTENDING')) {
      setToast('ต้องรอเจ้าหน้าที่เช็กเอาต์ก่อนจึงจะออกจากระบบได้');return;
    }
    setWorkspaceReady(false);setUser(null);sessionStorage.removeItem('aru-user-v1');sessionStorage.removeItem('aru-session-token');localStorage.removeItem('aru-user-v1');setSessionToken('');setView('home');setScannerOn(false);void stopScanner();
  }
  function save(next:Store){setStore(next)}
  async function scanPayload(raw:string) {
    if (isSupabaseConfigured && supabase) {
      const match=/^ARU1:([\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})$/i.exec(raw.trim());
      if (!match) {
        setScanMessage({ok:false,title:'กรุณาเปิด QR ใหม่',detail:'ให้นักศึกษาเปิดหน้าบัตรกิจกรรมอีกครั้ง'});
        setFlash('error');soundEngine.playError();return;
      }
      const now=Date.now();
      if (now-(cooldown.current.get(raw)||0)<2000) return;
      cooldown.current.set(raw,now);
      const {data,error}=await supabase.rpc('redeem_event_qr',{
        p_session_token:sessionToken,p_event_id:activeEvent,p_scan_mode:currentEvent.scan_mode,p_ticket:match[1],
      });
      if (error || !data?.success) {
        setScanMessage({ok:false,title:data?.message||'สแกนไม่สำเร็จ',detail:error?'ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง':'กรุณาตรวจสอบบัตรก่อนสแกนอีกครั้ง'});
        setFlash('error');soundEngine.playError();return;
      }
      const isOut=data.new_status==='COMPLETED';
      setScanMessage({ok:true,title:data.full_name,detail:isOut?'เข้าร่วมสำเร็จ · เช็กเอาต์เรียบร้อย':'เช็กอินสำเร็จ · ยินดีต้อนรับ'});
      setFlash(isOut?'checkout':'success');isOut?soundEngine.playCheckOutSuccess():soundEngine.playCheckInSuccess();return;
    }
    let parsed:{e?:string;u?:string};try{parsed=JSON.parse(raw)}catch{setScanMessage({ok:false,title:'QR Code ไม่ถูกต้อง',detail:'รูปแบบรหัสไม่ตรงกับกิจกรรม'});setFlash('error');soundEngine.playError();return;}
    const eventId=parsed.e||activeEvent,userId=parsed.u||'';const key=`${eventId}:${userId}`;const now=Date.now();if(now-(cooldown.current.get(key)||0)<500)return;cooldown.current.set(key,now);
    const event=store.events.find(e=>e.id===eventId),reg=store.regs.find(r=>r.event_id===eventId&&r.user_id===userId),person=store.users.find(u=>u.id===userId);
    if(!event||event.status!=='ACTIVE'||!reg||!person){setScanMessage({ok:false,title:'ไม่มีสิทธิ์เข้าร่วม',detail:'ไม่พบรายชื่อในกิจกรรมที่เลือก'});setFlash('error');soundEngine.playError();return;}
    const checkout=event.scan_mode==='CHECKOUT';
    if((!checkout&&reg.status!=='REGISTERED')||(checkout&&reg.status!=='ATTENDING')){setScanMessage({ok:false,title:reg.status==='COMPLETED'?'เช็กเอาต์แล้ว':'ตรวจสอบสถานะอีกครั้ง',detail:reg.status==='REGISTERED'?'ต้องเช็กอินก่อนจึงจะเช็กเอาต์ได้':'QR นี้ถูกสแกนไปแล้ว'});setFlash('error');soundEngine.playError();return;}
    const status:Status=checkout?'COMPLETED':'ATTENDING';const next={...store,regs:store.regs.map(r=>r===reg?{...r,status,...(checkout?{checkout_at:new Date().toISOString(),checked_out_by:user?.id}:{checkin_at:new Date().toISOString(),checked_in_by:user?.id})}:r)};save(next);
    setScanMessage({ok:true,title:person.full_name,detail:checkout?'เข้าร่วมสำเร็จ · เช็กเอาต์เรียบร้อย':'เช็กอินสำเร็จ · ยินดีต้อนรับ'});setFlash(checkout?'checkout':'success');checkout?soundEngine.playCheckOutSuccess():soundEngine.playCheckInSuccess();
  }
  const latestScan = useRef(scanPayload);
  latestScan.current = scanPayload;
  async function startScanner(){
    soundEngine.unlockAudio();
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){const message='เบราว์เซอร์บล็อกกล้องบน HTTP ให้เปิดผ่าน HTTPS หรือ localhost';setScanMessage({ok:false,title:'ต้องใช้การเชื่อมต่อที่ปลอดภัย',detail:message});setToast(message);return;}
    setScanMessage({ok:true,title:'กำลังขอใช้กล้อง',detail:'อนุญาตสิทธิ์ Camera ในหน้าต่างของเบราว์เซอร์'});
    try{
      const {Html5Qrcode}=await import('html5-qrcode');
      const scanner=new Html5Qrcode('aru-reader');
      scannerRef.current=scanner;
      const cameras=await Html5Qrcode.getCameras();
      if(!cameras.length)throw new DOMException('ไม่พบกล้องที่เชื่อมต่ออยู่','NotFoundError');
      const camera=cameras.find(({label})=>/back|rear|environment|หลัง/i.test(label))||cameras[0];
      await scanner.start(camera.id,{fps:20,qrbox:(width,height)=>{const size=Math.min(260,Math.floor(Math.min(width,height)*0.8));return {width:size,height:size};}},(text)=>{void latestScan.current(text)},()=>{});
      setScannerOn(true);
      setScanMessage({ok:true,title:'กล้องพร้อมทำงาน',detail:`กำลังใช้กล้อง ${camera.label||'เริ่มต้น'} · เล็ง QR Code ให้อยู่ในกรอบ`});
    }
    catch(error){
      const name=error instanceof Error?error.name:'';
      const detail=error instanceof Error?`${error.name}: ${error.message}`:String(error);
      let message='เปิดกล้องไม่ได้';
      if(/NotAllowed|Permission|denied|Security/i.test(`${name} ${detail}`))message='ยังไม่ได้รับอนุญาตใช้กล้อง กรุณาเปิดสิทธิ์ Camera สำหรับเว็บไซต์นี้';
      else if(/NotFound|device.*not found/i.test(`${name} ${detail}`))message='ไม่พบกล้องบนอุปกรณ์นี้';
      else if(/NotReadable|TrackStart|busy/i.test(`${name} ${detail}`))message='กล้องกำลังถูกใช้งานโดยแอปอื่น กรุณาปิดแอปนั้นแล้วลองใหม่';
      else if(/Overconstrained|constraint/i.test(`${name} ${detail}`))message='เบราว์เซอร์เลือกกล้องนี้ไม่ได้ กรุณาอนุญาตสิทธิ์กล้องแล้วลองใหม่';
      setScannerOn(false);setScanMessage({ok:false,title:message,detail});setToast(message);
      if(scannerRef.current){try{await scannerRef.current.stop();await scannerRef.current.clear()}catch{}scannerRef.current=null;}
    }
  }
  async function stopScanner(){if(scannerRef.current){try{await scannerRef.current.stop();await scannerRef.current.clear()}catch{}scannerRef.current=null;}setScannerOn(false);}
  async function setScanMode(){const nextMode=currentEvent.scan_mode==='CHECKIN'?'CHECKOUT':'CHECKIN';if(isSupabaseConfigured&&supabase&&/^[0-9a-f-]{36}$/i.test(activeEvent)){if(!sessionToken){setToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');return;}const {data,error}=await supabase.rpc('set_event_scan_mode',{p_session_token:sessionToken,p_event_id:activeEvent,p_scan_mode:nextMode});if(error||!data?.success){setToast(data?.message||error?.message||'เปลี่ยนโหมดสแกนไม่สำเร็จ');return;}}save({...store,events:store.events.map(e=>e.id===activeEvent?{...e,scan_mode:nextMode}:e)});setScanMessage({ok:true,title:`เปิดโหมด${nextMode==='CHECKIN'?'เช็กอิน':'เช็กเอาต์'}`,detail:'สแกน QR Code ถัดไปเพื่อดำเนินการ'});}
  async function addWalkin(ev:React.FormEvent<HTMLFormElement>){
    ev.preventDefault();const f=new FormData(ev.currentTarget),studyYear=Number(f.get('study_year'))||1,year=new Date().getFullYear()+543-studyYear+1;
    const studentId=String(f.get('student_id')).trim(),fullName=String(f.get('prefix'))+String(f.get('full_name')).trim(),faculty=String(f.get('faculty')||''),major=String(f.get('major')||''),classGroup=String(f.get('class_group')||''),birthDate=String(f.get('birth_date')||''),phone=String(f.get('phone')||'');
    if(!academicCatalog.some(item=>item.name===faculty&&item.majors.some(program=>program.name===major))){setToast('กรุณาเลือกคณะและสาขาจากรายการ');return;}
    const existing=store.users.find(u=>u.student_id===studentId);if(existing&&store.regs.some(r=>r.event_id===activeEvent&&r.user_id===existing.id)){setToast('นักศึกษามีรายชื่อในกิจกรรมนี้แล้ว');return;}
    if(isSupabaseConfigured&&supabase&&user&&/^[0-9a-f-]{36}$/i.test(activeEvent)){
      if(!sessionToken){setToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบสตาฟอีกครั้ง');return;}const {data,error}=await supabase.rpc('register_walkin_student',{p_event_id:activeEvent,p_session_token:sessionToken,p_student_id:studentId,p_full_name:fullName,p_faculty:faculty,p_major:major,p_class_group:classGroup,p_enrollment_year:year,p_birth_date:birthDate,p_phone:phone,p_study_year:studyYear});
      if(error||!data?.success){setToast(data?.message||error?.message||'เพิ่มรายชื่อไม่สำเร็จ');return;}
      if(sessionToken){const loaded=await supabase.rpc('load_workspace',{p_session_token:sessionToken});if(!loaded.error&&loaded.data?.success)setStore(workspaceStore(loaded.data));}
      setModal(null);setToast(data.passcode_assigned?`เพิ่มรายชื่อแล้ว · Passcode ${data.passcode_preview}`:'เพิ่มรายชื่อแล้ว · ใช้ QR Check-in');return;
    }

    const id=genId(),person:User={id,student_id:studentId,full_name:fullName,faculty,major,class_group:classGroup,enrollment_year:year,study_year:studyYear,role:'STUDENT'};
    const reserve=studyYear>1?store.codes.find(c=>c.event_id===activeEvent&&c.is_reserve&&!c.assigned_to):undefined;
    const passcode=reserve?.code,codes=reserve?store.codes.map(c=>c===reserve?{...c,assigned_to:id}:c):store.codes;save({...store,users:[...store.users,...(existing?[]:[person])],regs:[...store.regs,{event_id:activeEvent,user_id:existing?.id||id,status:'REGISTERED',passcode,is_walkin:true}],codes});setModal(null);setToast(passcode?`เพิ่มรายชื่อสำเร็จ · Passcode ${passcode}`:'เพิ่มรายชื่อสำเร็จ · รุ่นปี 1 ใช้ QR Check-in');
  }
  async function createEvent(ev:React.FormEvent<HTMLFormElement>){ev.preventDefault();const f=new FormData(ev.currentTarget);let event:Event={id:genId(),title:String(f.get('title')).trim(),location:String(f.get('location')).trim(),activity_hours:Number(f.get('hours')),status:'ACTIVE',redirect_url_year1:String(f.get('redirect')||''),scan_mode:'CHECKIN',banner_url:String(f.get('banner_url')||'').trim()};if(isSupabaseConfigured&&supabase&&user?.role==='ADMIN'){if(!sessionToken){setToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบแอดมินใหม่');return;}const {data,error}=await supabase.rpc('admin_create_event',{p_admin_token:sessionToken,p_title:event.title,p_location:event.location,p_activity_hours:event.activity_hours,p_redirect_url_year1:event.redirect_url_year1||null});if(error||!data?.success){setToast(data?.message||error?.message||'สร้างกิจกรรมไม่สำเร็จ');return;}event={...data.event as Event,banner_url:event.banner_url};if(event.banner_url){const saved=await supabase.rpc('admin_update_event_banner',{p_admin_token:sessionToken,p_event_id:event.id,p_banner_url:event.banner_url});if(saved.error||!saved.data?.success)setToast(saved.data?.message||saved.error?.message||'สร้างกิจกรรมแล้ว แต่บันทึกภาพแบนเนอร์ไม่สำเร็จ');}}save({...store,events:[event,...store.events]});setSelectedEvent(event.id);setActiveEvent(event.id);setModal(null);if(!event.banner_url)setToast('สร้างกิจกรรมใหม่แล้ว');}
  async function updateSelectedEvent(patch:Partial<Event>){
    const updated={...selected,...patch};
    const detailsChanged=patch.title!==undefined||patch.location!==undefined||patch.activity_hours!==undefined||patch.status!==undefined;
    if(detailsChanged&&isSupabaseConfigured&&supabase&&/^[0-9a-f-]{36}$/i.test(selected.id)){
      if(!sessionToken){setToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบแอดมินใหม่');return;}
      const {data,error}=await supabase.rpc('admin_update_event_details',{p_admin_token:sessionToken,p_event_id:selected.id,p_title:patch.title??null,p_location:patch.location??null,p_activity_hours:patch.activity_hours??null,p_status:patch.status??null});
      if(error||!data?.success){setToast(data?.message||error?.message||'บันทึกข้อมูลกิจกรรมไม่สำเร็จ');return;}
    }
    if(patch.redirect_url_year1!==undefined&&isSupabaseConfigured&&supabase&&/^[0-9a-f-]{36}$/i.test(selected.id)){
      if(!sessionToken){setToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบแอดมินใหม่');return;}
      const {data,error}=await supabase.rpc('admin_update_event_redirect',{p_admin_token:sessionToken,p_event_id:selected.id,p_redirect_url_year1:updated.redirect_url_year1||null});
      if(error||!data?.success){setToast(data?.message||error?.message||'บันทึก URL กิจกรรมไม่สำเร็จ');return;}
    }
    if(patch.banner_url!==undefined&&isSupabaseConfigured&&supabase&&/^[0-9a-f-]{36}$/i.test(selected.id)){
      if(!sessionToken){setToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบแอดมินใหม่');return;}
      const {data,error}=await supabase.rpc('admin_update_event_banner',{p_admin_token:sessionToken,p_event_id:selected.id,p_banner_url:updated.banner_url||null});
      if(error||!data?.success){setToast(data?.message||error?.message||'บันทึกภาพแบนเนอร์ไม่สำเร็จ');return;}
    }
    save({...store,events:store.events.map(e=>e.id===selected.id?updated:e)});
    if(patch.redirect_url_year1!==undefined)setToast('บันทึก URL สำหรับนักศึกษาปี 1 แล้ว');
    if(patch.banner_url!==undefined)setToast('บันทึกภาพแบนเนอร์แล้ว');
    if(detailsChanged)setToast('บันทึกข้อมูลกิจกรรมแล้ว');
  }
  async function deleteActivity(){if(!selected)return;if(store.events.length<=1){setToast('ต้องมีอย่างน้อยหนึ่งกิจกรรมในระบบ');return;}if(!window.confirm(`ยืนยันลบกิจกรรม “${selected.title}” และรายชื่อที่ผูกอยู่ทั้งหมดหรือไม่?`))return;if(isSupabaseConfigured&&supabase&&/^[0-9a-f-]{36}$/i.test(selectedEvent)){if(!sessionToken){setToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบแอดมินใหม่');return;}const {data,error}=await supabase.rpc('admin_delete_event',{p_admin_token:sessionToken,p_event_id:selectedEvent});if(error||!data?.success){setToast(data?.message||error?.message||'ลบกิจกรรมไม่สำเร็จ');return;}}const events=store.events.filter(e=>e.id!==selectedEvent),next=events[0];save({...store,events,regs:store.regs.filter(r=>r.event_id!==selectedEvent),codes:store.codes.filter(c=>c.event_id!==selectedEvent)});setSelectedEvent(next.id);setActiveEvent(next.id);setToast('ลบกิจกรรมแล้ว');}
  async function deleteRegistration(userId:string){
    if(user?.role!=='ADMIN'){setToast('รายการนี้สงวนสิทธิ์สำหรับแอดมิน');return;}
    const person=store.users.find(u=>u.id===userId);
    if(!window.confirm(`ลบ ${person?.full_name||'นักศึกษา'} ออกจากกิจกรรมนี้หรือไม่? บัญชีนักศึกษาจะยังอยู่ในระบบ`))return;
    if(isSupabaseConfigured&&supabase&&/^[0-9a-f-]{36}$/i.test(selectedEvent)){
      if(!sessionToken){setToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบแอดมินใหม่');return;}
      const {data,error}=await supabase.rpc('admin_delete_event_registration',{p_admin_token:sessionToken,p_event_id:selectedEvent,p_user_id:userId});
      if(error||!data?.success){setToast(data?.message||error?.message||'ลบรายชื่อไม่สำเร็จ');return;}
      const loaded=await supabase.rpc('load_workspace',{p_session_token:sessionToken});
      if(!loaded.error&&loaded.data?.success)setStore(workspaceStore(loaded.data));
    }else{
      const reg=store.regs.find(row=>row.event_id===selectedEvent&&row.user_id===userId);
      save({...store,regs:store.regs.filter(row=>!(row.event_id===selectedEvent&&row.user_id===userId)),codes:store.codes.map(code=>reg?.passcode===code.code&&code.event_id===selectedEvent&&code.is_reserve?{...code,assigned_to:undefined}:code)});
    }
    setToast('นำรายชื่อนักศึกษาออกจากกิจกรรมแล้ว');
  }
  async function addCodes(ev:React.FormEvent<HTMLFormElement>){ev.preventDefault();const f=new FormData(ev.currentTarget),codes=String(f.get('codes')).split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean);const existing=new Set(store.codes.filter(c=>c.event_id===selectedEvent).map(c=>c.code));const fresh=[...new Set(codes)].filter(code=>!existing.has(code)).map(code=>({event_id:selectedEvent,code,is_reserve:true}));if(isSupabaseConfigured&&supabase&&user?.role==='ADMIN'&&/^[0-9a-f-]{36}$/i.test(selectedEvent)){if(!sessionToken){setToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบแอดมินใหม่');return;}const {data,error}=await supabase.rpc('admin_add_reserve_passcodes',{p_admin_token:sessionToken,p_event_id:selectedEvent,p_codes:codes});if(error||!data?.success){setToast(data?.message||error?.message||'เติม Passcode ไม่สำเร็จ');return;}const loaded=await supabase.rpc('load_workspace',{p_session_token:sessionToken});if(!loaded.error&&loaded.data?.success)setStore(workspaceStore(loaded.data));setModal(null);setToast(`เพิ่ม Passcode ${data.added_count||0} รหัส · จับคู่แล้ว ${data.matched_count||0} คน`);return;}save({...store,codes:[...store.codes,...fresh]});setModal(null);setToast(`เพิ่ม Passcode สำรอง ${fresh.length} รายการแล้ว`);}
  async function createStaffAccount(ev:React.FormEvent<HTMLFormElement>){ev.preventDefault();if(!user||user.role!=='ADMIN'){setToast('รายการนี้สงวนสิทธิ์สำหรับแอดมิน');return;}const form=new FormData(ev.currentTarget),username=String(form.get('username')).trim(),password=String(form.get('password')),fullName=String(form.get('full_name')).trim(),role=String(form.get('role')) as 'STAFF'|'ADMIN',faculty=String(form.get('faculty')||''),major=String(form.get('major')||'');if(username.length<3||password.length<8||fullName.length<2){setToast('กรุณาตรวจข้อมูลและใช้รหัสผ่านอย่างน้อย 8 ตัวอักษร');return;}if(store.users.some(u=>u.student_id===username)){setToast('ชื่อผู้ใช้นี้มีในระบบแล้ว');return;}let createdId=genId();if(isSupabaseConfigured&&supabase){if(!sessionToken){setToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบแอดมินใหม่');return;}const {data,error}=await supabase.rpc('admin_create_user',{p_admin_token:sessionToken,p_username:username,p_password:password,p_full_name:fullName,p_role:role,p_faculty:faculty||null,p_major:major||null});if(error||!data?.success){setToast(data?.message||error?.message||'สร้างบัญชีไม่สำเร็จ');return;}createdId=String(data.user?.id||createdId);}const newUser:User={id:createdId,student_id:username,full_name:fullName,faculty:faculty||'องค์การนักศึกษา',major:major||roleName(role),class_group:role,enrollment_year:0,study_year:0,role};save({...store,users:[...store.users,newUser]});setModal(null);setToast(`เพิ่มบัญชี${role==='ADMIN'?'แอดมิน':'สตาฟ'}สำเร็จ`);}
  async function updateManagedUser(ev:React.FormEvent<HTMLFormElement>,target:User){ev.preventDefault();if(user?.role!=='ADMIN'){setToast('รายการนี้สงวนสิทธิ์สำหรับแอดมิน');return;}const form=new FormData(ev.currentTarget),studentId=String(form.get('student_id')||'').trim(),fullName=String(form.get('full_name')||'').trim(),faculty=String(form.get('faculty')||'').trim(),major=String(form.get('major')||'').trim(),classGroup=String(form.get('class_group')||'').trim(),studyYear=target.role==='STUDENT'?Number(form.get('study_year')):target.study_year,birthDate=String(form.get('birth_date')||'').trim(),phone=String(form.get('phone')||'').trim(),password=String(form.get('new_password')||'');if(studentId.length<3||fullName.length<2||(target.role==='STUDENT'&&(!Number.isInteger(studyYear)||studyYear<1||studyYear>8))||(password&&password.length<8)||(birthDate&&!/^[0-9]{8}$/.test(birthDate))){setToast('ตรวจสอบชื่อผู้ใช้ ชื่อ-นามสกุล ชั้นปี และรหัสผ่านอีกครั้ง');return;}if(store.users.some(existing=>existing.id!==target.id&&existing.student_id===studentId)){setToast('ชื่อผู้ใช้นี้มีในระบบแล้ว');return;}if(isSupabaseConfigured&&supabase){if(!sessionToken||!/^[0-9a-f-]{36}$/i.test(target.id)){setToast('ไม่พบเซสชันหรือบัญชีจากฐานข้อมูล กรุณาเข้าสู่ระบบใหม่');return;}const {data,error}=await supabase.rpc('admin_update_user',{p_admin_token:sessionToken,p_user_id:target.id,p_student_id:studentId,p_full_name:fullName,p_faculty:faculty||null,p_major:major||null,p_class_group:classGroup||null,p_study_year:studyYear??null,p_birth_date:birthDate||null,p_phone:phone||null,p_new_password:password||null});if(error||!data?.success){setToast(error?.code==='PGRST202'?'ฐานข้อมูลยังไม่พร้อมบันทึกผู้ใช้ กรุณารัน migration 019 ใน Supabase แล้วกดบันทึกอีกครั้ง':data?.message||error?.message||'บันทึกข้อมูลผู้ใช้ไม่สำเร็จ');return;}await refreshWorkspace();}else{const updated={...target,student_id:studentId,full_name:fullName,faculty,major,class_group:classGroup,study_year:studyYear,birth_date:birthDate||target.birth_date,phone};save({...store,users:store.users.map(existing=>existing.id===target.id?updated:existing)});}setModal(null);setEditingUser(null);setToast(password&&!(isSupabaseConfigured&&supabase)?'บันทึกข้อมูลตัวอย่างแล้ว (โหมดตัวอย่างไม่มีระบบบัญชีจริง)':password?'บันทึกข้อมูลและตั้งรหัสผ่านใหม่แล้ว':'บันทึกข้อมูลผู้ใช้แล้ว');}
  async function deleteManagedUser(target:User){
    if(user?.role!=='ADMIN'||!['STUDENT','STAFF'].includes(target.role)){setToast('ลบบัญชีได้เฉพาะนักศึกษาหรือสตาฟ');return;}
    if(target.role==='STUDENT' && store.regs.some(r=>r.user_id===target.id && r.status==='ATTENDING')){
      setToast('ต้องเช็กเอาต์ก่อนจึงจะลบบัญชีนักศึกษาได้');return;
    }
    const impact=target.role==='STUDENT'?'การลงทะเบียนและประวัติเข้าร่วมกิจกรรมของบัญชีนี้จะถูกลบด้วย':'ชื่อของสตาฟอาจหายจากรายงานการสแกน';
    if(!window.confirm(`ยืนยันลบบัญชี ${target.full_name} (${target.student_id})?\n\n${impact}`))return;
    if(isSupabaseConfigured&&supabase){
      if(!sessionToken||!/^[0-9a-f-]{36}$/i.test(target.id)){setToast('ไม่พบเซสชันหรือบัญชีจากฐานข้อมูล กรุณาเข้าสู่ระบบใหม่');return;}
      const {data,error}=await supabase.rpc('admin_delete_user',{p_admin_token:sessionToken,p_user_id:target.id});
      if(error||!data?.success){setToast(data?.message||error?.message||'ลบบัญชีไม่สำเร็จ');return;}
      await refreshWorkspace();
    }else{
      save({...store,users:store.users.filter(account=>account.id!==target.id),regs:store.regs.filter(reg=>reg.user_id!==target.id),codes:store.codes.map(code=>code.assigned_to===target.id?{...code,assigned_to:undefined}:code)});
    }
    setToast(`ลบบัญชี ${target.full_name} แล้ว`);
  }
  async function deleteBatch(kind:'students'|'codes',values:string[]) {
    if (user?.role!=='ADMIN' || !values.length) return false;
    const codes=kind==='codes';
    const detail=codes ? `ลบ Passcode ที่ว่าง ${values.length} รหัสจากกิจกรรม “${selected.title}”?`
      : `ลบบัญชีนักศึกษา ${values.length} คนถาวร? การลงทะเบียนและประวัติการเข้าร่วมทุกกิจกรรมของนักศึกษาที่เลือกจะถูกลบด้วย`;
    if (!window.confirm(detail)) return false;
    const ids=new Set(values);
    if (isSupabaseConfigured && supabase) {
      const {data,error}=codes
        ? await supabase.rpc('admin_delete_passcodes',{p_admin_token:sessionToken,p_event_id:selectedEvent,p_codes:values})
        : await supabase.rpc('admin_delete_students',{p_admin_token:sessionToken,p_user_ids:values});
      if (error || !data?.success) {
        setToast(error?.code==='PGRST202'?'ฐานข้อมูลยังไม่พร้อม กรุณารัน migration 020':data?.message||error?.message||'ลบรายการไม่สำเร็จ');
        await refreshWorkspace();
        return false;
      }
      await refreshWorkspace();
    } else if (codes) {
      const available=store.codes.filter(c=>c.event_id===selectedEvent && ids.has(c.code) && !c.assigned_to);
      if (available.length!==ids.size || store.regs.some(r=>r.event_id===selectedEvent && r.passcode && ids.has(r.passcode))) {
        setToast('รหัสถูกจับคู่หรือรายการเปลี่ยนไป');return false;
      }
      save({...store,codes:store.codes.filter(c=>c.event_id!==selectedEvent || !ids.has(c.code))});
    } else {
      if (store.users.filter(u=>ids.has(u.id) && u.role==='STUDENT').length!==ids.size ||
        store.regs.some(r=>ids.has(r.user_id) && r.status==='ATTENDING')) {setToast('มีบัญชีที่ยังลบไม่ได้');return false;}
      save({...store,users:store.users.filter(u=>!ids.has(u.id)),regs:store.regs.filter(r=>!ids.has(r.user_id)),
        codes:store.codes.map(c=>c.assigned_to && ids.has(c.assigned_to)?{...c,assigned_to:undefined}:c)});
    }
    setToast(`ลบ${codes?' Passcode':'บัญชีนักศึกษา'} ${ids.size} รายการแล้ว`);
    return true;
  }
  async function manageAcademicCatalog(action:CatalogAction,facultyId:string,facultyName:string,majorId:string,majorName:string){
    if(user?.role!=='ADMIN'){setToast('จัดการคณะและสาขาได้เฉพาะแอดมิน');return;}
    const faculty=academicCatalog.find(item=>item.id===facultyId);
    const major=faculty?.majors.find(item=>item.id===majorId);
    if(isSupabaseConfigured&&supabase){
      if(!sessionToken){setToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบแอดมินใหม่');return;}
      const {data,error}=await supabase.rpc('admin_manage_academic_catalog',{p_admin_token:sessionToken,p_action:action,p_faculty_id:facultyId||null,p_faculty_name:facultyName||null,p_major_id:majorId||null,p_major_name:majorName||null});
      if(error||!data?.success){setToast(data?.message||error?.message||'บันทึกรายการคณะและสาขาไม่สำเร็จ');return;}
      await refreshWorkspace();
    }else{
      if(action==='ADD_FACULTY')setAcademicCatalog(old=>[...old,{id:genId(),name:facultyName,majors:[]}]);
      else if(action==='UPDATE_FACULTY'&&faculty){setAcademicCatalog(old=>old.map(item=>item.id===facultyId?{...item,name:facultyName}:item));save({...store,users:store.users.map(person=>person.faculty===faculty.name?{...person,faculty:facultyName}:person)});}
      else if(action==='DELETE_FACULTY'&&faculty){if(store.users.some(person=>person.faculty===faculty.name)){setToast('ยังลบคณะนี้ไม่ได้ มีผู้ใช้สังกัดอยู่');return;}setAcademicCatalog(old=>old.filter(item=>item.id!==facultyId));}
      else if(action==='ADD_MAJOR'&&faculty)setAcademicCatalog(old=>old.map(item=>item.id===facultyId?{...item,majors:[...item.majors,{id:genId(),name:majorName}]}:item));
      else if(action==='UPDATE_MAJOR'&&faculty&&major){setAcademicCatalog(old=>old.map(item=>item.id===facultyId?{...item,majors:item.majors.map(program=>program.id===majorId?{...program,name:majorName}:program)}:item));save({...store,users:store.users.map(person=>person.faculty===faculty.name&&person.major===major.name?{...person,major:majorName}:person)});}
      else if(action==='DELETE_MAJOR'&&faculty&&major){if(store.users.some(person=>person.faculty===faculty.name&&person.major===major.name)){setToast('ยังลบสาขานี้ไม่ได้ มีผู้ใช้เลือกสาขานี้อยู่');return;}setAcademicCatalog(old=>old.map(item=>item.id===facultyId?{...item,majors:item.majors.filter(program=>program.id!==majorId)}:item));}
    }
    setToast('อัปเดตรายการคณะและสาขาแล้ว');
  }
  async function importCsv(roster=false){
    setImportError('');
    if(!csvFile)return;
    if(roster && !isSupabaseConfigured){setToast('กรุณาเชื่อมต่อฐานข้อมูลก่อนสร้างบัญชีนักศึกษา');return;}
    let fileRows:string[][];
    try{fileRows=await readStudentFile(csvFile);}catch(error){setToast(error instanceof Error?error.message:'อ่านไฟล์ไม่สำเร็จ');return;}
    if(fileRows.length<2){setToast('ไฟล์ต้องมีหัวตารางและข้อมูลนักศึกษาอย่างน้อย 1 แถว');return;}
    const headers=fileRows[0].map(csvHeaderKey);
    const headerAliases:Record<string,string[]>={
      student_id:['student_id','รหัสนักศึกษา','รหัสประจำตัวนักศึกษา'],
      full_name:['full_name','ชื่อ-นามสกุล','ชื่อสกุล','ชื่อและนามสกุล'],
      prefix:['คำนำหน้าไทย'],first_name:['ชื่อไทย'],last_name:['นามสกุลไทย'],enrollment_year:['รุ่น','enrollment_year'],
      faculty:['faculty','คณะ'],
      major:['major','สาขา','สาขาวิชา'],
      class_group:['class_group','หมู่เรียน','กลุ่มเรียน','หมู่'],
      study_year:['study_year','ชั้นปี','ชั้นปีปัจจุบัน','ชั้นปีที่กำลังศึกษา','ระดับชั้นปี','ระดับชั้นปีปัจจุบัน','ปีที่กำลังศึกษา'],
      birth_date:['birth_date','วันเกิด','วันเดือนปีเกิด'],
      phone:['phone','เบอร์โทร','เบอร์โทรศัพท์','โทรศัพท์','โทรศัพท์มือถือ'],
    };
    const indexes=Object.fromEntries(Object.entries(headerAliases).map(([key,aliases])=>[key,headers.findIndex(header=>aliases.some(alias=>csvHeaderKey(alias)===header))])) as Record<string,number>;
    const missing=['student_id','faculty','major','class_group','birth_date'].filter(key=>indexes[key]<0);
    if(indexes.full_name<0 && (indexes.first_name<0 || indexes.last_name<0))missing.push('ชื่อไทย / นามสกุลไทย หรือชื่อ-นามสกุล');
    if(indexes.study_year<0)missing.push('study_year / ชั้นปีที่กำลังศึกษา');
    if(missing.length){setToast(`ไม่พบหัวตาราง: ${missing.join(', ')} · รองรับชื่อคอลัมน์ภาษาไทยหรืออังกฤษ`);return;}
    const readField=(row:string[],key:string)=>indexes[key]>=0?(row[indexes[key]]||'').trim():'';
    const currentBuddhistYear=new Date().getFullYear()+543;
    const students=fileRows.slice(1).map((row,index)=>{
      const student_id=westernDigits(readField(row,'student_id'));
      const full_name=readField(row,'full_name') || readField(row,'prefix')+readField(row,'first_name')+' '+readField(row,'last_name');
      const faculty=readField(row,'faculty');
      const major=readField(row,'major');
      const class_group=readField(row,'class_group');
      const rawStudyYear=westernDigits(readField(row,'study_year')).replace(/\D/g,'');
      const suppliedStudyYear=Number(rawStudyYear)||0;
      const study_year=suppliedStudyYear;
      const enrollment_year=Number(westernDigits(readField(row,'enrollment_year'))) || (study_year>0?currentBuddhistYear-study_year+1:0);
      const birthParts=westernDigits(readField(row,'birth_date')).split('/');
      const birth_date=birthParts.length===3?birthParts[0].padStart(2,'0')+birthParts[1].padStart(2,'0')+birthParts[2]:westernDigits(readField(row,'birth_date')).replace(/\D/g,'');
      const phone=westernDigits(readField(row,'phone'));
      if(!student_id||!full_name||!birthDateToInput(birth_date)||study_year<1||study_year>8){
        setToast(`ข้อมูลแถวที่ ${index+2} ไม่ครบหรือไม่ถูกต้อง · ตรวจรหัส ชื่อ ชั้นปี และวันเกิด 8 หลัก`);
        return null;
      }
      return {student_id,full_name,faculty,major,class_group,enrollment_year,study_year,birth_date,phone};
    }).filter((student):student is NonNullable<typeof student>=>student!==null);
    if(students.length!==fileRows.length-1)return;
    if(isSupabaseConfigured&&supabase&&user?.role==='ADMIN'){
      if(!sessionToken){setToast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบแอดมินใหม่');return;}
      if(roster){
        isImportingRef.current=true;
        try{
          const result=await importRosterInBatches(students,
            batch=>supabase!.rpc('admin_import_student_roster',{p_admin_token:sessionToken,p_students:batch}),
            (processed,total)=>setLoadingMessage(`นำเข้ารายชื่อ ${processed.toLocaleString()} / ${total.toLocaleString()} แถว`));
          await refreshWorkspace();
          if(result.error){
            setImportError(`ยืนยันผลแล้ว ${result.processed} / ${students.length} แถว · สร้างบัญชี ${result.imported} คน · ข้าม ${result.skipped} คน · ${result.error} · กดนำเข้าไฟล์เดิมอีกครั้งเพื่อทำต่อ ระบบจะข้ามบัญชีที่สร้างสำเร็จแล้ว`);
            setToast('นำเข้ายังไม่ครบ กรุณาดูรายละเอียดใต้ส่วนเลือกไฟล์');
          }else{
            setCsvFile(null);
            setToast(`สร้างบัญชีใหม่ ${result.imported} คน · ข้ามบัญชีเดิมที่มีอยู่แล้ว ${result.skipped} คน (รวม ${students.length} คน)`);
          }
        }finally{
          isImportingRef.current=false;
        }
        return;
      }
      const {data,error}=await supabase.rpc('admin_import_event_students',{p_admin_token:sessionToken,p_event_id:selectedEvent,p_students:students});
      if(error||!data?.success){
        const message=error
          ? [error.code,error.message,error.details,error.hint].filter(Boolean).join(' · ')
          : data?.message||'นำเข้ารายชื่อไม่สำเร็จ';
        setImportError(message);setToast('นำเข้าไม่สำเร็จ กรุณาดูรายละเอียดใต้ส่วนเลือกไฟล์');return;
      }
      const loaded=await supabase.rpc('load_workspace',{p_session_token:sessionToken});
      if(!loaded.error&&loaded.data?.success)setStore(workspaceStore(loaded.data));
      setCsvFile(null);
      setToast(roster?`สร้างบัญชี ${data.imported_count||0} คน · ข้ามบัญชีที่มีอยู่ ${data.skipped_count||0} คน`:`นำเข้า ${data.imported_count||0} คน · ข้าม ${data.skipped_count||0} คน · จับคู่ Passcode อัตโนมัติ ${data.passcodes_assigned_count||0} รายการ`);
      return;
    }
    let imported=0,skipped=0;const people=[...store.users],regs=[...store.regs],codes=[...store.codes];
    for(const student of students){
      const existing=people.find(person=>person.student_id===student.student_id);
      if(existing&&regs.some(reg=>reg.event_id===selectedEvent&&reg.user_id===existing.id)){skipped++;continue;}
      const enrollmentYear=student.enrollment_year,studyYear=student.study_year,id=existing?.id||genId();
      const person:User={id,student_id:student.student_id,full_name:student.full_name,faculty:student.faculty,major:student.major,class_group:student.class_group,enrollment_year:enrollmentYear,study_year:studyYear,role:'STUDENT'};
      let passcode:string|undefined;
      if(studyYear>1){
        const reserve=codes.find(code=>code.event_id===selectedEvent&&code.is_reserve&&!code.assigned_to);
        if(reserve){passcode=reserve.code;reserve.assigned_to=id;}
      }
      if(existing){people[people.findIndex(item=>item.id===existing.id)]=person;}else people.push(person);
      regs.push({event_id:selectedEvent,user_id:id,status:'REGISTERED',passcode});
      imported++;
    }
    save({...store,users:people,regs,codes});setCsvFile(null);
    setToast(`นำเข้า ${imported} คน · ข้าม ${skipped} คน · จับคู่ Passcode อัตโนมัติแล้ว`);
  }

  return <main className="canvas-grid min-h-screen px-3 pb-8 pt-3 sm:px-6 sm:pt-5 lg:px-10">
    <header className="glass sticky top-3 z-50 mx-auto flex max-w-[1440px] items-center justify-between rounded-full border border-white/80 px-4 py-2.5 shadow-[0_12px_45px_rgba(52,61,78,.07)] sm:px-6">
      <button className="flex items-center gap-3 text-left transition hover:opacity-90" onClick={()=>setView(user?.role==='ADMIN'?'admin':user?.role==='STAFF'?'scanner':'home')}>
        <div className="relative">
          <img src="/aru-icon.jpg" alt="ARU Student Organization" className="h-11 w-11 rounded-xl border-2 border-[#d4af37] object-cover shadow-sm"/>
          <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#7c0a02] text-[7px] font-black text-amber-300">A</span>
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <b className="text-[15px] tracking-tight text-slate-900 sm:text-[17px]">ARU Event Pass</b>
            {user && <span className="hidden sm:inline-block"><RoleBadge role={user.role} size="sm"/></span>}
          </div>
          <small className="hidden text-[10px] font-medium text-slate-500 sm:block">องค์การนักศึกษา มหาวิทยาลัยราชภัฏพระนครศรีอยุธยา</small>
        </div>
      </button>

      {/* Desktop Navigation Tabs with clear category themes */}
      <nav className="hidden items-center gap-1.5 rounded-full bg-slate-100/90 p-1.5 xl:flex shadow-inner">
        {user && (
          <>
            {user.role === 'STUDENT' && (
              <>
                <NavButton active={view==='home'} icon={<LayoutDashboard size={15}/>} theme="rose" onClick={()=>setView('home')}>
                  กิจกรรมของฉัน
                </NavButton>
                <NavButton active={view==='studentStats'} icon={<Gauge size={15}/>} theme="emerald" onClick={()=>setView('studentStats')}>
                  สรุปของฉัน
                </NavButton>
              </>
            )}
            {user.role !== 'STUDENT' && (
              <NavButton active={view==='scanner'} icon={<ScanLine size={15}/>} theme="amber" onClick={()=>setView('scanner')}>
                เครื่องสแกน QR
              </NavButton>
            )}
            {user.role === 'ADMIN' && (
              <NavButton active={view==='admin'} icon={<Settings2 size={15}/>} theme="slate" onClick={()=>setView('admin')}>
                จัดการระบบ
              </NavButton>
            )}
          </>
        )}
      </nav>

      {/* Right controls: Cloud status + User Profile Pill + Logout */}
      <div className="flex items-center gap-2 sm:gap-3">
        <span className={cx(
          'hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-extrabold sm:flex shadow-sm',
          isSupabaseConfigured
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-amber-200 bg-amber-50 text-amber-800'
        )}>
          <i className={cx('h-1.5 w-1.5 rounded-full', isSupabaseConfigured ? 'animate-pulse bg-emerald-500' : 'bg-amber-500')}/>
          {isSupabaseConfigured ? 'CLOUD CONNECTED' : 'DEMO MODE'}
        </span>

        {user ? (
          <>
            {/* User Pill */}
            <div className="flex items-center gap-2 rounded-full border border-slate-200/90 bg-white/90 py-1 pl-1 pr-3 shadow-sm">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#941108] to-[#5a0601] text-[11px] font-extrabold text-amber-200 shadow-inner">
                {initials(user.full_name)}
              </span>
              <div className="hidden text-left sm:block">
                <b className="block max-w-[130px] truncate text-[11px] font-bold leading-4 text-slate-900">{user.full_name}</b>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-[9px] font-semibold text-slate-400">{user.student_id}</span>
                </div>
              </div>
            </div>

            {/* Mobile menu trigger */}
            <button
              onClick={()=>setMobileNav(!mobileNav)}
              aria-label="เปิดเมนู"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 xl:hidden"
            >
              {mobileNav ? <X size={17}/> : <Menu size={17}/>}
            </button>

            {/* Logout button */}
            <button
              onClick={()=>void withLoading('กำลังออกจากระบบ…',logout)}
              title="ออกจากระบบ"
              aria-label="ออกจากระบบ"
              className="hidden sm:flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-3 py-2 text-[11px] font-bold text-slate-600 shadow-sm transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
            >
              <LogOut size={14}/>
              <span>ออกจากระบบ</span>
            </button>
          </>
        ) : (
          <button
            className="rounded-full bg-gradient-to-r from-[#7c0a02] to-[#a31508] px-5 py-2 text-xs font-bold text-white shadow-md shadow-rose-900/20 transition hover:shadow-lg hover:shadow-rose-900/30"
            onClick={()=>document.getElementById('login-card')?.scrollIntoView({behavior:'smooth'})}
          >
            เข้าสู่ระบบ
          </button>
        )}
      </div>
    </header>

    {/* Mobile Navigation Drawer */}
    {user && mobileNav && (
      <div className="glass mx-auto mt-2 max-w-[1440px] rounded-3xl border border-white/80 p-4 shadow-xl xl:hidden">
        <div className="flex items-center justify-between border-b border-slate-200/60 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#7c0a02] font-bold text-white shadow-sm">
              {initials(user.full_name)}
            </span>
            <div>
              <b className="block text-xs font-bold text-slate-900">{user.full_name}</b>
              <div className="mt-0.5 flex items-center gap-1.5">
                <RoleBadge role={user.role} size="sm" />
                <span className="font-mono text-[10px] text-slate-500">{user.student_id}</span>
              </div>
            </div>
          </div>
          <button onClick={() => setMobileNav(false)} className="rounded-full bg-slate-100 p-2 text-slate-500 hover:bg-slate-200">
            <X size={16} />
          </button>
        </div>
        
        <div className="mt-3 grid gap-2">
          {user.role === 'STUDENT' && (
            <>
              <NavButton active={view==='home'} icon={<LayoutDashboard size={16}/>} theme="rose" onClick={()=>{setView('home');setMobileNav(false);}}>
                กิจกรรมของฉัน
              </NavButton>
              <NavButton active={view==='studentStats'} icon={<Gauge size={16}/>} theme="emerald" onClick={()=>{setView('studentStats');setMobileNav(false);}}>
                สรุปข้อมูลของฉัน
              </NavButton>
            </>
          )}
          {user.role !== 'STUDENT' && (
            <NavButton active={view==='scanner'} icon={<ScanLine size={16}/>} theme="amber" onClick={()=>{setView('scanner');setMobileNav(false);}}>
              เครื่องสแกน QR ความเร็วสูง
            </NavButton>
          )}
          {user.role === 'ADMIN' && (
            <NavButton active={view==='admin'} icon={<Settings2 size={16}/>} theme="slate" onClick={()=>{setView('admin');setMobileNav(false);}}>
              จัดการระบบ (Admin Console)
            </NavButton>
          )}
        </div>

        <div className="mt-4 border-t border-slate-200/60 pt-3">
          <button
            onClick={() => { setMobileNav(false); void withLoading('กำลังออกจากระบบ…', logout); }}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/80 py-3 text-xs font-bold text-rose-700 hover:bg-rose-100"
          >
            <LogOut size={16} />
            ออกจากระบบ
          </button>
        </div>
      </div>
    )}

    <div key={view} className="page-transition mx-auto mt-6 max-w-[1440px]">
      {!user?<Landing loginError={loginError} enterAs={()=>void withLoading('กำลังตรวจสอบบัญชีผู้ใช้…',enterAs)} saving={saving||Boolean(loadingMessage)}/>:view==='scanner'&&user.role!=='STUDENT'?<ScannerView user={user} event={currentEvent} events={store.events} activeEvent={activeEvent} setActiveEvent={setActiveEvent} scannerOn={scannerOn} scannerLocked={scannerLocked} toggleScannerLock={()=>setScannerLocked(value=>!value)} startScanner={()=>void withLoading('กำลังเปิดกล้อง…',startScanner)} stopScanner={()=>void withLoading('กำลังปิดกล้อง…',stopScanner)} scanMode={()=>void withLoading('กำลังเปลี่ยนโหมดสแกน…',setScanMode)} scanInput={scanInput} setScanInput={setScanInput} scanPayload={async(raw:string)=>{await withLoading('กำลังตรวจสอบ QR…',()=>scanPayload(raw));}} scanMessage={scanMessage} flash={flash} attendance={attendance} registered={registered} reserveLeft={reserveLeft} openWalkin={()=>setModal('walkin')}/>:view==='admin'&&user.role==='ADMIN'?<AdminView isImportingRef={isImportingRef} deleteBatch={(kind,values)=>withLoading('กำลังลบรายการ…',()=>deleteBatch(kind,values))} sessionToken={sessionToken} store={store} academicCatalog={academicCatalog} manageAcademicCatalog={(...args)=>withLoading('กำลังบันทึกคณะและสาขา…',()=>manageAcademicCatalog(...args))} selectedEvent={selected} selectedEventId={selectedEvent} setSelectedEvent={setSelectedEvent} openCreate={()=>setModal('event')} openCodes={()=>setModal('codes')} openStaff={()=>setModal('staff')} editUser={(target:User)=>{setEditingUser(target);setEditingFaculty(target.faculty);setEditingMajor(target.major);setModal('editUser')}} deleteUser={(target:User)=>void withLoading('กำลังลบบัญชีผู้ใช้…',()=>deleteManagedUser(target))} deleteActivity={()=>void withLoading('กำลังลบกิจกรรม…',deleteActivity)} deleteRegistration={(id:string)=>void withLoading('กำลังนำรายชื่อออก…',()=>deleteRegistration(id))} importError={importError} csvFile={csvFile} setCsvFile={setCsvFile} importCsv={roster=>void withLoading('กำลังนำเข้ารายชื่อ…',()=>importCsv(roster))} refreshWorkspace={refreshWorkspace} loadEventDashboard={loadEventDashboard} updateEvent={(patch:Partial<Event>)=>withLoading('กำลังบันทึกการเปลี่ยนแปลง…',()=>updateSelectedEvent(patch))} />:view==='studentStats'&&user.role==='STUDENT'?<StudentStatsView user={user} events={store.events.filter(e=>studentRegs.some(r=>r.event_id===e.id))} regs={studentRegs}/>:view==='event'&&user.role==='STUDENT'?<EventDetail session={sessionToken} event={store.events.find(e=>e.id===activeEvent)||currentEvent} user={user} registration={studentRegs.find(r=>r.event_id===activeEvent)} back={()=>setView('home')}/>:<StudentHome session={sessionToken} refresh={refreshWorkspace} user={user} events={store.events.filter(e=>e.status==='ACTIVE'&&studentRegs.some(r=>r.event_id===e.id))} regs={studentRegs} select={(id:string)=>{setActiveEvent(id);setView('event')}} store={store}/>}
    </div>
    {user&&<div className="mx-auto mt-10 flex max-w-[1440px] items-center justify-between border-t border-slate-200/70 px-2 py-4 text-[10px] text-slate-500"><span>© 2026 ARU Student Organization · ระบบลงทะเบียนกิจกรรม</span><span className="hidden items-center gap-1 sm:flex"><ShieldCheck size={12}/>ข้อมูลกิจกรรมอัปเดตแบบเรียลไทม์</span></div>}
    {modal==='walkin'&&<Modal submitLabel="บันทึกรายชื่อหน้างาน" title="ลงทะเบียนหน้างาน" subtitle="เพิ่มนักศึกษาและผูกสิทธิ์กิจกรรม" close={()=>setModal(null)}><form id="staff-admin-form" onSubmit={e=>void withLoading('กำลังบันทึกรายชื่อ…',()=>addWalkin(e))} className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><Field label="รหัสนักศึกษา" name="student_id" required placeholder="เช่น 69123456"/><label className="text-sm">คำนำหน้า<select name="prefix" required defaultValue="" className="mt-1 block h-11 w-full rounded-xl border px-3"><option value="">เลือกคำนำหน้า</option><option>นาย</option><option>นางสาว</option></select></label><Field label="ชื่อ–นามสกุล" name="full_name" required placeholder="ชื่อ นามสกุล"/><label className="block text-[11px] font-semibold text-slate-600">คณะ<select name="faculty" value={walkinFaculty} required onChange={e=>{setWalkinFaculty(e.target.value);setWalkinMajor('')}} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-normal text-slate-800"><option value="">เลือกคณะ</option>{academicCatalog.map(faculty=><option key={faculty.id} value={faculty.name}>{faculty.name}</option>)}</select></label><label className="block text-[11px] font-semibold text-slate-600">สาขาวิชา<select name="major" value={walkinMajor} required disabled={!walkinFaculty} onChange={e=>setWalkinMajor(e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-normal text-slate-800 disabled:opacity-50"><option value="">เลือกสาขา</option>{(academicCatalog.find(faculty=>faculty.name===walkinFaculty)?.majors||[]).map(major=><option key={major.id} value={major.name}>{major.name}</option>)}</select></label><label className="block text-[11px] font-semibold text-slate-600">ชั้นปีที่กำลังศึกษา<select name="study_year" value={walkinStudyYear} onChange={e=>setWalkinStudyYear(Number(e.target.value))} required className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-normal text-slate-800">{Array.from({length:8},(_,i)=>i+1).map(year=><option key={year} value={year}>ปี {year}</option>)}</select></label><label className="text-sm">หมู่เรียน<select name="class_group" required defaultValue="" className="mt-1 block h-11 w-full rounded-xl border px-3"><option value="">เลือกหมู่เรียน</option>{[1,2,3,4].map(n=><option key={n}>{n}</option>)}</select></label><BirthDateField/><Field label="เบอร์โทรศัพท์" name="phone" placeholder="08X-XXX-XXXX"/></div><div className={cx('flex items-center justify-between rounded-2xl px-4 py-3 text-xs',reserveLeft?'bg-amber-50 text-amber-900':'bg-rose-50 text-rose-700')}><span className="flex items-center gap-2"><Ticket size={15}/>Passcode สำรองคงเหลือ</span><b>{reserveLeft} รหัส</b></div><p className="text-center text-[10px] leading-5 text-slate-400">นักศึกษาชั้นปี 2 ขึ้นไปจะได้รับ Passcode หลังเช็กเอาต์ · ปี 1 ใช้ QR Check-in/Check-out</p></form></Modal>}
    {modal==='event'&&<Modal submitLabel="สร้างกิจกรรม" title="สร้างกิจกรรมใหม่" subtitle="ตั้งค่ากิจกรรมสำหรับการลงทะเบียน" close={()=>setModal(null)}><form id="staff-admin-form" onSubmit={e=>void withLoading('กำลังสร้างกิจกรรม…',()=>createEvent(e))} className="space-y-3"><Field label="ชื่อกิจกรรม" name="title" required placeholder="เช่น ปฐมนิเทศนักศึกษาใหม่"/><Field label="สถานที่จัดกิจกรรม" name="location" required placeholder="หอประชุมมหาวิทยาลัย"/><Field label="URL สำหรับนักศึกษาปี 1 หลังเช็กอิน" name="redirect" type="url" placeholder="https://..."/><Field label="URL ภาพแบนเนอร์กิจกรรม" name="banner_url" type="url" placeholder="https://..."/><p className="-mt-1 text-[9px] leading-4 text-slate-400">วางลิงก์รูปภาพโดยตรง ระบบจะแสดงภาพจาง ๆ เป็นพื้นหลังของกิจกรรม</p><Field label="ชั่วโมงกิจกรรม" name="hours" type="number" min="1" defaultValue="4"/></form></Modal>}
    {modal==='codes'&&<Modal submitLabel="เพิ่มรหัสสำรอง" title="เติม Passcode สำรอง" subtitle={`เพิ่มรหัสสำรองสำหรับ ${selected.title}`} close={()=>setModal(null)}><form id="staff-admin-form" onSubmit={e=>void withLoading('กำลังเพิ่ม Passcode…',()=>addCodes(e))} className="space-y-3"><label className="block text-xs font-semibold text-slate-700">รายการ Passcode <textarea name="codes" required rows={6} placeholder={'ARU-R-3001\nARU-R-3002\nARU-R-3003'} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:border-amber-400"/></label><p className="text-[10px] text-slate-500">ใส่หนึ่งรหัสต่อบรรทัด ระบบจะข้ามรหัสที่ซ้ำโดยอัตโนมัติ</p></form></Modal>}
    {modal==='staff'&&<Modal submitLabel="สร้างบัญชีเจ้าหน้าที่" title="เพิ่มบัญชีเจ้าหน้าที่" subtitle="สร้างบัญชีสตาฟหรือแอดมินสำหรับเข้าระบบ" close={()=>setModal(null)}><form id="staff-admin-form" onSubmit={e=>void withLoading('กำลังสร้างบัญชี…',()=>createStaffAccount(e))} className="space-y-3"><Field label="ชื่อผู้ใช้ / รหัสเจ้าหน้าที่" name="username" required placeholder="เช่น staff-aru-01"/><Field label="ชื่อ–นามสกุล" name="full_name" required placeholder="ชื่อผู้ใช้งาน"/><label className="block text-[11px] font-semibold text-slate-600">ประเภทบัญชี<select name="role" className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-normal text-slate-800"><option value="STAFF">สตาฟ</option><option value="ADMIN">แอดมิน</option></select></label><Field label="รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)" name="password" type="password" minLength={8} required placeholder="ตั้งรหัสผ่านเริ่มต้น"/><div className="grid gap-3 sm:grid-cols-2"><Field label="หน่วยงาน / คณะ" name="faculty" placeholder="องค์การนักศึกษา"/><Field label="ฝ่าย / ตำแหน่ง" name="major" placeholder="ฝ่ายกิจกรรม"/></div><p className="rounded-xl bg-amber-50 px-3 py-2 text-[10px] leading-5 text-amber-900">ตั้งรหัสผ่านเริ่มต้นให้เจ้าหน้าที่ และแจ้งให้เปลี่ยนรหัสผ่านหลังเข้าสู่ระบบครั้งแรก</p></form></Modal>}
    {modal==='editUser'&&editingUser&&<Modal submitLabel="บันทึกข้อมูลผู้ใช้" title="แก้ไขข้อมูลผู้ใช้" subtitle={editingUser.role==='STUDENT'?'แก้ไขข้อมูลนักศึกษา':'แก้ไขข้อมูลสตาฟ'} close={()=>{setModal(null);setEditingUser(null)}}><form id="staff-admin-form" onSubmit={e=>void withLoading('กำลังบันทึกข้อมูลผู้ใช้…',()=>updateManagedUser(e,editingUser))} className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><Field label="ชื่อผู้ใช้ / รหัสนักศึกษา" name="student_id" required defaultValue={editingUser.student_id}/><Field label="ชื่อ-นามสกุล" name="full_name" required defaultValue={editingUser.full_name}/>{editingUser.role==='STUDENT'?<label className="block text-[11px] font-semibold text-slate-600">คณะ<select name="faculty" value={editingFaculty} onChange={e=>{setEditingFaculty(e.target.value);setEditingMajor(academicCatalog.find(faculty=>faculty.name===e.target.value)?.majors[0]?.name||'');}} required className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-normal text-slate-800">{editingFaculty && !academicCatalog.some(f=>f.name===editingFaculty) && <option value={editingFaculty}>{editingFaculty}</option>}{academicCatalog.map(faculty=><option key={faculty.id} value={faculty.name}>{faculty.name}</option>)}</select></label>:<Field label="คณะ / หน่วยงาน" name="faculty" defaultValue={editingUser.faculty}/>} {editingUser.role==='STUDENT'?<label className="block text-[11px] font-semibold text-slate-600">สาขาวิชา<select name="major" value={editingMajor} onChange={e=>setEditingMajor(e.target.value)} required className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-normal text-slate-800">{editingMajor && !academicCatalog.find(f=>f.name===editingFaculty)?.majors.some(m=>m.name===editingMajor) && <option value={editingMajor}>{editingMajor}</option>}{(academicCatalog.find(faculty=>faculty.name===editingFaculty)?.majors||[]).map(major=><option key={major.id} value={major.name}>{major.name}</option>)}</select></label>:<Field label="สาขา / ฝ่าย" name="major" defaultValue={editingUser.major}/>}<Field label="หมู่เรียน / กลุ่ม" name="class_group" defaultValue={editingUser.class_group}/><Field label="วันเกิด (DDMMYYYY)" name="birth_date" defaultValue={editingUser.birth_date||''} placeholder="เว้นว่างหากไม่แก้ไข"/><Field label="เบอร์โทรศัพท์" name="phone" type="tel" defaultValue={editingUser.phone||''}/>{editingUser.role==='STUDENT'&&<label className="block text-[11px] font-semibold text-slate-600">ชั้นปีที่กำลังศึกษา<select name="study_year" defaultValue={editingUser.study_year} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-normal text-slate-800">{Array.from({length:8},(_,index)=>index+1).map(year=><option key={year} value={year}>ปี {year}</option>)}</select></label>}<Field label="รหัสผ่านใหม่ (เว้นว่างหากไม่เปลี่ยน)" name="new_password" type="password" minLength={8} placeholder="อย่างน้อย 8 ตัวอักษร"/></div><p className="rounded-xl bg-amber-50 px-3 py-2 text-[10px] leading-5 text-amber-900">เมื่อกำหนดรหัสผ่านใหม่ ระบบจะออกจากระบบในอุปกรณ์อื่นของบัญชีนี้</p></form></Modal>}
    {(loadingMessage||saving)&&<div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/25 p-4 backdrop-blur-[2px]" role="status" aria-live="polite" aria-busy="true"><div className="flex min-w-[230px] items-center gap-3 rounded-2xl border border-white/80 bg-white/95 px-5 py-4 shadow-2xl"><Loader2 size={22} className="animate-spin text-[#7c0a02]"/><div><b className="block text-xs text-slate-900">{loadingMessage||"กำลังดำเนินการ…"}</b><span className="mt-1 block text-[10px] text-slate-500">กรุณารอสักครู่</span><span className="loading-progress mt-3 block h-1 overflow-hidden rounded-full bg-rose-100"><i className="block h-full w-2/5 rounded-full bg-[#7c0a02]"/></span></div></div></div>}
    {toast&&<div className="fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-slate-950 px-5 py-3 text-xs font-medium text-white shadow-2xl">{toast}</div>}
  </main>;
}

function roleName(role:Role){return role==='STUDENT'?'นักศึกษา':role==='STAFF'?'สตาฟกิจกรรม':'ผู้ดูแลระบบ';}

function RoleBadge({role, size='sm'}:{role:Role; size?:'sm'|'md'}){
  if(role==='ADMIN'){
    return <span className={cx('inline-flex items-center gap-1 rounded-full border border-rose-300/80 bg-rose-50 font-extrabold text-[#7c0a02] shadow-sm', size==='sm'?'px-2 py-0.5 text-[9px]':'px-3 py-1 text-[11px]')}><ShieldCheck size={size==='sm'?11:13}/>ผู้ดูแลระบบ</span>;
  }
  if(role==='STAFF'){
    return <span className={cx('inline-flex items-center gap-1 rounded-full border border-amber-300/80 bg-amber-50 font-extrabold text-amber-900 shadow-sm', size==='sm'?'px-2 py-0.5 text-[9px]':'px-3 py-1 text-[11px]')}><ScanLine size={size==='sm'?11:13}/>สตาฟกิจกรรม</span>;
  }
  return <span className={cx('inline-flex items-center gap-1 rounded-full border border-emerald-300/80 bg-emerald-50 font-extrabold text-emerald-800 shadow-sm', size==='sm'?'px-2 py-0.5 text-[9px]':'px-3 py-1 text-[11px]')}><GraduationCap size={size==='sm'?11:13}/>นักศึกษา</span>;
}

function EventStatusPill({status}:{status:Event['status']}){
  if(status==='ACTIVE'){
    return <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[9px] font-extrabold text-emerald-700 shadow-sm"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"/>เปิดใช้งาน</span>;
  }
  if(status==='UPCOMING'){
    return <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[9px] font-extrabold text-sky-700 shadow-sm"><Calendar size={11}/>เร็วๆ นี้</span>;
  }
  return <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[9px] font-bold text-slate-500">ปิดกิจกรรม</span>;
}

function NavButton({
  active,
  icon,
  children,
  badge,
  theme = 'rose',
  onClick
}:{
  active: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
  badge?: string | number;
  theme?: 'rose' | 'emerald' | 'amber' | 'slate';
  onClick: () => void;
}) {
  const styles = {
    rose: active
      ? 'bg-[#7c0a02] text-white shadow-md shadow-rose-950/25 ring-2 ring-rose-900/10'
      : 'text-slate-600 hover:text-[#7c0a02] hover:bg-rose-50/70',
    emerald: active
      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/25 ring-2 ring-emerald-600/10'
      : 'text-slate-600 hover:text-emerald-700 hover:bg-emerald-50/70',
    amber: active
      ? 'bg-amber-500 text-slate-950 font-black shadow-md shadow-amber-900/20 ring-2 ring-amber-500/20'
      : 'text-slate-600 hover:text-amber-900 hover:bg-amber-50/70',
    slate: active
      ? 'bg-slate-900 text-amber-300 font-black shadow-md shadow-slate-950/25 ring-2 ring-slate-900/20'
      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100',
  }[theme];

  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'group relative flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-bold transition-all duration-200',
        styles
      )}
    >
      <span className={cx('transition-transform duration-200 group-hover:scale-110', active ? 'opacity-100' : 'opacity-70 group-hover:opacity-100')}>
        {icon}
      </span>
      <span>{children}</span>
      {badge !== undefined && (
        <span className={cx(
          'ml-0.5 rounded-full px-1.5 py-0.2 text-[9px] font-extrabold',
          active ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-700'
        )}>
          {badge}
        </span>
      )}
    </button>
  );
}
function Field({label,...props}:{label:string;name:string;id?:string;type?:string;required?:boolean;placeholder?:string;defaultValue?:string|number;min?:string|number;max?:string|number;minLength?:number;maxLength?:number;step?:string|number;autoComplete?:string;enterKeyHint?:"go"|"next"}){const Input=props.type==='password'?PasswordInput:'input';return <label className="block text-[11px] font-semibold text-slate-600">{label}<Input {...props} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-normal text-slate-800 placeholder:text-slate-300"/></label>}
function Modal({title,subtitle,close,children,submitLabel,submitDisabled=false,wide=false}:{
  title:string;subtitle:string;close:()=>void;children:React.ReactNode;submitLabel?:string;submitDisabled?:boolean;wide?:boolean;
}){
  const dialogRef=useRef<HTMLDialogElement>(null);
  const titleId=useId();
  useEffect(()=>{
    const dialog=dialogRef.current;
    if(!dialog)return;
    const previousOverflow=document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow='hidden';
    return()=>{dialog.close();document.body.style.overflow=previousOverflow;};
  },[]);
  return <dialog ref={dialogRef} aria-labelledby={titleId}
    onCancel={e=>{e.preventDefault();close();}}
    className={cx('m-auto max-h-[94dvh] w-[calc(100%_-_1rem)] overflow-hidden rounded-3xl border-0 bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-950/50',wide?'max-w-5xl':'max-w-lg')}>
    <section className="flex max-h-[94dvh] min-w-0 flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="min-w-0"><h2 id={titleId} className="text-lg font-bold">{title}</h2><p className="mt-1 break-words text-xs text-slate-600">{subtitle}</p></div>
        <button type="button" autoFocus aria-label="ปิดหน้าต่าง" onClick={close} className="action-secondary shrink-0"><X size={18}/></button>
      </header>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5">{children}</div>
      {submitLabel && <footer className="shrink-0 border-t border-slate-200 bg-white px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button form="staff-admin-form" type="submit" disabled={submitDisabled} className="action-primary w-full"><Save size={18}/>{submitLabel}</button>
      </footer>}
    </section>
  </dialog>;
}

function NeuralNetworkCanvas(){
 const canvasRef=useRef<HTMLCanvasElement|null>(null);
 useEffect(()=>{
  const canvas=canvasRef.current,context=canvas?.getContext('2d');
  if(!canvas||!context)return;
  let width=0,height=0,frame=0;
  let nodes:{x:number;y:number;phase:number;speed:number}[]=[];
  const pointer={x:-1000,y:-1000};
  const resize=()=>{
   const rect=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);
   width=rect.width;height=rect.height;canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
   context.setTransform(dpr,0,0,dpr,0,0);
   const count=Math.max(38,Math.min(78,Math.floor(width/15)));
   nodes=Array.from({length:count},()=>({x:Math.random()*width,y:Math.random()*height,phase:Math.random()*Math.PI*2,speed:.35+Math.random()*.8}));
  };
  const move=(event:PointerEvent)=>{const rect=canvas.getBoundingClientRect();pointer.x=event.clientX-rect.left;pointer.y=event.clientY-rect.top;};
  const leave=()=>{pointer.x=-1000;pointer.y=-1000;};
  const draw=(time:number)=>{
   context.clearRect(0,0,width,height);
   const positions=nodes.map(node=>{
    const dx=pointer.x-node.x,dy=pointer.y-node.y,distance=Math.hypot(dx,dy),pull=Math.max(0,1-distance/190);
    return {x:node.x+Math.sin(time*.00035*node.speed+node.phase)*4+dx*pull*.18,y:node.y+Math.cos(time*.0003*node.speed+node.phase)*4+dy*pull*.18,glow:pull,phase:node.phase};
   });
   for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++){
    const a=positions[i],b=positions[j],distance=Math.hypot(a.x-b.x,a.y-b.y);
    if(distance<132){const alpha=(1-distance/132)*(.18+Math.max(a.glow,b.glow)*.62);context.beginPath();context.moveTo(a.x,a.y);context.lineTo(b.x,b.y);context.strokeStyle=`rgba(250,220,133,${alpha})`;context.lineWidth=.65+Math.max(a.glow,b.glow)*.7;context.stroke();}
   }
   positions.forEach(point=>{const pulse=.55+.45*Math.sin(time*.0012+point.phase);context.beginPath();context.arc(point.x,point.y,1.1+point.glow*2.4,0,Math.PI*2);context.fillStyle=point.glow>.08?`rgba(255,229,160,${.45+pulse*.5})`:`rgba(255,255,255,${.24+pulse*.43})`;context.shadowBlur=point.glow>0?14:0;context.shadowColor='rgba(255,211,102,.9)';context.fill();});
   context.shadowBlur=0;frame=requestAnimationFrame(draw);
  };
  resize();frame=requestAnimationFrame(draw);
  window.addEventListener('resize',resize);window.addEventListener('pointermove',move,{passive:true});window.addEventListener('pointerleave',leave);
  return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',resize);window.removeEventListener('pointermove',move);window.removeEventListener('pointerleave',leave);};
 },[]);
 return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full opacity-80"/>;
}

function Landing({enterAs,saving,loginError}:{enterAs:()=>void;saving:boolean;loginError:string}){return <div className="space-y-5">
  {/* — Login card first — */}
  <section id="login-card" className="bento mx-auto max-w-md p-6 sm:p-8">
    <div className="flex flex-col items-center text-center">
      <img src="/aru-icon.jpg" alt="ARU" className="h-16 w-16 rounded-2xl border-2 border-[#d4af37] object-cover shadow-md"/>
      <h2 className="mt-4 text-2xl font-extrabold text-slate-900">เข้าสู่ระบบ</h2>
      <p className="mt-1 text-xs text-slate-500">ระบบลงทะเบียนกิจกรรม · องค์การนักศึกษา ARU</p>
    </div>
    <form className="mt-6 space-y-3" onSubmit={event=>{
      event.preventDefault();
      if (!saving) enterAs();
    }}>
      <Field label="รหัสนักศึกษา" name="login-id" id="login-id" autoComplete="username" required={isSupabaseConfigured} placeholder="กรอกรหัสผู้ใช้งาน"/>
      <Field label="รหัสผ่าน" name="login-password" id="login-password" autoComplete="current-password" enterKeyHint="go" required={isSupabaseConfigured} type="password" placeholder="••••••••"/>
      <p className="text-sm text-slate-600">รหัสผ่านเริ่มต้นของนักศึกษาคือวันเดือนปีเกิด พ.ศ. 8 หลัก เช่น 22 มิถุนายน 2549 กรอก <b>22062549</b> หากเปลี่ยนรหัสผ่านแล้วให้ใช้รหัสปัจจุบัน</p>
      <button type="submit" disabled={saving} className="login-action group relative mt-2 flex w-full items-center justify-between overflow-hidden rounded-2xl px-5 py-4 text-sm font-extrabold text-white transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(124,10,2,.28)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300/70 disabled:translate-y-0 disabled:cursor-wait disabled:opacity-75">
        <span className="pointer-events-none absolute inset-0 login-action-shine"/>
        <span className="relative flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-amber-200">{saving?<Loader2 size={19} className="animate-spin"/>:<ShieldCheck size={19}/>}</span><span className="text-left"><span className="block text-[15px]">{saving?"กำลังเข้าสู่ระบบ…":"เข้าสู่ระบบ"}</span><span className="mt-0.5 block text-[9px] font-medium tracking-wide text-white/65">ARU EVENT PASS</span></span></span>
        <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-amber-300 text-[#57100b] transition duration-300 group-hover:translate-x-1 group-hover:rotate-[-35deg]">{saving?<Loader2 size={16} className="animate-spin"/>:<ArrowRight size={17}/>}</span>
      </button>
    </form>
    {loginError && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{loginError}</p>}
    <LoginHelp loginFailed={loginError.includes('รหัสผ่านไม่ถูกต้อง')}/>
  </section>


  {/* — Banner + info below — */}
  <section className="maroon-gradient relative overflow-hidden rounded-[34px] p-7 text-white shadow-xl shadow-rose-950/20 sm:p-10">
    <NeuralNetworkCanvas/>
    <div className="absolute -right-10 -top-8 h-72 w-72 rounded-full border border-white/10"/>
    <div className="absolute -right-2 top-1 h-56 w-56 rounded-full border border-white/10"/>
    <div className="absolute bottom-0 right-0 h-64 w-64 rounded-full bg-rose-300/10 blur-3xl"/>
    <div className="relative z-10 flex flex-col items-center gap-8 lg:flex-row lg:items-start lg:gap-12">
      {/* Banner logo */}
      <div className="flex w-full max-w-[280px] shrink-0 flex-col items-center lg:max-w-[260px]">
        <img src="/aru-banner.jpg" alt="องค์การนักศึกษา มหาวิทยาลัยราชภัฏพระนครศรีอยุธยา" className="w-full rounded-2xl border-2 border-white/20 bg-white/95 p-4 shadow-lg"/>
      </div>
      {/* Info */}
      <div className="flex-1 text-center lg:text-left">
        <div className="flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-white/75 lg:justify-start"><Activity size={14}/> ARU EVENT PASS</div>
        <h1 className="mt-4 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-[64px]">ARU<br/><span className="text-amber-300">Event Pass</span></h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-rose-50/80 lg:mx-0">ระบบลงทะเบียนและเช็กอินกิจกรรมมหาวิทยาลัย เชื่อมต่อด้วย QR Code พร้อมติดตามสถานะได้แบบเรียลไทม์</p>
        <div className="mt-8 grid max-w-lg grid-cols-1 min-[400px]:grid-cols-3 gap-3 mx-auto lg:mx-0"><MetricChip icon={<QrCode size={15}/>} label="QR Check-in" value="รวดเร็ว"/><MetricChip icon={<Zap size={15}/>} label="Live Status" value="Real-time"/><MetricChip icon={<Ticket size={15}/>} label="Passcode" value="ปลอดภัย"/></div>
      </div>
    </div>
  </section>
  </div>}
function MetricChip({icon,label,value}:{icon:React.ReactNode;label:string;value:string}){return <div className="rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur-md"><div className="flex items-center gap-1.5 text-amber-200">{icon}<span className="text-[9px] font-semibold text-white/70">{label}</span></div><b className="mt-1 block text-sm">{value}</b></div>}

function StudentHome({user,events,regs,select,store,session,refresh}:{session:string;refresh:()=>Promise<void>;user:User;events:Event[];regs:Registration[];select:(id:string)=>void;store:Store}){
  const latestConfirmed=[...regs].filter(r=>r.status==='ATTENDING'||r.status==='COMPLETED').sort((a,b)=>Date.parse(b.checkout_at||b.checkin_at||'')-Date.parse(a.checkout_at||a.checkin_at||''))[0];
  const latestEvent=latestConfirmed?store.events.find(e=>e.id===latestConfirmed.event_id):undefined;
  return <div className="space-y-5">
    <header className="px-2"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.15em] text-slate-400"><span>{formatThaiDate()}</span><span className="h-1 w-1 rounded-full bg-[#d4af37]"/>Student Portal</div><h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">กิจกรรมที่กำลังเปิด</h1><p className="mt-1 text-xs text-slate-500">เลือกกิจกรรมเพื่อดูรายละเอียดและ QR Code ของคุณ</p></header>
    <AttendanceConfirmation status={latestConfirmed?.status} eventTitle={latestEvent?.title}/>
    <section className="bento p-4 sm:p-6">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-extrabold text-slate-900">กิจกรรมที่ฉันลงทะเบียน</h2>
        <span className="shrink-0 text-xs text-slate-600">{events.length+(store.applications?.length||0)} กิจกรรม</span>
      </div>
      <div className="mt-4 space-y-3">
        {store.applications?.map(a=><article key={a.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <b>{a.title}</b><p className="mt-1 text-sm">{a.status==='CORRECT'?(a.online?'แอดมินขอให้แก้ไขใบสมัคร':'กรุณาแก้ไขที่จุดลงทะเบียนหน้างาน')+' · '+a.note:'รอยืนยันเข้าร่วมกิจกรรม'}</p>
          {a.status==='CORRECT' && a.online && <a className="action-primary mt-3" href={'/register/'+a.event_id+'?correct='+a.id}>เปิดใบสมัครเพื่อแก้ไข</a>}
        </article>)}
        {events.map(event=>{
          const registration=regs.find(reg=>reg.event_id===event.id);
          if (!registration) return null;
          const completed=registration.status==='COMPLETED';
          const action=completed?'ดูผลการเข้าร่วม':registration.status==='ATTENDING'?'เปิด QR สแกนออก':'เปิด QR สแกนเข้า';
          return <button key={event.id} type="button" onClick={()=>select(event.id)} aria-label={action+' · '+event.title}
            style={event.banner_url?{backgroundImage:`linear-gradient(90deg,rgba(255,255,255,.97),rgba(255,255,255,.87)),url("${event.banner_url}")`,backgroundSize:'cover',backgroundPosition:'center'}:undefined}
            className="group grid w-full gap-4 rounded-2xl border border-slate-300 bg-white p-4 text-left shadow-sm transition hover:border-[#7c0a02] hover:shadow-md active:bg-rose-50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <span className="min-w-0">
              <StatusPill status={registration.status}/>
              <strong className="mt-2 block break-words text-base text-slate-900">{event.title}</strong>
              <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                <span className="flex items-center gap-1"><MapPin size={14}/>{event.location}</span>
                <span className="flex items-center gap-1"><Clock3 size={14}/>{event.activity_hours} ชั่วโมง</span>
              </span>
            </span>
            <span className={cx('inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold',
              completed?'border border-slate-300 bg-white text-slate-700 group-hover:bg-slate-100':'bg-[#7c0a02] text-white group-hover:bg-[#620701]')}>
              {completed?<CheckCircle2 size={16}/>:<QrCode size={16}/>}{action}<ArrowRight size={16}/>
            </span>
          </button>;
        })}
        {events.length===0&&!store.applications?.length&&<Empty message="ยังไม่มีกิจกรรมที่เปิดและลงทะเบียนไว้"/>}
      </div>
    </section>
    {user.role==='STUDENT' && <OpenEvents token={session} refresh={refresh}/>}
    <UserProfileSummary user={user}/>
  </div>;
}

function StudentStatsView({user,events,regs}:{user:User;events:Event[];regs:Registration[]}){
  const completed=regs.filter(r=>r.status==='COMPLETED').length;
  return <div className="space-y-5"><header className="px-2"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.15em] text-slate-400"><span>{formatThaiDate()}</span><span className="h-1 w-1 rounded-full bg-[#d4af37]"/>Student Portal</div><h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">ภาพรวมของฉัน</h1><p className="mt-1 text-xs text-slate-500">สรุปกิจกรรมและข้อมูลชั้นปีของคุณ</p></header><div className="grid gap-4 md:grid-cols-3"><div className="maroon-gradient relative overflow-hidden rounded-[28px] p-5 text-white"><div className="absolute -right-4 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl"/><span className="relative text-[10px] font-semibold text-rose-100">กิจกรรมที่ลงทะเบียน</span><div className="relative mt-2 flex items-end justify-between"><strong className="text-4xl">{events.length.toString().padStart(2,'0')}</strong><Activity size={18}/></div><span className="relative mt-1 block text-[10px] text-rose-100/80">กิจกรรมที่คุณมีสิทธิ์</span></div><div className="bento p-5"><span className="text-[10px] font-semibold text-slate-500">เข้าร่วมสำเร็จ</span><div className="mt-2 flex items-end justify-between"><strong className="text-4xl text-slate-900">{completed.toString().padStart(2,'0')}</strong><CheckCircle2 size={18} className="text-emerald-600"/></div><span className="mt-1 block text-[10px] text-slate-400">รับชั่วโมงกิจกรรมครบแล้ว</span></div><div className="bento p-5"><span className="text-[10px] font-semibold text-slate-500">ระดับชั้นปี</span><div className="mt-2 flex items-end justify-between"><strong className="text-4xl text-slate-900">{user.study_year>0?`ปี ${user.study_year}`:'—'}</strong><GraduationCap size={18} className="text-amber-600"/></div><span className="mt-1 block text-[10px] text-slate-400">ใช้ชั้นปีปัจจุบันที่ระบุในข้อมูลนักศึกษา</span></div></div></div>;
}
function AttendanceConfirmation({status,eventTitle}:{status?:Status;eventTitle?:string}){
  if(!status||status==='REGISTERED')return null;
  const completed=status==='COMPLETED';
  return <section role="status" aria-live="polite" className={cx('flex items-center gap-4 rounded-2xl border p-4 shadow-sm sm:p-5',completed?'border-emerald-200 bg-emerald-50':'border-amber-200 bg-amber-50')}>
    <div className={cx('flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-md',completed?'bg-emerald-600':'bg-amber-500')}>{completed?<CheckCircle2 size={34} strokeWidth={2.7}/>:<Clock3 size={32} strokeWidth={2.5}/>}</div>
    <div className="min-w-0 flex-1"><p className={cx('text-base font-extrabold sm:text-lg',completed?'text-emerald-900':'text-amber-900')}>{completed?'เข้าร่วมกิจกรรมสำเร็จ':'กำลังเข้าร่วมกิจกรรม'}</p><p className={cx('mt-0.5 text-xs font-semibold sm:text-sm',completed?'text-emerald-800':'text-amber-800')}>{completed?'เช็กเอาต์เรียบร้อยแล้ว':'เช็กอินแล้ว · รอเช็กเอาต์'}{eventTitle?` · ${eventTitle}`:''}</p></div>
    <span className={cx('hidden rounded-full px-3 py-1.5 text-[10px] font-extrabold sm:inline-flex',completed?'bg-emerald-100 text-emerald-800':'bg-amber-100 text-amber-800')}>{completed?'✓ สำเร็จ':'● กำลังเข้าร่วม'}</span>
  </section>;
}

function StatusPill({status}:{status:Status}){const label=status==='REGISTERED'?'รอสแกนเข้างาน':status==='ATTENDING'?'กำลังเข้าร่วมกิจกรรม':'เข้าร่วมกิจกรรมสำเร็จ';return <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[8px] font-bold',status==='REGISTERED'?'bg-slate-100 text-slate-500':status==='ATTENDING'?'bg-amber-100 text-amber-800':'bg-emerald-100 text-emerald-800')}>{status==='ATTENDING'?<Clock3 size={12} strokeWidth={2.5}/>:status==='COMPLETED'?<CheckCircle2 size={12} strokeWidth={3}/>:null}<span>{label}</span></span>}
function Empty({message}:{message:string}){return <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-xs text-slate-400">{message}</div>}

function EventDetail({event,user,registration,back,session}:{session:string;event:Event;user:User;registration?:Registration;back:()=>void}){
  const [done,setDone]=useState(false);
  const passcode=registration?.status==='COMPLETED'&&user.study_year>1?registration.passcode:undefined;
  const yearOneRedirect=user.study_year===1&&registration && registration.status!=='REGISTERED'&&event.redirect_url_year1;
  return <div className="mx-auto max-w-5xl">
    <button onClick={back} className="mb-4 inline-flex min-h-11 items-center gap-1 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:border-[#7c0a02] hover:text-[#7c0a02]">← กลับหน้ากิจกรรม</button>
    <div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
      <section className="maroon-gradient relative min-h-[270px] overflow-hidden rounded-[32px] p-7 text-white sm:p-9" style={event.banner_url?{backgroundImage:`linear-gradient(105deg,rgba(91,8,4,.94) 0%,rgba(124,10,2,.86) 55%,rgba(91,8,4,.68) 100%),url("${event.banner_url}")`,backgroundSize:'cover',backgroundPosition:'center'}:undefined}><span className="rounded-full bg-white/15 px-3 py-1 text-[9px] font-bold">กิจกรรม ARU</span><h1 className="mt-8 max-w-xl text-3xl font-extrabold leading-tight">{event.title}</h1><p className="mt-3 flex items-center gap-1.5 text-xs text-rose-100"><MapPin size={14}/>{event.location} <span className="mx-1">·</span><Clock3 size={14}/>{event.activity_hours} ชั่วโมง</p><div className="absolute -bottom-12 -right-10 h-48 w-48 rounded-full border-[28px] border-white/5"/></section>
      <section className="bento p-6">
        <AttendanceConfirmation status={registration?.status} eventTitle={event.title}/>
        <div className="flex items-center justify-between"><div><span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">สถานะการเข้าร่วม</span><div className="mt-2"><StatusPill status={registration?.status||'REGISTERED'}/></div></div><div className="rounded-2xl bg-amber-50 p-3 text-amber-600"><QrCode size={22}/></div></div>
        {isSupabaseConfigured ? registration && registration.status!=='COMPLETED' && event.status==='ACTIVE' &&
          <StudentQr key={event.id+':'+session+':'+registration.status} session={session} eventId={event.id}/>
          : <><div className="qr-ticket my-5 flex justify-center rounded-2xl p-2">
          <QRCodeCanvas value={JSON.stringify({e:event.id,u:user.id})} size={256} marginSize={4} level="M" fgColor="#000000" bgColor="#ffffff" role="img" aria-label="QR สำหรับสแกนเข้าและออกจากกิจกรรม"/>
        </div>
        <p className="text-center text-[10px] leading-5 text-slate-500">แสดง QR Code นี้ให้เจ้าหน้าที่สแกนเมื่อเข้างาน<br/>ระบบจะแจ้งสถานะใหม่ให้โดยอัตโนมัติ</p></>}
        {registration?.status==='COMPLETED' && user.study_year>1 && !passcode && <p role="status" className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">เข้าร่วมกิจกรรมสำเร็จแล้ว · รอแอดมินจัดสรร Passcode ระบบจะแสดงรหัสเมื่อจับคู่เรียบร้อย</p>}
        {passcode&&<div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center"><span className="text-[9px] font-bold uppercase tracking-wider text-amber-800">Passcode ปลดล็อกแล้ว</span><div className="mt-1 flex items-center justify-center gap-2"><b className="text-xl tracking-[.18em] text-[#7c0a02]">{passcode}</b><button className="rounded-lg bg-white p-2 text-[#7c0a02]" onClick={()=>{navigator.clipboard?.writeText(passcode);setDone(true);setTimeout(()=>setDone(false),1800)}}>{done?<Check size={15}/>:<Clipboard size={15}/>}</button></div><span className="mt-1 block text-[9px] text-amber-800">{done?'คัดลอกแล้ว':'คัดลอกรหัสเพื่อยืนยันสิทธิ์'}</span></div>}
        {yearOneRedirect&&<a href={event.redirect_url_year1} className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-[#7c0a02] py-3 text-xs font-bold text-white">ไปยังหน้ากิจกรรม <ExternalLink size={13}/></a>}
      </section>
    </div>
  </div>;
}

function ScanResultEffect({message,flash}:{message:{ok:boolean;title:string;detail:string}|null;flash:string}) {
 const [visible,setVisible]=useState(false);
 const [animationKey,setAnimationKey]=useState(0);
 useEffect(()=>{
  if(!message||!['success','checkout','error'].includes(flash)){setVisible(false);return;}
  setAnimationKey(key=>key+1);
  setVisible(true);
  const timer=window.setTimeout(()=>setVisible(false),1550);
  return()=>window.clearTimeout(timer);
 },[message,flash]);
 if(!visible||!message)return null;
 const success=message.ok;
 return <div className="pointer-events-none absolute inset-0 z-[8] flex items-center justify-center px-5" aria-live="polite">
  <div key={animationKey} className={cx('scan-result-card w-full max-w-[280px] rounded-[26px] border px-6 py-5 text-center shadow-2xl backdrop-blur-xl',success?'border-emerald-200/30 bg-slate-950/85':'border-rose-200/30 bg-slate-950/85')}>
   <div className={cx('scan-result-orbit mx-auto mb-3 flex h-[76px] w-[76px] items-center justify-center rounded-full',flash==='checkout'?'text-amber-300':success?'text-emerald-300':'text-rose-300')}>
    <span className="scan-result-halo absolute h-[76px] w-[76px] rounded-full border"/>
    <span className="scan-result-halo scan-result-halo-delay absolute h-[76px] w-[76px] rounded-full border"/>
   <span className={cx('relative flex h-14 w-14 items-center justify-center rounded-full',flash==='checkout'?'bg-amber-300 text-amber-950':success?'bg-emerald-300 text-emerald-950':'bg-rose-400 text-rose-950')}>
     {success?<Check size={30} strokeWidth={3}/>:<X size={28} strokeWidth={3}/>}
    </span>
   </div>
   <span className={cx('inline-flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-[.2em]',flash==='checkout'?'text-amber-300':success?'text-emerald-300':'text-rose-300')}><CheckCircle2 size={12}/>{flash==='checkout'?'CHECK-OUT':success?'CHECK-IN COMPLETE':'SCAN ERROR'}</span>
   <b className="mt-1 block truncate text-base font-extrabold text-white">{message.title}</b>
   <span className="mt-1 block truncate text-[10px] text-slate-300">{message.detail}</span>
  </div>

 </div>;
}

function ScannerView({user,event,events,activeEvent,setActiveEvent,scannerOn,startScanner,stopScanner,scanMode,scanInput,setScanInput,scanPayload,scanMessage,flash,attendance,registered,reserveLeft,openWalkin,scannerLocked,toggleScannerLock}:{user:User;event:Event;events:Event[];activeEvent:string;setActiveEvent:(id:string)=>void;scannerOn:boolean;startScanner:()=>void;stopScanner:()=>void;scanMode:()=>void;scanInput:string;setScanInput:(s:string)=>void;scanPayload:(s:string)=>Promise<void>;scanMessage:{ok:boolean;title:string;detail:string}|null;flash:string;attendance:number;registered:number;reserveLeft:number;openWalkin:()=>void;scannerLocked:boolean;toggleScannerLock:()=>void}) {
 const pct=registered?Math.round(attendance/registered*100):0;
 return <div className={cx('space-y-5 rounded-[30px] p-1 transition',flash==='success'?'scanner-flash-success':flash==='checkout'?'scanner-flash-checkout':flash==='error'?'scanner-flash-error':'')}>
   {/* Scanner Header Bar */}
   <div className="flex flex-wrap items-end justify-between gap-3 px-2">
     <div>
       <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">จุดสแกนหน้างาน</h1>
     </div>
     <div className="flex flex-wrap items-center gap-2">
       <EventStatusPill status={event.status}/>
       <div className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-left shadow-sm">
         <b className="block truncate text-[10px] font-bold text-slate-800">{user.full_name}</b>
         <small className="block truncate text-[9px] text-slate-400">{user.student_id} · {user.faculty}</small>
       </div>
       <button
         type="button"
         onClick={toggleScannerLock}
         aria-pressed={scannerLocked}
         className={cx(
           'flex items-center gap-2 rounded-full border px-4 py-2 text-[11px] font-extrabold transition shadow-sm',
           scannerLocked
             ? 'border-amber-400 bg-amber-300 text-slate-950 ring-2 ring-amber-400/30'
             : 'border-slate-300 bg-white text-slate-700 hover:border-amber-400 hover:bg-amber-50 hover:text-amber-900'
         )}
       >
         {scannerLocked ? <Unlock size={14}/> : <Lock size={14}/>}
         <span>{scannerLocked ? 'ปลดล็อก' : 'ล็อกหน้าจอ'}</span>
       </button>
     </div>
   </div>

   {/* Main Grid */}
   <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
     <section className="bento overflow-hidden p-4 sm:p-5">
       {/* Selector + Mode Toggle with distinct colors */}
       <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
         <div className="min-w-0 max-w-full">
           <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">เลือกกิจกรรมที่สแกน</span>
           <div className="mt-1 flex items-center gap-2">
             <select
               aria-label="กิจกรรมที่สแกน"
               value={activeEvent}
               onChange={e=>setActiveEvent(e.target.value)}
               className="h-10 w-full min-w-0 max-w-[320px] rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-800 shadow-sm"
             >
               {events.map(ev=><option key={ev.id} value={ev.id}>{ev.title}</option>)}
             </select>
           </div>
         </div>

         {/* Mode Switcher */}
         <div className="flex items-center rounded-2xl bg-slate-100 p-1 shadow-inner">
           <button
             type="button"
             aria-pressed={event.scan_mode==='CHECKIN'}
             onClick={() => { if(event.scan_mode !== 'CHECKIN') scanMode(); }}
             className={cx(
               'flex min-h-11 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-extrabold transition-all duration-200',
               event.scan_mode === 'CHECKIN'
                 ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/20 ring-2 ring-emerald-500/20'
                 : 'text-slate-600 hover:text-emerald-700'
             )}
           >
             <span className={cx('h-2 w-2 rounded-full', event.scan_mode === 'CHECKIN' ? 'animate-pulse bg-emerald-200' : 'bg-slate-400')}/>
             <ArrowDownRight size={14}/>
             สแกนเข้า
           </button>
           <button
             type="button"
             aria-pressed={event.scan_mode==='CHECKOUT'}
             onClick={() => { if(event.scan_mode !== 'CHECKOUT') scanMode(); }}
             className={cx(
               'flex min-h-11 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-extrabold transition-all duration-200',
               event.scan_mode === 'CHECKOUT'
                 ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-950/20 ring-2 ring-amber-400/20 font-black'
                 : 'text-slate-600 hover:text-amber-800'
             )}
           >
             <span className={cx('h-2 w-2 rounded-full', event.scan_mode === 'CHECKOUT' ? 'animate-pulse bg-amber-900' : 'bg-slate-400')}/>
             <ArrowUpRight size={14}/>
             สแกนออก
           </button>
         </div>
       </div>

       <div className="mb-4 grid gap-2 sm:grid-cols-2">
         <button type="button" onClick={()=>scannerOn?stopScanner():startScanner()} className={scannerOn?'action-secondary':'action-primary'}>
           {scannerOn?<CameraOff size={20}/>:<Camera size={20}/>}
           {scannerOn?'ปิดกล้องสแกน':'เปิดกล้องสแกน QR'}
         </button>
         <button type="button" onClick={openWalkin} className="action-secondary"><UserCheck size={18}/>เพิ่มรายชื่อหน้างาน</button>
       </div>
       {/* Camera Viewport */}
       <div className="relative flex min-h-[240px] sm:min-h-[320px] items-center justify-center overflow-hidden rounded-[24px] bg-slate-950">
         <div className="absolute inset-0 opacity-30" style={{backgroundImage:'radial-gradient(#94a3b8 1px,transparent 1px)',backgroundSize:'20px 20px'}}/>
         <div className="absolute left-5 top-5 z-10 flex items-center gap-2 rounded-full bg-slate-900/80 px-3 py-2 text-[9px] font-semibold text-white">
           <span className={cx('h-2 w-2 rounded-full',scannerOn?'animate-pulse bg-emerald-400':'bg-slate-500')}/>
           {scannerOn?'กล้องเปิดอยู่':'กล้องปิดอยู่'}
         </div>
         <div id="aru-reader" className="relative z-[1] w-full max-w-[520px] overflow-hidden rounded-xl [&_video]:rounded-xl [&_video]:object-cover [&_img]:hidden"/>
         {!scannerOn&&<div className="absolute inset-0 z-[2] flex flex-col items-center justify-center px-6 text-center">
           <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-[26px] border border-white/15 bg-white/10 text-amber-300">
             <ScanLine size={32}/>
           </div>
           <b className="text-sm text-white">พร้อมสแกน QR Code</b>
           <span className="mt-1 max-w-xs text-[10px] leading-5 text-slate-400">แตะ “เปิดกล้องสแกน QR” แล้วให้นักศึกษาแสดง QR</span>
           <div className="pointer-events-none absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-[28px] border-2 border-amber-300/70"/>
         </div>}
         {scannerOn&&<div className="pointer-events-none absolute left-1/2 top-1/2 z-[2] h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-[28px] border-2 border-amber-300/80"/>}
         <ScanResultEffect message={scanMessage} flash={flash}/>
       </div>
       <div role="status" aria-live="polite" aria-atomic="true" className={cx('mt-3 rounded-xl border px-4 py-3',
         !scanMessage?'border-slate-200 bg-slate-50':scanMessage.ok?'border-emerald-200 bg-emerald-50':'border-rose-200 bg-rose-50')}>
         <p className="text-xs font-semibold text-slate-600">สถานะเครื่องสแกน</p>
         <p className="mt-1 break-words text-base font-bold text-slate-900">{scanMessage?.title || 'รอเปิดกล้อง'}</p>
         {scanMessage && <p className="mt-1 break-words text-sm text-slate-700">{scanMessage.detail}</p>}
       </div>

       <details className="mt-3"><summary className="cursor-pointer py-2 text-sm text-slate-600">ทดสอบด้วยข้อมูล QR</summary>
       <form className="mt-3 flex gap-2" onSubmit={e=>{e.preventDefault();void scanPayload(scanInput);setScanInput('')}}>
         <input value={scanInput} onChange={e=>setScanInput(e.target.value)} placeholder={isSupabaseConfigured?'วางข้อมูล QR จากบัตรกิจกรรม':'ทดสอบ QR Code · {"e":"event_id","u":"user_id"}'} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[10px]"/>
         <button className="rounded-xl bg-slate-900 px-4 text-[10px] font-bold text-white">ทดสอบ</button>
       </form>
       </details>
     </section>

     {/* Progress Sidebar */}
     <div className="space-y-5">
       <section className="bento p-5">
         <div className="flex items-center justify-between">
           <div>

             <h2 className="mt-1 text-sm font-extrabold text-slate-900">ความคืบหน้าการสแกน</h2>
           </div>
           <span className="rounded-xl bg-rose-50 p-2 text-[#7c0a02]"><Gauge size={19}/></span>
         </div>
         <div className="mt-5 flex items-center gap-5">
           <div className="relative h-28 w-40 overflow-hidden">
             <div className="absolute left-1/2 top-2 h-36 w-36 -translate-x-1/2 rounded-full border-[14px] border-slate-100"/>
             <div className="absolute left-1/2 top-2 h-36 w-36 -translate-x-1/2 rounded-full border-[14px] border-[#7c0a02]" style={{clipPath:'inset(0 0 50% 0)',transform:'translateX(-50%) rotate('+(pct*1.8-90)+'deg)'}}/>
             <div className="absolute inset-x-0 bottom-0 text-center">
               <b className="text-3xl text-slate-900">{pct}<small className="text-sm">%</small></b>
               <span className="block text-[8px] text-slate-400">เช็กอินแล้ว</span>
             </div>
           </div>
           <div className="flex-1 space-y-3">
             <StatLine label="ลงทะเบียนทั้งหมด" value={registered} icon={<Users size={14}/>} color="text-slate-500"/>
             <StatLine label="เช็กอินแล้ว" value={attendance} icon={<CheckCircle2 size={14}/>} color="text-emerald-600"/>
             <StatLine label="Passcode สำรอง" value={reserveLeft} icon={<Ticket size={14}/>} color="text-amber-600"/>
           </div>
         </div>
         <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
           <div className="h-full rounded-full bg-gradient-to-r from-rose-700 to-amber-400 transition-all" style={{width:pct+'%'}}/>
         </div>
       </section>
     </div>
   </div>

   {/* Lock Overlay */}
   {scannerLocked&&<div className="fixed inset-0 z-[100] flex touch-none select-none items-center justify-center bg-slate-950/80 p-5 text-center text-white backdrop-blur-md" onContextMenu={e=>e.preventDefault()}>
     <div className="max-w-sm rounded-[28px] border border-white/15 bg-slate-900/90 p-7 shadow-2xl">
       <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-300/15 text-amber-300">
         <Lock size={30}/>
       </div>
       <h2 className="mt-5 text-xl font-extrabold">หน้าจอเครื่องสแกนถูกล็อก</h2>
       <p className="mt-2 text-sm leading-6 text-slate-300">ป้องกันการแตะหรือคลิกโดยไม่ตั้งใจ · กล้องยังทำงานอยู่</p>
       <button onClick={toggleScannerLock} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-300 px-5 py-3 font-bold text-slate-950 transition hover:bg-amber-200">
         <Unlock size={17}/>
         ปลดล็อกหน้าจอ
       </button>
     </div>
   </div>}
 </div>;
}
function StatLine({label,value,icon,color}:{label:string;value:number;icon:React.ReactNode;color:string}){return <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-[9px] text-slate-500"><span className={color}>{icon}</span>{label}</span><b className="text-xs text-slate-800">{value}</b></div>}

function UserProfileSummary({user}:{user:User}){
  return <section className="bento relative overflow-hidden p-5 shadow-sm" aria-label="ข้อมูลบัญชีผู้ใช้">
    <div className="pointer-events-none absolute right-0 top-0 h-28 w-28 translate-x-8 -translate-y-8 rounded-full bg-amber-400/10 blur-xl"/>
    <div className="flex flex-wrap items-center justify-between gap-4">
      {/* User Identity */}
      <div className="flex min-w-0 sm:min-w-[240px] items-center gap-3.5">
        <div className="relative">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#7c0a02] to-[#b91c1c] text-base font-extrabold text-amber-200 shadow-md">
            {initials(user.full_name)}
          </span>
          <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-white">
            <span className="h-1.5 w-1.5 rounded-full bg-white"/>
          </span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <b className="text-sm font-extrabold text-slate-900">{user.full_name}</b>
            <RoleBadge role={user.role} size="sm"/>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono font-bold text-slate-700">
              {user.student_id}
            </span>
            {user.study_year > 0 && (
              <span className="rounded-md bg-amber-100/80 px-2 py-0.5 font-bold text-amber-800">
                ปี {user.study_year}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Meta Chips with category icons */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {user.faculty && (
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-1.5 text-[11px] font-semibold text-slate-700">
            <Building2 size={13} className="text-[#7c0a02]"/>
            <span className="text-slate-400">คณะ:</span> {user.faculty}
          </span>
        )}
        {user.major && (
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-1.5 text-[11px] font-semibold text-slate-700">
            <BookOpen size={13} className="text-amber-600"/>
            <span className="text-slate-400">สาขา:</span> {user.major}
          </span>
        )}
        {user.class_group && (
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-1.5 text-[11px] font-semibold text-slate-700">
            <Layers size={13} className="text-sky-600"/>
            <span className="text-slate-400">หมู่เรียน:</span> {user.class_group}
          </span>
        )}
        {user.phone && (
          <span className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-1.5 text-[11px] font-semibold text-slate-700">
            <Phone size={13} className="text-emerald-600"/>
            {user.phone}
          </span>
        )}
      </div>
    </div>
  </section>;
}

function AdminView({isImportingRef,importError,deleteBatch,sessionToken,store,academicCatalog,manageAcademicCatalog,selectedEvent,selectedEventId,setSelectedEvent,openCreate,openCodes,openStaff,editUser,deleteUser,deleteActivity,deleteRegistration,csvFile,setCsvFile,importCsv,refreshWorkspace,loadEventDashboard,updateEvent}:{isImportingRef:React.MutableRefObject<boolean>;importError:string;deleteBatch:(kind:'students'|'codes',values:string[])=>Promise<boolean|undefined>;sessionToken:string;store:Store;academicCatalog:AcademicFaculty[];manageAcademicCatalog:(action:CatalogAction,facultyId:string,facultyName:string,majorId:string,majorName:string)=>unknown;selectedEvent:Event;selectedEventId:string;setSelectedEvent:(id:string)=>void;openCreate:()=>void;openCodes:()=>void;openStaff:()=>void;editUser:(user:User)=>void;deleteUser:(user:User)=>void;deleteActivity:()=>void;deleteRegistration:(userId:string)=>void;csvFile:File|null;setCsvFile:(f:File|null)=>void;importCsv:(roster?:boolean)=>void;refreshWorkspace:()=>Promise<void>;loadEventDashboard:()=>Promise<EventDashboardRow[]>;updateEvent:(p:Partial<Event>)=>void|Promise<void>}) {
 const [correction,setCorrection]=useState<{reg:Registration;name:string}|null>(null);
 const [nextStatus,setNextStatus]=useState<Registration['status']>('REGISTERED');
 const [correctionReason,setCorrectionReason]=useState('');
 const [correctionError,setCorrectionError]=useState('');
 const [correcting,setCorrecting]=useState(false);
 useEffect(()=>setCorrection(null),[selectedEventId]);
 async function saveCorrection(e:React.FormEvent){
   e.preventDefault();if(!correction||correcting)return;
   setCorrecting(true);setCorrectionError('');
   try{
     if(!supabase)throw new Error('กรุณาเชื่อมต่อระบบฐานข้อมูล');
     const {error}=await supabase.rpc('admin_correct_attendance',{p_token:sessionToken,p_event:correction.reg.event_id,p_user:correction.reg.user_id,p_expected_status:correction.reg.status,p_status:nextStatus,p_reason:correctionReason.trim()});
     if(error)throw error;
     await refreshWorkspace();setDashboardRows(await loadEventDashboard());setCorrection(null);
   }catch(error){setCorrectionError(error instanceof Error?error.message:(error as {message?:string}).message||'บันทึกไม่สำเร็จ');}
   finally{setCorrecting(false);}
 }
 const removePasscodes=useCallback((values:string[])=>deleteBatch('codes',values),[deleteBatch]);
 const [managementPanel,setManagementPanel]=useState<'registration'|'passcodes'|'settings'|null>(null);
 useEffect(()=>setManagementPanel(null),[selectedEventId]);
 const [adminTab, setAdminTab] = useState<'dashboard' | 'events' | 'report' | 'users' | 'catalog' | 'all'>('dashboard');
 const [redirectDraft,setRedirectDraft]=useState(selectedEvent.redirect_url_year1);
 const [bannerDraft,setBannerDraft]=useState(selectedEvent.banner_url||'');
 const [dashboardRows,setDashboardRows]=useState<EventDashboardRow[]>([]);
 const [dashboardLive,setDashboardLive]=useState(false);
 const [userQuery,setUserQuery]=useState('');
 const [accountFilters,setAccountFilters]=useState({role:'',faculty:'',major:'',study_year:'',class_group:''});
 const [newFaculty,setNewFaculty]=useState('');
 const [newMajor,setNewMajor]=useState<Record<string,string>>({});
 const [facultyDrafts,setFacultyDrafts]=useState<Record<string,string>>({});
 const [majorDrafts,setMajorDrafts]=useState<Record<string,string>>({});
 const saveCatalogItem=(action:CatalogAction,faculty:AcademicFaculty,facultyName='',major?:AcademicMajor,majorName='')=>{
  if(action==='DELETE_FACULTY'&&!window.confirm(`ลบคณะ “${faculty.name}” และสาขาทั้งหมดในคณะนี้หรือไม่?`))return;
  if(action==='DELETE_MAJOR'&&major&&!window.confirm(`ลบสาขา “${major.name}” หรือไม่?`))return;
  void manageAcademicCatalog(action,faculty.id,facultyName,major?.id||'',majorName);
 };
 useEffect(()=>setRedirectDraft(selectedEvent.redirect_url_year1),[selectedEvent.id,selectedEvent.redirect_url_year1]);
 useEffect(()=>setBannerDraft(selectedEvent.banner_url||''),[selectedEvent.id,selectedEvent.banner_url]);
 useEffect(()=>{void refreshWorkspace();},[refreshWorkspace]);
  useEffect(()=>{
    const client=supabase;
    let active=true;
    let channel:ReturnType<NonNullable<typeof client>['channel']>|undefined;
    let fallbackTimer:number|undefined;
    let debounceTimer:ReturnType<typeof setTimeout>|undefined;
    const refresh=async()=>{const rows=await loadEventDashboard();if(active)setDashboardRows(rows);};
    const startFallback=()=>{if(!active)return;setDashboardLive(false);if(!fallbackTimer)fallbackTimer=window.setInterval(()=>{if(!isImportingRef.current){void refresh();void refreshWorkspace();}},10000);};
    const stopFallback=()=>{if(fallbackTimer){window.clearInterval(fallbackTimer);fallbackTimer=undefined;}};
    void refresh();
    void refreshWorkspace();
    if(!client||!sessionToken)return()=>{active=false;};
    void hashSessionToken(sessionToken).then(tokenHash=>{
      if(!active)return;
      channel=client.channel(`aru-admin-dashboard:${tokenHash}`,{config:{private:true}})
        .on('broadcast',{event:'dashboard_changed'},({payload})=>{
          if(debounceTimer)clearTimeout(debounceTimer);
          debounceTimer=setTimeout(()=>{
            void refresh();
            if(payload?.source_table!=='app_sessions' && !isImportingRef.current)void refreshWorkspace();
          },1500);
        })
        .subscribe(status=>{
          if(status==='SUBSCRIBED'){setDashboardLive(true);stopFallback();void refresh();}
          else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED')startFallback();
        });
    }).catch(()=>{if(active)startFallback();});
    return()=>{active=false;if(debounceTimer)clearTimeout(debounceTimer);stopFallback();if(channel)void client.removeChannel(channel);};
  },[loadEventDashboard,refreshWorkspace,sessionToken,isImportingRef]);
 const regs=store.regs.filter(r=>r.event_id===selectedEventId),reserves=store.codes.filter(c=>c.event_id===selectedEventId&&c.is_reserve),remaining=reserves.filter(c=>!c.assigned_to).length,completed=regs.filter(r=>r.status==='COMPLETED').length;
  const [reportStudyYear,setReportStudyYear]=useState('ALL'),[reportFaculty,setReportFaculty]=useState('ALL'),[reportMajor,setReportMajor]=useState('ALL'),[reportClassGroup,setReportClassGroup]=useState('ALL'),[reportStatus,setReportStatus]=useState<'ALL'|'ATTENDED'|'NO_CHECKIN'|'NO_CHECKOUT'>('ATTENDED');
  const reportPeople=useMemo(()=>new Map(store.users.map(person=>[person.id,person])),[store.users]);
 const reportPopulation=regs.map(reg=>({reg,person:reportPeople.get(reg.user_id)})).filter((row):row is {reg:Registration;person:User}=>Boolean(row.person));
  const reportStudyYears=Array.from(new Set(reportPopulation.map(row=>row.person.study_year).filter(year=>year>0))).sort((a,b)=>a-b);
  const reportFaculties=Array.from(new Set(reportPopulation.map(row=>row.person.faculty))).sort();
  const optionRows=reportPopulation.filter(row=>(reportStudyYear==='ALL'||String(row.person.study_year)===reportStudyYear)&&(reportFaculty==='ALL'||row.person.faculty===reportFaculty));
 const reportMajors=Array.from(new Set(optionRows.map(row=>row.person.major))).sort();
 const reportClassGroups=Array.from(new Set(optionRows.filter(row=>reportMajor==='ALL'||row.person.major===reportMajor).map(row=>row.person.class_group).filter(Boolean))).sort();
  const selectedReportRows=reportPopulation.filter(row=>(reportStudyYear==='ALL'||String(row.person.study_year)===reportStudyYear)&&(reportFaculty==='ALL'||row.person.faculty===reportFaculty)&&(reportMajor==='ALL'||row.person.major===reportMajor)&&(reportClassGroup==='ALL'||row.person.class_group===reportClassGroup)&&(reportStatus==='ALL'||(reportStatus==='ATTENDED'&&row.reg.status!=='REGISTERED')||(reportStatus==='NO_CHECKIN'&&row.reg.status==='REGISTERED')||(reportStatus==='NO_CHECKOUT'&&row.reg.status==='ATTENDING')));
  const groupedCounts=Array.from(selectedReportRows.reduce((map,row)=>{const key=row.person.faculty+'\u0000'+row.person.major;map.set(key,(map.get(key)||0)+1);return map;},new Map<string,number>()).entries()).map(([key,count])=>({faculty:key.split('\u0000')[0],major:key.split('\u0000')[1],count}));
  const noCheckinCount=regs.filter(reg=>reg.status==='REGISTERED').length,noCheckoutCount=regs.filter(reg=>reg.status==='ATTENDING').length,attendedCount=regs.filter(reg=>reg.status!=='REGISTERED').length;
 const accountFields = [
   ['role','ประเภทบัญชี'],['faculty','คณะ / หน่วยงาน'],['major','สาขา / ฝ่าย'],
   ['study_year','ชั้นปี'],['class_group','หมู่เรียน'],
 ] as const;
 type AccountField = typeof accountFields[number][0];
 function accountValue(account:User,field:AccountField) {
   if (field==='study_year') return account.role==='STUDENT' && account.study_year ? String(account.study_year) : '';
   return account[field] || '';
 }
 let matchingAccounts=store.users.filter(account=>account.role==='STUDENT'||account.role==='STAFF');
 const accountControls=accountFields.map(([field,label],index)=>{
   const selected=accountFilters[field];
   const options=new Set(matchingAccounts.map(account=>accountValue(account,field)).filter(Boolean));
   if (selected) options.add(selected);
   if (selected) matchingAccounts=matchingAccounts.filter(account=>accountValue(account,field)===selected);
   return <label key={field} className="min-w-0 text-xs font-semibold text-slate-700">{label}
     <select value={selected} disabled={field==='study_year' && accountFilters.role==='STAFF'}
       onChange={e=>{
         const next={...accountFilters,[field]:e.target.value};
         for (const [child] of accountFields.slice(index+1)) next[child]='';
         setStudentIds([]);setAccountFilters(next);
       }} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-2 disabled:bg-slate-100">
       <option value="">ทั้งหมด</option>
       {[...options].sort((a,b)=>a.localeCompare(b,'th',{numeric:true})).map(value=>
         <option key={value} value={value}>{field==='role'?roleName(value as Role):field==='study_year'?'ปี '+value:value}</option>)}
     </select>
   </label>;
 });
 const query=userQuery.trim().toLocaleLowerCase('th');
 const managedUsers=matchingAccounts.filter(account=>[account.full_name,account.student_id,account.faculty,account.major,account.class_group]
   .some(value=>value?.toLocaleLowerCase('th').includes(query)));
 const [userPage,setUserPage]=useState(0);
 const userPageSize=24;
 const totalUserPages=Math.max(1,Math.ceil(managedUsers.length/userPageSize));
 useEffect(()=>{setUserPage(0);},[userQuery,accountFilters]);
 const paginatedUsers=managedUsers.slice(userPage*userPageSize,(userPage+1)*userPageSize);

  const [studentIds,setStudentIds]=useState<string[]>([]);
  const attendingIds=new Set(store.regs.filter(r=>r.status==='ATTENDING').map(r=>r.user_id));
  const eligibleStudents=managedUsers.filter(u=>u.role==='STUDENT' && !attendingIds.has(u.id)).map(u=>u.id);
  const checkedIds=new Set(studentIds);
  const selectedStudents=eligibleStudents.filter(id=>checkedIds.has(id));

  function exportAttendance(allRegistered=false){const rows=allRegistered?reportPopulation:selectedReportRows;const csvRows=[['รหัสนักศึกษา','ชื่อ-นามสกุล','ชั้นปี','คณะ','สาขาวิชา','หมู่เรียน','เบอร์โทรศัพท์','สถานะ','เวลาเช็กอิน','ผู้เช็กอิน','เวลาเช็กเอาต์','สตาฟเช็กเอาต์'],...rows.map(({reg,person})=>[person.student_id,person.full_name,person.study_year,person.faculty,person.major,person.class_group,person.phone||'',({REGISTERED:'รอสแกนเข้างาน',ATTENDING:'กำลังเข้าร่วมกิจกรรม',COMPLETED:'เข้าร่วมกิจกรรมสำเร็จ'}[reg.status]),reg.checkin_at||'',reg.checkin_station?'เครื่องลงทะเบียน iPad':reg.checkin_staff_name||store.users.find(u=>u.id===reg.checked_in_by)?.full_name||'',reg.checkout_at||'',reg.checkout_staff_name||store.users.find(u=>u.id===reg.checked_out_by)?.full_name||''])];const quote=(value:string|number)=>{const text=String(value);return '"'+(/^[=+@\-\t\r\n]/.test(text)?"'":'')+text.replace(/"/g,'""')+'"';};const csv='\uFEFF'+csvRows.map(row=>row.map(quote).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='aru-attendance-'+(allRegistered?'registered-all':reportStatus.toLowerCase())+'-'+selectedEventId+'.csv';link.click();URL.revokeObjectURL(url);}
 return <div className="space-y-6">
  {correction&&<Modal title="แก้สถานะเข้าร่วมกิจกรรม" subtitle={correction.name} close={()=>{if(!correcting)setCorrection(null);}}>
    <form onSubmit={saveCorrection} className="space-y-4">
      <div className="flex items-center gap-2 text-sm">สถานะปัจจุบัน <StatusPill status={correction.reg.status}/></div>
      <label className="block text-sm font-bold">เปลี่ยนเป็น
        <select value={nextStatus} onChange={e=>setNextStatus(e.target.value as Registration['status'])} disabled={correcting} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 p-3">
          <option value="REGISTERED">รอสแกนเข้างาน</option><option value="ATTENDING">กำลังเข้าร่วมกิจกรรม</option><option value="COMPLETED">เข้าร่วมกิจกรรมสำเร็จ</option>
        </select>
      </label>
      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{nextStatus==='REGISTERED'?'ล้างเวลาเข้าและออก เพื่อให้สแกนเข้างานใหม่':nextStatus==='ATTENDING'?'ล้างเวลาออก หากยังไม่มีเวลาเข้า จะใช้เวลาที่บันทึกนี้':'หากยังไม่มีเวลาเข้า–ออก จะใช้เวลาที่บันทึกนี้'} · QR เดิมจะถูกยกเลิก และเก็บ Passcode ที่จับคู่ไว้</p>
      <label className="block text-sm font-bold">เหตุผลที่แก้ไข<textarea required maxLength={500} disabled={correcting} value={correctionReason} onChange={e=>setCorrectionReason(e.target.value)} placeholder="เช่น สตาฟสแกนออกงานผิดคน" className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 p-3"/></label>
      {correctionError&&<p role="alert" className="text-sm text-red-700">{correctionError}</p>}
      <button disabled={correcting||nextStatus===correction.reg.status||!correctionReason.trim()} className="action-primary w-full"><Save size={18}/>{correcting?'กำลังบันทึก…':'ยืนยันเปลี่ยนสถานะ'}</button>
    </form>
  </Modal>}
  {/* Header Section */}
  <div className="flex flex-wrap items-end justify-between gap-3 px-2">
    <div>
      <h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">พื้นที่ผู้ดูแลระบบ</h1>
    </div>
    <div className="flex gap-2">
      <button onClick={openStaff} className="flex items-center gap-2 rounded-full border border-slate-200 bg-white min-h-11 px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-[#7c0a02] hover:text-[#7c0a02]">
        <Users size={14}/>
        เพิ่มผู้ใช้
      </button>
      <button onClick={openCreate} className="flex items-center gap-2 rounded-full bg-gradient-to-r from-[#7c0a02] to-[#a31508] min-h-11 px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-rose-900/20 transition hover:shadow-lg">
        <Plus size={14}/>
        สร้างกิจกรรมใหม่
      </button>
    </div>
  </div>

  <nav aria-label="เมนูผู้ดูแลระบบ" className="grid grid-cols-2 gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm sm:grid-cols-3 xl:grid-cols-6">
    {([
      ['dashboard','ภาพรวม',Activity],
      ['events','จัดการกิจกรรม',BookOpen],
      ['report','รายงานผู้เข้าร่วม',FileSpreadsheet],
      ['users','บัญชีผู้ใช้',Users],
      ['catalog','คณะและสาขา',Building2],
      ['all','แสดงทั้งหมด',Layers],
    ] as const).map(([tab,label,Icon])=>(
      <button key={tab} type="button" aria-pressed={adminTab===tab} onClick={()=>setAdminTab(tab)}
        className={cx('flex min-h-11 items-center justify-center gap-2 rounded-xl px-2 text-sm font-bold transition',
          adminTab===tab?'bg-[#7c0a02] text-white':'text-slate-600 hover:bg-rose-50 hover:text-[#7c0a02]')}>
        <Icon size={16}/>{label}
      </button>
    ))}
  </nav>
  {adminTab!=='users' && adminTab!=='catalog' && (
    <label className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm font-bold text-slate-700 sm:flex-row sm:items-center sm:gap-5">
      กิจกรรมที่เลือก
      <select value={selectedEventId} onChange={e=>setSelectedEvent(e.target.value)} disabled={!store.events.length}
        className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 font-semibold">
        {!store.events.length && <option value="">ยังไม่มีกิจกรรม</option>}
        {store.events.map(event=><option key={event.id} value={event.id}>{event.title}</option>)}
      </select>
    </label>
  )}
  {(adminTab==='dashboard' || adminTab==='all') && (
<div className="grid grid-cols-2 gap-2 sm:gap-4 xl:grid-cols-4">
    <AdminMetric label="กิจกรรมทั้งหมด" value={store.events.length} note="รายการในระบบ" icon={<Activity size={18}/>} tone="rose"/>
    <AdminMetric label="นักศึกษาทั้งระบบ" value={store.users.filter(u=>u.role==='STUDENT').length} note="บัญชีนักศึกษา" icon={<Users size={18}/>} tone="gold"/>
    <AdminMetric label="ลงทะเบียนกิจกรรมนี้" value={regs.length} note={selectedEvent.title} icon={<QrCode size={18}/>} tone="blue"/>
    <AdminMetric label="เข้าร่วมครบแล้ว" value={completed} note="เช็กเอาต์สำเร็จ" icon={<CheckCircle2 size={18}/>} tone="green"/>
  </div>
  )}
  {store.events.length>0 && ['dashboard','events','all'].includes(adminTab) &&
    <div className="grid gap-3 lg:grid-cols-3">
      {([
        {id:'registration',title:'รับสมัครและอนุมัติรายชื่อ',detail:'เปิดรับสมัคร ตรวจรายชื่อ และส่งออก CSV',icon:UserCheck},
        {id:'passcodes',title:'จัดการ Passcode',detail:'ค้นหา ตรวจสถานะ เพิ่มและลบรหัส',icon:Ticket},
        {id:'settings',title:'เครื่อง iPad และช่องทางติดต่อ',detail:'ตั้งค่าบัญชีเครื่องและลิงก์ติดต่อแอดมิน',icon:Settings2},
      ] as const).map(item=><button key={item.id} type="button" aria-haspopup="dialog" onClick={()=>setManagementPanel(item.id)}
        className="flex min-h-24 items-center gap-3 rounded-2xl border border-slate-300 bg-white p-4 text-left hover:border-[#7c0a02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7c0a02]">
        <span className="rounded-xl bg-rose-50 p-3 text-[#7c0a02]"><item.icon size={22}/></span>
        <span className="min-w-0 flex-1"><strong className="block text-sm">{item.title}</strong><span className="mt-1 block text-xs text-slate-600">{item.detail}</span></span>
        <ChevronRight size={20}/>
      </button>)}
    </div>}
  {managementPanel && <Modal wide title={managementPanel==='registration'?'รับสมัครและอนุมัติรายชื่อ':managementPanel==='settings'?'ตั้งค่าเครื่อง iPad และช่องทางติดต่อ':'จัดการ Passcode'}
    subtitle={selectedEvent.title} close={()=>setManagementPanel(null)}>
    {managementPanel==='passcodes'
      ? <PasscodeList key={selectedEventId} eventId={selectedEventId} store={store} openCodes={openCodes} remove={removePasscodes} token={sessionToken} refresh={refreshWorkspace}/>
      : <RegistrationAdmin key={selectedEvent.id+managementPanel} mode={managementPanel==='settings'?'settings':'queue'} token={sessionToken} eventId={selectedEvent.id} refresh={refreshWorkspace}/>}
  </Modal>}
  {/* TAB 1: Dashboard Section */}
  {(adminTab === 'all' || adminTab === 'dashboard') && (
    <section className="bento p-5 sm:p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <h2 className="text-base font-extrabold text-slate-900">แดชบอร์ดกิจกรรมแบบเรียลไทม์</h2>
          <p className="mt-0.5 text-[10px] text-slate-500">จำนวนผู้เข้าร่วมและผู้ใช้งานออนไลน์ แยกตามกิจกรรม · อัปเดตผ่าน Supabase Realtime</p>
        </div>
        <span className={cx('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[9px] font-extrabold shadow-sm',dashboardLive?'bg-emerald-50 text-emerald-700 border border-emerald-200':'bg-amber-50 text-amber-800 border border-amber-200')}>
          <i className={cx('h-1.5 w-1.5 rounded-full',dashboardLive?'animate-pulse bg-emerald-500':'bg-amber-500')}/>
          {dashboardLive?'LIVE REALTIME':'RECONNECTING'}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {dashboardRows.map(row=><article key={row.event_id} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm hover:shadow-md transition">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <b className="block truncate text-xs font-extrabold text-slate-900">{row.title}</b>
              <div className="mt-1 flex items-center gap-1.5">
                <EventStatusPill status={row.status}/>
                <span className="text-[9px] text-slate-400 font-semibold">{row.registered_count} รายชื่อ</span>
              </div>
            </div>
            <Activity size={16} className="shrink-0 text-[#7c0a02]"/>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <DashboardCount icon={<ArrowDownRight size={14}/>} label="เช็กอินแล้ว" value={row.checked_in_count} tone="text-emerald-700 bg-emerald-50"/>
            <DashboardCount icon={<ArrowUpRight size={14}/>} label="เช็กเอาต์แล้ว" value={row.checked_out_count} tone="text-amber-700 bg-amber-50"/>
            <DashboardCount icon={<Users size={14}/>} label="นักศึกษาออนไลน์" value={row.online_students} tone="text-sky-700 bg-sky-50"/>
            <DashboardCount icon={<ScanLine size={14}/>} label="สตาฟออนไลน์" value={row.online_staff} tone="text-rose-800 bg-rose-50"/>
          </div>
        </article>)}
        {dashboardRows.length===0&&<p className="col-span-full rounded-xl bg-slate-50 p-6 text-center text-xs text-slate-400">กำลังโหลดข้อมูลกิจกรรม…</p>}
      </div>
    </section>
  )}

  {/* TAB 2: Events & Codes Management */}
  {(adminTab === 'all' || adminTab === 'events') && (
    <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
      <section className="bento p-5 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">การจัดการกิจกรรม</h2>
            <p className="mt-0.5 text-[10px] text-slate-500">เลือกและตั้งค่าการลงทะเบียนของแต่ละกิจกรรม</p>
          </div>

        </div>
        <div className="mt-4 rounded-2xl border border-slate-200/80 bg-cover bg-center p-4 shadow-sm" style={selectedEvent.banner_url?{backgroundImage:`linear-gradient(90deg,rgba(255,255,255,.94) 0%,rgba(255,255,255,.84) 62%,rgba(255,255,255,.68) 100%),url("${selectedEvent.banner_url}")`}:undefined}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <EventStatusPill status={selectedEvent.status}/>
              <h3 className="mt-2 text-sm font-extrabold text-slate-900">{selectedEvent.title}</h3>
              <p className="mt-1 text-[10px] text-slate-500">{selectedEvent.location} · {selectedEvent.activity_hours} ชั่วโมง</p>
            </div>
            <span className="rounded-xl bg-rose-50 p-2 text-[#7c0a02]"><BookOpen size={18}/></span>
          </div>
          <form key={selectedEventId} className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4" onSubmit={e=>{
            e.preventDefault();const form=new FormData(e.currentTarget);
            const title=String(form.get('title')||'').trim(),location=String(form.get('location')||'').trim();
            if(!title||!location)return;
            void updateEvent({title,location,activity_hours:Number(form.get('hours'))});
          }}>
            <h4 className="text-sm font-bold text-slate-800">แก้ไขข้อมูลกิจกรรม</h4>
            <Field label="ชื่อกิจกรรม" name="title" required maxLength={255} defaultValue={selectedEvent.title}/>
            <Field label="สถานที่จัดกิจกรรม" name="location" required maxLength={255} defaultValue={selectedEvent.location||''} placeholder="เช่น หอประชุมมหาวิทยาลัย"/>
            <Field label="ชั่วโมงกิจกรรม" name="hours" type="number" required min="1" max="2147483647" step="1" defaultValue={String(selectedEvent.activity_hours)}/>
            <button type="submit" className="action-primary w-full"><Save size={16}/>บันทึกข้อมูลกิจกรรม</button>
          </form>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[10px] font-semibold text-slate-500">URL Redirect · รุ่นปี 1</label>
              <div className="mt-1 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <input type="url" value={redirectDraft} onChange={e=>setRedirectDraft(e.target.value)} placeholder="https://..." className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 text-[10px]"/>
                <button type="button" onClick={()=>void updateEvent({redirect_url_year1:redirectDraft})} className="action-primary"><Save size={16}/>บันทึกลิงก์</button>
              </div>
            </div>
            <label className="text-[10px] font-semibold text-slate-500">สถานะกิจกรรม
              <select value={selectedEvent.status} onChange={e=>updateEvent({status:e.target.value as Event['status']})} className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-[10px]">
                <option value="ACTIVE">เปิดใช้งาน (Active)</option>
                <option value="UPCOMING">กำลังจะมาถึง (Upcoming)</option>
                <option value="CLOSED">ปิดกิจกรรม (Closed)</option>
              </select>
            </label>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
            <label className="text-[10px] font-semibold text-slate-500">ภาพแบนเนอร์กิจกรรม
              <input type="url" value={bannerDraft} onChange={e=>setBannerDraft(e.target.value)} placeholder="วาง URL รูปภาพโดยตรง เช่น https://..." className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-[10px]"/>
            </label>
            <button type="button" onClick={()=>void updateEvent({banner_url:bannerDraft})} className="action-primary self-end"><Save size={16}/>บันทึกแบนเนอร์</button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 pt-2 border-t border-slate-100">
            <button onClick={deleteActivity} className="action-danger">
              <Trash2 size={13}/>
              ลบกิจกรรมนี้
            </button>
            <button onClick={openCodes} className="action-secondary">
              <Ticket size={13}/>
              เติม Passcode สำรอง
            </button>
            <span className="rounded-lg bg-slate-100 px-3 py-2 text-[9px] text-slate-600 font-medium">เหลือ <b className="text-slate-900 font-bold">{remaining}</b> / {reserves.length} รหัสสำรอง</span>
          </div>
        </div>

        {/* CSV Import Section */}
        <div className="mt-6 border-t border-slate-100 pt-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-extrabold text-slate-900">นำเข้ารายชื่อนักศึกษาผ่าน CSV</h3>
              <p className="mt-0.5 text-[9px] text-slate-500">student_id, full_name, faculty, major, class_group, study_year, birth_date, phone</p>
              <p className="mt-0.5 text-[9px] text-slate-400">รองรับหัวตารางภาษาไทยหรืออังกฤษ · ชั้นปีปัจจุบัน 1–8</p>
            </div>
            <FileUp size={17} className="text-slate-400"/>
          </div>
          <label className="mt-3 flex cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-sky-700 items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center text-[10px] text-slate-500 hover:border-amber-400 hover:bg-amber-50/50 transition">
            <Download size={15}/>
            {csvFile?csvFile.name:'เลือกไฟล์ CSV'}
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={e=>setCsvFile(e.target.files?.[0]||null)}/>
          </label>
          <button disabled={!csvFile} onClick={()=>importCsv()} className="action-primary mt-2 w-full">
            นำเข้ารายชื่อและจับคู่ Passcode อัตโนมัติ
          </button>
        </div>
      </section>

      {/* Right column: Passcodes Pool + All Events */}
      <div className="space-y-5">

        <div className="bento p-5 shadow-sm">
          <h2 className="text-sm font-extrabold text-slate-900">กิจกรรมทั้งหมดในระบบ</h2>
          <div className="mt-3 space-y-2">
            {store.events.map((e,i)=><button key={e.id} onClick={()=>setSelectedEvent(e.id)} style={e.banner_url?{backgroundImage:`linear-gradient(90deg,rgba(255,255,255,.96),rgba(255,255,255,.76)),url("${e.banner_url}")`,backgroundSize:'cover',backgroundPosition:'center'}:undefined} className={cx('flex w-full items-center gap-3 rounded-xl p-3 text-left transition',e.id===selectedEventId?'bg-rose-50 border border-rose-200 shadow-sm':'bg-slate-50 hover:bg-slate-100')}>
              <span className={cx('flex h-8 w-8 items-center justify-center rounded-lg text-[9px] font-bold',i===0?'bg-[#7c0a02] text-white':'bg-white text-slate-600 shadow-sm')}>0{i+1}</span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[11px] font-bold text-slate-800">{e.title}</b>
                <small className="text-[9px] text-slate-400">{store.regs.filter(r=>r.event_id===e.id).length} ลงทะเบียน</small>
              </span>
              <EventStatusPill status={e.status}/>
            </button>)}
          </div>
        </div>
      </div>
    </div>
  )}

  {/* TAB 3: Attendance Report & Registered Students */}
  {(adminTab === 'all' || adminTab === 'report') && (
    <div className="space-y-5">
      <section className="bento overflow-hidden shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-extrabold text-slate-900">รายงานผู้เข้าร่วมกิจกรรม</h2>
            <p className="mt-0.5 text-[9px] text-slate-500">
              {reportStatus==='NO_CHECKIN'?'ลงทะเบียนแล้วแต่ไม่เช็กอิน · ไม่เข้าร่วม':reportStatus==='NO_CHECKOUT'?'เช็กอินแล้วแต่ยังไม่เช็กเอาต์':reportStatus==='ALL'?'รายชื่อทั้งหมดและสถานะ':'รายชื่อผู้เช็กอินแล้ว'} · {selectedEvent.title}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={reportStatus} onChange={e=>setReportStatus(e.target.value as typeof reportStatus)} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-bold shadow-sm">
              <option value="ALL">ทุกรายชื่อ ({reportPopulation.length})</option>
              <option value="ATTENDED">เช็กอินแล้ว ({attendedCount})</option>
              <option value="NO_CHECKIN">ไม่เช็กอิน / ไม่เข้าร่วม ({noCheckinCount})</option>
              <option value="NO_CHECKOUT">ยังไม่เช็กเอาต์ ({noCheckoutCount})</option>
            </select>
            <select value={reportStudyYear} onChange={e=>{setReportStudyYear(e.target.value);setReportMajor('ALL');setReportClassGroup('ALL')}} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px]">
              <option value="ALL">ทุกชั้นปี</option>
              {reportStudyYears.map(year=><option key={year} value={year}>ปี {year}</option>)}
            </select>
            <select value={reportFaculty} onChange={e=>{setReportFaculty(e.target.value);setReportMajor('ALL');setReportClassGroup('ALL')}} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px]">
              <option value="ALL">ทุกคณะ</option>
              {reportFaculties.map(f=><option key={f}>{f}</option>)}
            </select>
            <select value={reportMajor} onChange={e=>{setReportMajor(e.target.value);setReportClassGroup('ALL')}} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px]">
              <option value="ALL">ทุกสาขา</option>
              {reportMajors.map(m=><option key={m}>{m}</option>)}
            </select>
            <select value={reportClassGroup} onChange={e=>setReportClassGroup(e.target.value)} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[10px]">
              <option value="ALL">ทุกหมู่เรียน</option>
              {reportClassGroups.map(group=><option key={group}>{group}</option>)}
            </select>
            <button onClick={()=>exportAttendance()} className="action-secondary">
              <Download size={13}/>
              ส่งออกผู้เข้าร่วม CSV ({selectedReportRows.length})
            </button>
          </div>
        </div>

        {/* Breakdown by Faculty & Major */}
        <div className="grid gap-2 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4 bg-slate-50/50">
          {groupedCounts.map(item=><div key={item.faculty+item.major} className="rounded-xl border border-slate-200/70 bg-white px-3.5 py-2.5 shadow-xs">
            <span className="block truncate text-[8px] font-semibold text-slate-400">{item.faculty}</span>
            <b className="block truncate text-[10px] text-slate-800">{item.major}</b>
            <span className="mt-1 block text-[11px] font-extrabold text-[#7c0a02]">{item.count} คน</span>
          </div>)}
          {groupedCounts.length===0&&<p className="col-span-full rounded-xl bg-white p-4 text-center text-xs text-slate-400">ไม่มีรายชื่อตรงกับตัวกรองนี้</p>}
        </div>

        {/* Detailed Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] text-left">
            <thead className="bg-slate-50 text-[9px] font-bold uppercase tracking-wider text-slate-400 border-y border-slate-100">
              <tr>
                <th className="px-4 py-3">ผู้เข้าร่วม</th>
                <th className="px-4 py-3">ชั้นปี</th>
                <th className="px-4 py-3">คณะ</th>
                <th className="px-4 py-3">สาขาวิชา</th>
                <th className="px-4 py-3">หมู่เรียน</th>
                <th className="px-4 py-3">เบอร์โทร</th>
                <th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3">เวลาเช็กอิน</th>
                <th className="px-4 py-3">สตาฟเช็กอิน</th>
                <th className="px-4 py-3">เวลาเช็กเอาต์</th>
                <th className="px-4 py-3">สตาฟเช็กเอาต์</th>
                <th className="px-4 py-3">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {selectedReportRows.map(({reg,person})=>{
                const checkinStaff=reg.checkin_staff_name||store.users.find(u=>u.id===reg.checked_in_by)?.full_name;
                const checkoutStaff=reg.checkout_staff_name||store.users.find(u=>u.id===reg.checked_out_by)?.full_name;
                return <tr key={reg.user_id} className="text-[10px] hover:bg-slate-50/80 transition">
                  <td className="px-5 py-3"><b className="block text-slate-800 font-bold">{person.full_name}</b><small className="font-mono text-[9px] text-slate-400">{person.student_id}</small></td>
                  <td className="px-4 py-3 text-slate-600 font-semibold">ปี {person.study_year||'—'}</td>
                  <td className="px-4 py-3 text-slate-600">{person.faculty}</td>
                  <td className="px-4 py-3 text-slate-600">{person.major}</td>
                  <td className="px-4 py-3 text-slate-600">{person.class_group||'—'}</td>
                  <td className="px-4 py-3 text-slate-600 font-mono">{person.phone||'—'}</td>
                  <td className="px-4 py-3"><StatusPill status={reg.status}/></td>
                  <td className="px-4 py-3 text-slate-600 font-mono">{reg.checkin_at?new Date(reg.checkin_at).toLocaleString('th-TH'):'—'}</td>
                  <td className="px-4 py-3 text-slate-600">{checkinStaff||'—'}</td>
                  <td className="px-4 py-3 text-slate-600 font-mono">{reg.checkout_at?new Date(reg.checkout_at).toLocaleString('th-TH'):'—'}</td>
                  <td className="px-4 py-3 text-slate-600">{checkoutStaff||'—'}</td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-2"><button className="action-secondary" onClick={()=>{setCorrection({reg,name:person.full_name+" · "+person.student_id});setNextStatus(reg.status);setCorrectionReason('');setCorrectionError('');}}>แก้สถานะ</button><button onClick={()=>deleteRegistration(reg.user_id)} title="ลบการลงทะเบียนกิจกรรม" aria-label="ลบการลงทะเบียนกิจกรรม" className="action-danger" ><Trash2 size={14}/></button></div></td>
                </tr>;
              })}
              {selectedReportRows.length===0&&<tr><td colSpan={12} className="p-8 text-center text-xs text-slate-400">ไม่มีรายชื่อในหมวดนี้</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bento overflow-hidden shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-extrabold text-slate-900">รายชื่อนักศึกษาที่ลงทะเบียนกิจกรรมนี้</h2>
            <p className="mt-0.5 text-[9px] text-slate-500">{selectedEvent.title}</p>
          </div>
          <button onClick={()=>exportAttendance(true)} disabled={!reportPopulation.length} className="action-primary"><Download size={16}/>ส่งออกรายชื่อ CSV ({reportPopulation.length})</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left">
            <thead className="bg-slate-50 text-[9px] font-bold uppercase tracking-wider text-slate-400 border-y border-slate-100">
              <tr>
                <th className="px-4 py-3">นักศึกษา</th>
                <th className="px-4 py-3">ชั้นปี</th>
                <th className="px-4 py-3">คณะ</th>
                <th className="px-4 py-3">สาขาวิชา</th>
                <th className="px-4 py-3">หมู่เรียน</th>
                <th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3">Passcode</th>
                <th className="px-4 py-3">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {regs.map(reg=>{
                const p=store.users.find(u=>u.id===reg.user_id);
                if(!p)return null;
                const assignedPasscode=reg.passcode||store.codes.find(code=>code.event_id===selectedEventId&&code.assigned_to===p.id)?.code;
                return <tr key={reg.user_id} className="text-[10px] hover:bg-slate-50/80 transition">
                  <td className="px-5 py-3"><b className="block text-slate-800 font-bold">{p.full_name}</b><small className="font-mono text-[9px] text-slate-400">{p.student_id}</small></td>
                  <td className="px-4 py-3 text-slate-600 font-semibold">{p.study_year>0?`ปี ${p.study_year}`:'—'}</td>
                  <td className="px-4 py-3 text-slate-600">{p.faculty}</td>
                  <td className="px-4 py-3 text-slate-600">{p.major}</td>
                  <td className="px-4 py-3 text-slate-600">{p.class_group||'—'}</td>
                  <td className="px-4 py-3"><StatusPill status={reg.status}/></td>
                  <td className="px-4 py-3 font-mono text-slate-600 font-bold">{p.study_year>1?(assignedPasscode||'รอจ่ายรหัส'):'ไม่ใช้'}</td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-2"><button className="action-secondary" onClick={()=>{setCorrection({reg,name:p.full_name+" · "+p.student_id});setNextStatus(reg.status);setCorrectionReason('');setCorrectionError('');}}>แก้สถานะ</button><button onClick={()=>deleteRegistration(reg.user_id)} title="ลบการลงทะเบียนกิจกรรม" aria-label="ลบการลงทะเบียนกิจกรรม" className="action-danger" ><Trash2 size={14}/></button></div></td>
                </tr>;
              })}
              {regs.length===0&&<tr><td colSpan={8} className="p-8 text-center text-xs text-slate-400">ยังไม่มีผู้ลงทะเบียน</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )}

  {(adminTab==='all' || adminTab==='users') && <RosterUpload importError={importError} file={csvFile} setFile={setCsvFile} submit={()=>importCsv(true)}/>}
  {/* TAB 4: User Accounts Management */}
  {(adminTab === 'all' || adminTab === 'users') && (
    <section className="bento overflow-hidden shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-slate-100">
        <div>
          <h2 className="text-sm font-extrabold text-slate-900">จัดการบัญชีผู้ใช้งานในระบบ</h2>
          <p className="mt-0.5 text-[9px] text-slate-500">แก้ไขข้อมูล รีเซ็ตรหัสผ่าน หรือลบบัญชีนักศึกษาและสตาฟ</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-[9px] font-bold text-slate-700">{managedUsers.length} บัญชี</span>
      </div>
      <div className="p-5 pb-3 bg-slate-50/50">
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"/>
          <input
            value={userQuery}
            onChange={e=>{setStudentIds([]);setUserQuery(e.target.value);}}
            placeholder="ค้นหาชื่อ, รหัสนักศึกษา, คณะ, สาขา, หมู่เรียน..."
            aria-label="ค้นหาผู้ใช้"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-xs font-medium shadow-xs"
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">{accountControls}</div>
        {(userQuery || Object.values(accountFilters).some(Boolean)) && <button type="button" onClick={()=>{
          setStudentIds([]);setUserQuery('');setAccountFilters({role:'',faculty:'',major:'',study_year:'',class_group:''});
        }} className="mt-2 min-h-10 text-sm font-semibold text-[#7c0a02]">ล้างตัวกรองและคำค้น</button>}
      </div>
      <div className="px-5 pb-3">
        <BulkActions eligible={eligibleStudents} selected={selectedStudents} setSelection={setStudentIds}
          label="ลบนักศึกษา" remove={async()=>{if(await deleteBatch('students',selectedStudents))setStudentIds([]);}}/>
      </div>
      <div className="grid gap-3 p-5 pt-2 sm:grid-cols-2 xl:grid-cols-3">
        {paginatedUsers.map(account=><article key={account.id} className="flex min-w-0 items-start gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs hover:shadow-md transition">
          {account.role==='STUDENT' && <label className="flex min-h-11 shrink-0 items-center">
            <input type="checkbox" aria-label={`เลือก ${account.full_name} ${account.student_id}`} className="h-5 w-5 accent-[#7c0a02]"
              disabled={attendingIds.has(account.id)} checked={!attendingIds.has(account.id) && checkedIds.has(account.id)}
              onChange={e=>setStudentIds(e.target.checked?[...selectedStudents,account.id]:selectedStudents.filter(id=>id!==account.id))}/>
          </label>}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <b className="truncate text-xs font-bold text-slate-900">{account.full_name}</b>
              <RoleBadge role={account.role} size="sm"/>
            </div>
            <small className="mt-1 block truncate font-mono text-[10px] font-bold text-slate-600">
              {account.student_id} {account.role==='STUDENT'?`· ปี ${account.study_year}`:''}
            </small>
            <small className="block truncate text-[9px] text-slate-400">
              {account.faculty} · {account.major} · {account.class_group||'—'}{attendingIds.has(account.id) && ' · กำลังเข้าร่วมกิจกรรม'}
            </small>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5">
            <button type="button" onClick={()=>editUser(account)} className="action-secondary">
              แก้ไข
            </button>
            <button type="button" onClick={()=>deleteUser(account)} className="action-danger">
              ลบ
            </button>
          </div>
        </article>)}
        {managedUsers.length===0&&<p className="col-span-full rounded-xl bg-slate-50 p-6 text-center text-xs text-slate-400">ไม่พบบัญชีที่ตรงกับตัวกรองและคำค้น</p>}
        {totalUserPages>1 && (
          <nav aria-label="หน้ารายชื่อบัญชีผู้ใช้" className="col-span-full flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
            <button type="button" className="action-secondary" disabled={userPage===0} onClick={()=>setUserPage(p=>p-1)}>ก่อนหน้า</button>
            <span className="text-xs font-semibold text-slate-700" aria-live="polite">
              หน้า {userPage+1} / {totalUserPages} · แสดง {userPage*userPageSize+1}–{Math.min((userPage+1)*userPageSize,managedUsers.length)} จาก {managedUsers.length} บัญชี
            </span>
            <button type="button" className="action-secondary" disabled={userPage+1>=totalUserPages} onClick={()=>setUserPage(p=>p+1)}>ถัดไป</button>
          </nav>
        )}
      </div>
    </section>
  )}

  {/* TAB 5: Academic Catalog (Faculties & Majors) */}
  {(adminTab === 'all' || adminTab === 'catalog') && (
    <section className="bento overflow-hidden shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-slate-100">
        <div>
          <h2 className="text-sm font-extrabold text-slate-900">จัดการคณะและสาขาวิชา</h2>
          <p className="mt-0.5 text-[9px] text-slate-500">เพิ่ม แก้ไข หรือลบรายการที่ใช้ในแบบฟอร์มลงทะเบียนและการจัดหมวดหมู่นักศึกษา</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-[9px] font-bold text-slate-700">{academicCatalog.length} คณะ · {academicCatalog.reduce((count,item)=>count+item.majors.length,0)} สาขา</span>
      </div>
      <form onSubmit={e=>{e.preventDefault();const name=newFaculty.trim();if(name){void manageAcademicCatalog('ADD_FACULTY','',name,'','');setNewFaculty('');}}} className="flex gap-2 p-5 pb-3 bg-slate-50/50">
        <input value={newFaculty} onChange={e=>setNewFaculty(e.target.value)} maxLength={150} placeholder="พิมพ์ชื่อคณะใหม่ที่ต้องการเพิ่ม..." aria-label="ชื่อคณะใหม่" className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-medium shadow-xs"/>
        <button disabled={!newFaculty.trim()} className="action-primary shrink-0">
          <Plus size={15}/>
          เพิ่มคณะใหม่
        </button>
      </form>
      <div className="space-y-3 p-5 pt-2">
        {academicCatalog.map(faculty=><article key={faculty.id} className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3">
            <Building2 size={16} className="text-[#7c0a02]"/>
            <input value={facultyDrafts[faculty.id]??faculty.name} onChange={e=>setFacultyDrafts(old=>({...old,[faculty.id]:e.target.value}))} maxLength={150} aria-label={`ชื่อคณะ ${faculty.name}`} className="h-10 min-w-0 basis-full sm:basis-48 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-800"/>
            <button type="button" onClick={()=>{const name=(facultyDrafts[faculty.id]??faculty.name).trim();if(name){void manageAcademicCatalog('UPDATE_FACULTY',faculty.id,name,'','');setFacultyDrafts(old=>({...old,[faculty.id]:name}));}}} disabled={!(facultyDrafts[faculty.id]||'').trim() || facultyDrafts[faculty.id].trim()===faculty.name} className="action-primary">
              <Save size={16}/>บันทึกคณะ
            </button>
            <button type="button" onClick={()=>saveCatalogItem('DELETE_FACULTY',faculty)} className="action-danger">
              ลบคณะ
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {faculty.majors.map(major=><div key={major.id} className="flex flex-wrap items-center gap-2 pl-2 sm:pl-6">
              <span className="text-slate-300">↳</span>
              <input value={majorDrafts[major.id]??major.name} onChange={e=>setMajorDrafts(old=>({...old,[major.id]:e.target.value}))} maxLength={150} aria-label={`ชื่อสาขา ${major.name}`} className="h-9 min-w-0 basis-full sm:basis-44 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-[11px]"/>
              <button type="button" onClick={()=>{const name=(majorDrafts[major.id]??major.name).trim();if(name){void manageAcademicCatalog('UPDATE_MAJOR',faculty.id,faculty.name,major.id,name);setMajorDrafts(old=>({...old,[major.id]:name}));}}} disabled={!(majorDrafts[major.id]||'').trim() || majorDrafts[major.id].trim()===major.name} className="action-primary">
                <Save size={16}/>บันทึกสาขา
              </button>
              <button type="button" onClick={()=>saveCatalogItem('DELETE_MAJOR',faculty,'',major)} className="action-danger">
                ลบสาขา
              </button>
            </div>)}
            <form onSubmit={e=>{e.preventDefault();const name=(newMajor[faculty.id]||'').trim();if(name){void manageAcademicCatalog('ADD_MAJOR',faculty.id,faculty.name,'',name);setNewMajor(old=>({...old,[faculty.id]:''}));}}} className="flex flex-wrap gap-2 pl-2 sm:pl-6 pt-1">
              <input value={newMajor[faculty.id]||''} onChange={e=>setNewMajor(old=>({...old,[faculty.id]:e.target.value}))} maxLength={150} placeholder={`+ เพิ่มสาขาใหม่ใน ${faculty.name}...`} aria-label={`เพิ่มสาขาใน${faculty.name}`} className="h-9 min-w-0 basis-full sm:basis-44 flex-1 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 text-[11px]"/>
              <button disabled={!newMajor[faculty.id]?.trim()} className="action-primary">
                <Plus size={12}/>
                เพิ่มสาขา
              </button>
            </form>
          </div>
        </article>)}
        {academicCatalog.length===0&&<p className="rounded-xl bg-slate-50 p-6 text-center text-xs text-slate-400">ยังไม่มีคณะในระบบ</p>}
      </div>
    </section>
  )}
 </div>;
}

function BulkActions({eligible,selected,setSelection,label,remove}:{
  eligible:string[];selected:string[];setSelection:(values:string[])=>void;label:string;remove:()=>void;
}){
  const all=eligible.length>0 && selected.length===eligible.length;
  return <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input type="checkbox" className="h-5 w-5 accent-[#7c0a02]" checked={all} disabled={!eligible.length}
        ref={node=>{if(node)node.indeterminate=selected.length>0 && !all;}}
        onChange={()=>setSelection(all?[]:eligible)}/>เลือกทั้งหมดที่ลบได้ ({eligible.length})
    </label>
    <button type="button" disabled={!selected.length} onClick={remove}
      className="action-danger disabled:cursor-not-allowed disabled:text-slate-400"><Trash2 size={16}/>{label} ({selected.length})</button>
  </div>;
}

const PasscodeList=memo(function PasscodeList({eventId,store,openCodes,remove,token,refresh}:{
  token:string;refresh:()=>Promise<void>;eventId:string;store:Store;openCodes:()=>void;remove:(values:string[])=>Promise<boolean|undefined>;
}){
  const [matching,setMatching]=useState(false);
  const [matchNotice,setMatchNotice]=useState('');
  const waiting=useMemo(()=>{
    const seniors=new Set(store.users.filter(user=>user.study_year>1&&user.role==='STUDENT').map(user=>user.id));
    return store.regs.filter(reg=>reg.event_id===eventId&&!reg.passcode&&seniors.has(reg.user_id)).length;
  },[store.users,store.regs,eventId]);
  async function matchCodes(){
    if(!supabase || matching)return;
    setMatching(true);setMatchNotice('');
    try{
      const {data,error}=await supabase.rpc('admin_match_waiting_passcodes',{p_token:token,p_event:eventId});
      if(error)throw new Error(error.message);
      setMatchNotice(`จับคู่ Passcode แล้ว ${data.matched_count} คน`);await refresh();
    }catch(error){setMatchNotice(error instanceof Error?error.message:'จับคู่ไม่สำเร็จ');}
    finally{setMatching(false);}
  }
  const [filter,setFilter]=useState('');
  const [query,setQuery]=useState('');
  const [selection,setSelection]=useState<string[]>([]);
  const [pageIndex,setPageIndex]=useState(0);
  const listTop=useRef<HTMLDivElement>(null);
  function changePage(next:number){
    setPageIndex(next);
    listTop.current?.scrollIntoView({block:'start'});
  }

  const rows=useMemo(()=>{
    const people=new Map(store.users.map(u=>[u.id,u]));
    const matches=new Map(store.regs.filter(r=>r.event_id===eventId && r.passcode).map(r=>[r.passcode,r]));
    const eventCodes=new Map(store.codes.filter(c=>c.event_id===eventId).map(c=>[c.code,c]));
    // Older demo registrations can carry a passcode without an entry in the reserve pool.
    for (const [code,reg] of matches) {
      if (code && !eventCodes.has(code)) eventCodes.set(code,{event_id:eventId,code,is_reserve:false,assigned_to:reg.user_id});
    }
    return [...eventCodes.values()].map(c=>{
      const reg=matches.get(c.code);
      const owner=c.assigned_to || reg?.user_id;
      const person=owner?people.get(owner):undefined;
      const status=reg?.status==='COMPLETED'?'ปลดล็อกแล้ว':owner?'จับคู่แล้ว':'ว่าง';
      return {code:c.code,person,status};
    });
  },[store.users,store.regs,store.codes,eventId]);
  const availableCount=useMemo(()=>rows.filter(row=>row.status==='ว่าง').length,[rows]);
  const term=query.trim().toLocaleLowerCase('th');
  const visible=useMemo(()=>rows.filter(row=>(!filter || row.status===filter) &&
    (!term || [row.code,row.person?.full_name,row.person?.student_id].some(value=>value?.toLocaleLowerCase('th').includes(term)))),
    [rows,filter,term]);
  const eligible=useMemo(()=>visible.filter(row=>row.status==='ว่าง').map(row=>row.code),[visible]);
  const checked=useMemo(()=>new Set(selection),[selection]);
  const selected=useMemo(()=>eligible.filter(code=>checked.has(code)),[eligible,checked]);
  const pageSize=20;
  const pageCount=Math.ceil(visible.length/pageSize);
  const page=Math.min(pageIndex,Math.max(0,pageCount-1));
  const start=page*pageSize;

  useEffect(()=>{if(pageIndex!==page)setPageIndex(page);},[pageIndex,page]);
  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-bold text-slate-900">Passcode ของกิจกรรม</h2>
      <button type="button" onClick={openCodes} className="action-primary"><Plus size={16}/>เพิ่มหลายรหัส</button>
    </div>
    <div ref={listTop} className="scroll-mt-3"/><p className="text-sm text-slate-600">ทั้งหมด {rows.length} รหัส · ว่าง {availableCount} รหัส</p>
    <div className="flex flex-wrap items-center gap-3"><p className="text-sm">รอจับคู่ {waiting} คน</p>
      <button className="action-primary" disabled={matching||!waiting||!availableCount||!token} onClick={()=>void matchCodes()}>{matching?'กำลังจับคู่…':'จับคู่รหัสให้รายชื่อที่รอ'}</button></div>
    {matchNotice && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{matchNotice}</p>}
    <input aria-label="ค้นหา Passcode หรือผู้รับ" placeholder="ค้นหารหัส ชื่อ หรือรหัสนักศึกษา" value={query}
      onChange={e=>{setQuery(e.target.value);setPageIndex(0);setSelection([]);}} className="h-11 w-full rounded-xl border border-slate-300 px-3"/>
    <label className="flex items-center gap-2 text-sm">สถานะ
      <select value={filter} onChange={e=>{setFilter(e.target.value);setPageIndex(0);setSelection([]);}} className="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 px-3">
        <option value="">ทั้งหมด</option>{['ว่าง','จับคู่แล้ว','ปลดล็อกแล้ว'].map(s=><option key={s}>{s}</option>)}
      </select>
    </label>
    <BulkActions eligible={eligible} selected={selected} setSelection={setSelection} label="ลบรหัส"
      remove={async()=>{if(await remove(selected))setSelection([]);}}/>
    <ul aria-label="รายการ Passcode" className="divide-y">
      {visible.slice(start,start+pageSize).map(r=><li key={r.code}><label className="flex min-h-12 items-center gap-3 py-2">
        <input type="checkbox" aria-label={'เลือก Passcode '+r.code} disabled={r.status!=='ว่าง'} checked={r.status==='ว่าง' && checked.has(r.code)}
          onChange={e=>setSelection(e.target.checked?[...selected,r.code]:selected.filter(c=>c!==r.code))} className="h-5 w-5 shrink-0 accent-[#7c0a02]"/>
        <span className="min-w-0 flex-1"><b className="break-all font-mono text-sm">{r.code}</b>
          {r.person && <small className="block text-slate-600">{r.person.full_name} · {r.person.student_id}</small>}</span>
        <span className={cx('shrink-0 rounded-lg px-2 py-1 text-xs font-semibold',
          r.status==='ว่าง'?'bg-slate-100 text-slate-700':r.status==='จับคู่แล้ว'?'bg-amber-50 text-amber-900':'bg-emerald-50 text-emerald-800')}>{r.status}</span>
      </label></li>)}
    </ul>
    {pageCount>1 && <nav aria-label="หน้ารายการ Passcode" className="flex flex-wrap items-center justify-between gap-2">
      <button type="button" className="action-secondary disabled:opacity-40" disabled={page===0} onClick={()=>changePage(page-1)}>ก่อนหน้า</button>
      <span aria-live="polite" className="text-sm text-slate-600">หน้า {page+1} / {pageCount}</span>
      <button type="button" className="action-secondary disabled:opacity-40" disabled={page+1>=pageCount} onClick={()=>changePage(page+1)}>ถัดไป</button>
    </nav>}
    {!visible.length && <Empty message={rows.length?'ไม่พบรหัสตามตัวกรอง':'ยังไม่มี Passcode ในกิจกรรมนี้'}/>}
  </section>;
});

function AdminMetric({label,value,note,icon,tone}:{label:string;value:number;note:string;icon:React.ReactNode;tone:string}){
  const styles:Record<string,{bg:string;iconBg:string;text:string;border:string}>={
    rose:{bg:'bg-gradient-to-br from-rose-50/90 to-white',iconBg:'bg-rose-100 text-[#7c0a02]',text:'text-[#7c0a02]',border:'border-rose-200/70'},
    gold:{bg:'bg-gradient-to-br from-amber-50/90 to-white',iconBg:'bg-amber-100 text-amber-800',text:'text-amber-800',border:'border-amber-200/70'},
    blue:{bg:'bg-gradient-to-br from-sky-50/90 to-white',iconBg:'bg-sky-100 text-sky-800',text:'text-sky-800',border:'border-sky-200/70'},
    green:{bg:'bg-gradient-to-br from-emerald-50/90 to-white',iconBg:'bg-emerald-100 text-emerald-800',text:'text-emerald-800',border:'border-emerald-200/70'}
  };
  const current = styles[tone] || styles.rose;
  return <div className={cx('bento border p-5 shadow-sm transition-all hover:shadow-md', current.bg, current.border)}>
    <div className="flex items-start justify-between">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <span className={cx('rounded-xl p-2 shadow-sm', current.iconBg)}>{icon}</span>
    </div>
    <b className={cx('mt-3 block text-3xl font-extrabold sm:text-4xl', current.text)}>{value}</b>
    <span className="mt-1 block truncate text-[10px] font-semibold text-slate-400">{note}</span>
  </div>;
}
function DashboardCount({icon,label,value,tone}:{icon:React.ReactNode;label:string;value:number;tone:string}){return <div className="flex items-center justify-between gap-2 rounded-xl bg-white px-2.5 py-2"><span className="flex min-w-0 items-center gap-1.5 text-[8px] text-slate-500"><span className={cx('rounded-lg p-1.5',tone)}>{icon}</span><span className="truncate">{label}</span></span><b className="text-sm text-slate-900">{value}</b></div>}
