'use client';
import {useId,useState,type InputHTMLAttributes} from 'react';
import {Eye,EyeOff} from 'lucide-react';

export function PasswordInput({className='',id,...props}:InputHTMLAttributes<HTMLInputElement>){
  const [visible,setVisible]=useState(false);
  const generatedId=useId();
  const inputId=id||generatedId;
  return <span className="relative block">
    <input {...props} id={inputId} type={visible?'text':'password'} className={className+' pr-14'}/>
    <button type="button" aria-label={visible?'ซ่อนรหัสผ่าน':'แสดงรหัสผ่าน'} aria-pressed={visible} aria-controls={inputId}
      disabled={props.disabled} onClick={()=>setVisible(value=>!value)}
      className="absolute bottom-0 right-1 flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-700">
      {visible?<EyeOff size={20}/>:<Eye size={20}/>}
    </button>
  </span>;
}
