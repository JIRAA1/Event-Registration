'use client';

import {useRef, useState, type FormEvent} from 'react';
import {UserPlus} from 'lucide-react';
import {BirthDateField} from '../birth-date-field';
import {supabase} from '@/lib/supabase';

type Props = {
  token: string;
  catalog: {name: string; majors: {name: string}[]}[];
  refresh: () => Promise<void>;
};

export function SingleStudent({token, catalog, refresh}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [faculty, setFaculty] = useState('');
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState('');
  const pending = useRef(false);
  const majors = catalog.find(item => item.name === faculty)?.majors ?? [];
  const field = 'mt-1 block min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base';

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    if (!supabase || !token) {
      setMessage('กรุณาเข้าสู่ระบบแอดมินเพื่อเพิ่มบัญชี');
      return;
    }
    const form = new FormData(event.currentTarget);
    const read = (key: string) => String(form.get(key) ?? '').trim();
    const studentId = read('student_id');
    const studyYear = Number(read('study_year'));
    const student = {
      student_id: studentId,
      full_name: read('prefix') + read('full_name'),
      faculty: read('faculty'), major: read('major'), class_group: read('class_group'),
      study_year: studyYear,
      enrollment_year: Number(read('enrollment_year')) || new Date().getFullYear() + 544 - studyYear,
      birth_date: read('birth_date'), phone: read('phone'),
    };
    if (!read('full_name') || !student.faculty || !student.major) {
      setMessage('กรุณาระบุชื่อ คณะ และสาขาให้ครบ');
      return;
    }
    pending.current = true;
    setBusy(true);
    setMessage('');
    try {
      const {data, error} = await supabase.rpc('admin_import_student_roster', {
        p_admin_token: token, p_students: [student],
      });
      if (error || !data?.success) throw new Error(error?.message || data?.message || 'บันทึกไม่สำเร็จ');
      if (data.skipped_count === 1) {
        setMessage('มีบัญชีนักศึกษารหัส ' + studentId + ' อยู่แล้ว');
        return;
      }
      if (data.imported_count !== 1) throw new Error('กรุณาตรวจรายชื่อเพื่อยืนยันผลการบันทึก');
      setMessage('สร้างบัญชี ' + studentId + ' แล้ว นักศึกษาเข้าสู่ระบบด้วยวันเกิด พ.ศ. 8 หลักได้เลย');
      setFaculty('');
      setVersion(v => v + 1);
      try { await refresh(); } catch { setMessage('สร้างบัญชี ' + studentId + ' แล้ว กรุณารีเฟรชเพื่อดูรายชื่อล่าสุด'); }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <section className="bento p-5 sm:p-6">
    <button type="button" className="action-primary" aria-expanded={open} disabled={busy}
      onClick={() => setOpen(!open)}><UserPlus size={18}/>เพิ่มนักศึกษาทีละคน</button>
    {open && <form key={version} onSubmit={save} className="mt-4 space-y-4">
      <fieldset disabled={busy} className="grid gap-3 text-sm font-semibold sm:grid-cols-2">
        <label>รหัสนักศึกษา<input name="student_id" className={field} required inputMode="numeric" pattern="[0-9]{7,8}" maxLength={8}/></label>
        <label>คำนำหน้า<select className={field} name="prefix" required defaultValue=""><option value="">เลือกคำนำหน้า</option><option>นาย</option><option>นางสาว</option></select></label>
        <label>ชื่อและนามสกุล<input name="full_name" className={field} required maxLength={249}/></label>
        <BirthDateField/>
        <label>คณะ<input name="faculty" className={field} list="roster-faculties" value={faculty} onChange={e => setFaculty(e.target.value)} required maxLength={150}/></label>
        <datalist id="roster-faculties">{catalog.map(f => <option key={f.name} value={f.name}/>)}</datalist>
        <label>สาขาวิชา<input key={faculty} name="major" className={field} list="roster-majors" required maxLength={150}/></label>
        <datalist id="roster-majors">{majors.map(m => <option key={m.name} value={m.name}/>)}</datalist>
        <label>ชั้นปี<select name="study_year" className={field} required defaultValue=""><option value="">เลือกชั้นปี</option>{[1,2,3,4,5,6,7,8].map(n => <option key={n}>{n}</option>)}</select></label>
        <label>หมู่เรียน<select name="class_group" className={field} required defaultValue=""><option value="">เลือกหมู่เรียน</option>{[1,2,3,4].map(n => <option key={n}>{n}</option>)}</select></label>
        <label>รุ่น พ.ศ. (เว้นได้ ระบบคำนวณจากชั้นปี)<input name="enrollment_year" className={field} inputMode="numeric" pattern="[1-9][0-9]{3}" maxLength={4}/></label>
        <label>เบอร์โทรศัพท์ (ถ้ามี)<input className={field} name="phone" type="tel" maxLength={20}/></label>
      </fieldset>
      <button disabled={busy} className="action-primary w-full sm:w-auto">{busy ? 'กำลังบันทึก…' : 'บันทึกและสร้างบัญชี'}</button>
    </form>}
    {message && <p className="mt-3 text-sm font-semibold" role="status">{message}</p>}
  </section>;
}
