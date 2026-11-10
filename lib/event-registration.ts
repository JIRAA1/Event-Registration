import {supabase} from './supabase';

export type SignupInfo = {
  event: {title:string;location:string;open:boolean;closed:boolean} | null;
  catalog:Record<string,string[]> | null;
  contact:string;
};
export type Station = {event:string;token:string};
export type ApplicationProfile = {
  prefix?:string;
  student_id:string;full_name:string;faculty:string;major:string;class_group:string;study_year:string;birth_date:string;phone:string;
};
export type Receipt = {id:string;status:'PENDING'|'CORRECT'|'APPROVED'|'CANCELLED';student_id:string;note:string;issued:boolean;claimed:boolean;password:string|null;profile:ApplicationProfile|null};
export type QueueState = {open:boolean;contact:string;station:string|null;queue:{id:string;student_id:string;profile:ApplicationProfile;kiosk:boolean;status:string}[]};

export async function signupRpc<T>(name:string,params:Record<string,unknown>):Promise<T> {
  if (!supabase) throw new Error('หน้านี้ต้องเชื่อมต่อฐานข้อมูล Event Pass');
  const {data,error}=await supabase.rpc(name,params);
  if (error) throw new Error(error.code==='PGRST202'?'ฐานข้อมูลยังไม่พร้อม กรุณาติดตั้ง migration ให้ครบถึง 026':error.message);
  return data as T;
}
export function errorText(e:unknown) {return e instanceof Error?e.message:'เชื่อมต่อไม่สำเร็จ กรุณาลองอีกครั้ง';}
export function newReceipt() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
}
export function normalizeDigits(s:string) {
  return s.trim().replace(/[๐-๙]/g,d=>String(d.charCodeAt(0)-0x0e50));
}
