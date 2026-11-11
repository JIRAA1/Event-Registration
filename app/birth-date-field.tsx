'use client';

import {useEffect,useState} from 'react';
import {birthDateFromInput,birthDateToInput} from '@/lib/birth-date';

export function BirthDateField({defaultValue=''}:{defaultValue?:string}) {
  const [value,setValue]=useState(()=>birthDateToInput(defaultValue));
  const [today,setToday]=useState('');
  const password=birthDateFromInput(value);
  useEffect(()=>{
    const date=new Date();
    setToday([date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-'));
  },[]);
  return <label className="block min-w-0 text-sm font-semibold">
    วันเกิด
    <input type="date" required value={value} max={today||undefined} autoComplete="bday"
      onChange={event=>setValue(event.target.value)}
      className="mt-1 block min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base font-normal text-slate-800"/>
    <input type="hidden" name="birth_date" value={password}/>
    <small className="mt-1 block text-sm font-normal text-slate-600">
      {password?'วันเกิด พ.ศ. '+password.slice(0,2)+'/'+password.slice(2,4)+'/'+password.slice(4)+' · รหัสผ่านเริ่มต้น '+password:'เลือกวัน เดือน และปีเกิดจากปฏิทิน'}
    </small>
  </label>;
}
