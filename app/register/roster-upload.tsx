'use client';
import {useRef,useState} from 'react';
import {CheckCircle2,Download,FileSpreadsheet,UploadCloud,X} from 'lucide-react';
import {readStudentFile} from '@/lib/student-file';

const columns=['ชั้นปี','คณะ','สาขาวิชา','รุ่น','หมู่','รหัสนักศึกษา','คำนำหน้าไทย','ชื่อไทย','นามสกุลไทย','วันเกิด'];
const example=['1','คณะครุศาสตร์','คอมพิวเตอร์ศึกษา','2569','1','16915039','นาย','ตัวอย่าง','นักศึกษา','18/11/2550'];

export function RosterUpload({file,setFile,submit,importError}:{importError?:string;file:File|null;setFile:(file:File|null)=>void;submit:()=>void}){
  const input=useRef<HTMLInputElement>(null);
  const request=useRef(0);
  const [preview,setPreview]=useState<{file:File;rows:string[][]}|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [dragging,setDragging]=useState(false);
  async function choose(next:File|null){
    const version=++request.current;
    setFile(null);setPreview(null);setError('');setLoading(!!next);
    if(!next)return;
    try{
      const rows=await readStudentFile(next);
      if(rows.length<2)throw new Error('ไฟล์ต้องมีหัวคอลัมน์และข้อมูลนักศึกษาอย่างน้อย 1 แถว');
      if(version===request.current){setPreview({file:next,rows});setFile(next);}
    }catch(error){if(version===request.current)setError(error instanceof Error?error.message:'อ่านไฟล์ไม่สำเร็จ');}
    finally{if(version===request.current)setLoading(false);}
  }
  function downloadTemplate(){
    const csv=[columns,example].map(row=>row.map(cell=>'"'+cell.replace(/"/g,'""')+'"').join(',')).join('\r\n');
    const link=document.createElement('a');
    link.href=URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}));
    link.download='ตัวอย่างทะเบียนนักศึกษา.csv';link.click();
    setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  }
  const ready=!!file && preview?.file===file;
  return <section className="bento overflow-hidden">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 p-5 sm:p-6">
      <div className="flex items-center gap-3"><span className="rounded-2xl bg-[#7c0a02] p-3 text-white"><FileSpreadsheet size={24}/></span>
        <div><h2 className="font-bold text-slate-900">นำเข้าทะเบียนนักศึกษา</h2><p className="mt-1 text-sm text-slate-600">สร้างบัญชีพร้อมใช้งาน แล้วให้นักศึกษาเลือกสมัครกิจกรรม</p></div>
      </div>
      <button type="button" className="action-secondary" onClick={downloadTemplate}><Download size={18}/>ดาวน์โหลดตัวอย่าง CSV</button>
    </header>
    <div className="space-y-5 p-5 sm:p-6">
      <div onDragOver={event=>{event.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)}
        onDrop={event=>{event.preventDefault();setDragging(false);void choose(event.dataTransfer.files[0]||null);}}
        className={'flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-7 text-center '+(dragging?'border-[#7c0a02] bg-rose-50':'border-slate-300 bg-slate-50')}>
        <UploadCloud size={34} className="text-[#7c0a02]"/>
        <strong className="text-lg">ลากไฟล์มาวางที่นี่</strong>
        <p className="text-sm text-slate-600">CSV UTF-8 หรือ Excel .xlsx · อ่านข้อมูลจากชีตแรก</p>
        <input ref={input} type="file" accept=".csv,.xlsx" className="hidden" aria-label="เลือกไฟล์ทะเบียนนักศึกษา"
          onChange={event=>{void choose(event.target.files?.[0]||null);event.target.value='';}}/>
        <button type="button" className="action-primary" onClick={()=>input.current?.click()}>เลือกไฟล์จากเครื่อง</button>
      </div>
      {importError && <p role="alert" className="break-words rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">นำเข้าไม่สำเร็จ · {importError}</p>}
      {loading && <p role="status">กำลังอ่านไฟล์และเตรียมตัวอย่าง…</p>}
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {ready && <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <CheckCircle2 size={22} className="shrink-0 text-emerald-700"/>
          <div className="min-w-0 flex-1"><b className="block break-all">{file.name}</b><p className="text-sm">{preview.rows.length-1} แถว · {(file.size/1024).toFixed(1)} KB</p></div>
          <button type="button" className="action-secondary" aria-label="นำไฟล์ออก" onClick={()=>void choose(null)}><X size={18}/></button>
        </div>
        <h3 className="font-semibold">ตัวอย่างจากไฟล์ที่เลือก · 5 แถวแรก</h3>
        <div className="overflow-x-auto rounded-xl border" tabIndex={0} role="region" aria-label="ตัวอย่างข้อมูลไฟล์">
          <table className="w-full whitespace-nowrap text-left text-sm"><thead className="bg-slate-100"><tr>{preview.rows[0].map((cell,index)=><th key={index} className="px-4 py-3">{cell}</th>)}</tr></thead>
            <tbody>{preview.rows.slice(1,6).map((row,index)=><tr key={index} className="border-t">{row.map((cell,column)=><td key={column} className="px-4 py-3">{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </div>}
      <div className="space-y-3">
        <h3 className="font-semibold">ตัวอย่างคอลัมน์ที่ใช้ในการนำเข้า</h3>
        <div className="overflow-x-auto rounded-xl border" tabIndex={0} role="region" aria-label="ตัวอย่างคอลัมน์นำเข้า">
          <table className="w-full whitespace-nowrap text-left text-sm"><thead className="bg-slate-100"><tr>{columns.map(column=><th key={column} className="px-4 py-3">{column}</th>)}</tr></thead>
            <tbody><tr>{example.map((cell,index)=><td key={index} className="px-4 py-3">{cell}</td>)}</tr></tbody>
          </table>
        </div>
        <p className="text-sm leading-6 text-slate-600">ใช้ “ชื่อ-นามสกุล” รวมในคอลัมน์เดียวได้ · รุ่นเว้นได้ ระบบคำนวณจากชั้นปี · เพิ่มคอลัมน์เบอร์โทรศัพท์ได้ตามต้องการ</p>
        <p className="text-sm leading-6 text-slate-600">วันเกิดแบบข้อความใช้ พ.ศ. เช่น 18/11/2550 หรือ 18112550 · ตั้งรหัสนักศึกษาและเบอร์โทรเป็นข้อความเพื่อเก็บเลข 0 นำหน้า</p>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-4 border-t pt-5">
        <p className="text-sm text-slate-600">รหัสผ่านเริ่มต้นเป็นวันเกิด พ.ศ. 8 หลัก<br/>รหัสนักศึกษาที่มีบัญชีแล้วจะถูกข้าม</p>
        <button type="button" disabled={!ready||loading} className="action-primary w-full sm:w-auto" onClick={submit}><UploadCloud size={18}/>นำเข้าและสร้างบัญชี{ready?' '+(preview.rows.length-1)+' แถว':''}</button>
      </footer>
    </div>
  </section>;
}
