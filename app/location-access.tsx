'use client';
import {useCallback,useEffect,useRef,useState} from 'react';

export type LocationFix={lat:number;lon:number;accuracy:number;timestamp:number};
export function useLocationAccess(enabled=true){
  const latest=useRef<LocationFix|null>(null);
  const watch=useRef<number|null>(null);
  const [message,setMessage]=useState('กรุณาอนุญาตตำแหน่ง GPS เพื่อใช้ตรวจสอบระยะตอนสแกน');
  const [attempted,setAttempted]=useState(false);
  const [ready,setReady]=useState(false);
  const stop=useCallback(()=>{if(watch.current!==null){navigator.geolocation?.clearWatch(watch.current);watch.current=null;}},[]);
  const request=useCallback(()=>{
    stop();latest.current=null;setReady(false);setAttempted(true);
    if(!navigator.geolocation || !window.isSecureContext){setMessage('อุปกรณ์นี้ใช้ GPS ไม่ได้ หรือไม่ได้เปิดผ่าน HTTPS');return;}
    setMessage('กำลังขอตำแหน่ง กรุณากดอนุญาต…');
    watch.current=navigator.geolocation.watchPosition(p=>{
      latest.current={lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy,timestamp:p.timestamp};
      setReady(true);setMessage(`รับ GPS แล้ว · คลาดเคลื่อนประมาณ ${Math.round(p.coords.accuracy)} เมตร`);
    },e=>{
      latest.current=null;setReady(false);
      setMessage(e.code===1?'ไม่ได้รับอนุญาตตำแหน่ง: เปิดการตั้งค่าเว็บไซต์ในเบราว์เซอร์ → ตำแหน่ง → อนุญาต แล้วกดลองอีกครั้ง':'รับ GPS ไม่สำเร็จ กรุณาเปิดบริการตำแหน่งของเครื่อง หรือย้ายไปบริเวณที่รับสัญญาณได้');
    },{enableHighAccuracy:true,maximumAge:5000,timeout:10000});
  },[stop]);
  useEffect(()=>{if(!enabled){stop();latest.current=null;setReady(false);}return stop;},[enabled,stop]);
  const read=useCallback(()=>{const p=latest.current;return p && Math.abs(Date.now()-p.timestamp)<=30000?p:null;},[]);
  return {message,attempted,ready,request,read};
}
export function LocationAccess({gps}:{gps:ReturnType<typeof useLocationAccess>}){
  return <section className="my-3 rounded-xl border border-slate-300 bg-white p-3 text-sm">
    <p role="status">{gps.message}</p>
    <button type="button" onClick={gps.request} className="mt-2 rounded-lg border px-3 py-2 font-bold">{gps.attempted?'ขอตำแหน่ง / อนุญาตอีกครั้ง':'อนุญาต GPS'}</button>
    {gps.attempted&&!gps.ready&&<p className="mt-2 text-xs">หากเบราว์เซอร์บล็อกสิทธิ์ถาวร ต้องเปิดสิทธิ์ในการตั้งค่าก่อน เว็บไซต์ไม่สามารถเปิดแทนได้ หากยังใช้ไม่ได้ ให้สตาฟตรวจตัวบุคคลและยืนยันกรณีพิเศษ</p>}
  </section>;
}
