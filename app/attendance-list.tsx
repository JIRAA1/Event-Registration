'use client';

import { useState, type ReactNode } from 'react';
import { Settings2, Users } from 'lucide-react';

type Person = { id: string; full_name: string; student_id: string; study_year: number; faculty: string; major: string; class_group: string; phone?: string };
type Attendance = { user_id: string; checkin_at?: string; checkout_at?: string; checked_in_by?: string; checked_out_by?: string; checkin_staff_name?: string; checkout_staff_name?: string };
const columns = [ ['study_year', 'ชั้นปี'], ['faculty', 'คณะ'], ['major', 'สาขา'], ['class_group', 'หมู่เรียน'], ['phone', 'เบอร์โทร'], ['checkin_at', 'เวลาเช็กอิน'], ['checkin_staff', 'สตาฟเช็กอิน'], ['checkout_at', 'เวลาเช็กเอาต์'], ['checkout_staff', 'สตาฟเช็กเอาต์'] ] as const;
type Column = typeof columns[number][0];
const date = (value?: string) => value ? new Date(value).toLocaleString('th-TH') : '—';

export function AttendanceList<R extends Attendance>({ rows, users, status, actions }: {
  rows: { person: Person; reg: R }[]; users: { id: string; full_name: string }[];
  status: (reg: R) => ReactNode; actions: (reg: R, person: Person) => ReactNode;
}) {
  const [visible, setVisible] = useState<Column[]>(['faculty', 'checkin_at', 'checkout_at']);
  function value(key: Column, person: Person, reg: R) {
    if (key === 'checkin_at' || key === 'checkout_at') return date(reg[key]);
    if (key === 'checkin_staff') return reg.checkin_staff_name || users.find(user => user.id === reg.checked_in_by)?.full_name || '—';
    if (key === 'checkout_staff') return reg.checkout_staff_name || users.find(user => user.id === reg.checked_out_by)?.full_name || '—';
    if (key === 'study_year') return person.study_year ? `ปี ${person.study_year}` : '—';
    return person[key] || '—';
  }
  if (!rows.length) return <div className="px-5 py-12 text-center text-slate-600"><Users className="mx-auto mb-3 text-slate-400" size={28} /><p>ไม่มีรายชื่อตรงกับตัวกรองนี้</p><p className="mt-1 text-sm">ลองเปลี่ยนสถานะหรือเลือกคณะทั้งหมด</p></div>;
  return <>
    <div className="hidden border-y border-slate-200 bg-slate-50 px-5 py-3 md:block">
      <details><summary className="flex min-h-11 w-fit cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700"><Settings2 size={18} />เลือกคอลัมน์ที่แสดง</summary>
        <div className="flex flex-wrap gap-x-6 gap-y-3 py-3">{columns.map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[#7c0a02]" checked={visible.includes(key)} onChange={event => setVisible(previous => event.target.checked ? [...previous, key] : previous.filter(item => item !== key))} />{label}
        </label>)}</div>
      </details>
    </div>
    <div className="attendance-table hidden overflow-x-auto md:block" tabIndex={0} role="region" aria-label="รายชื่อผู้เข้าร่วม เลื่อนแนวนอนเพื่อดูคอลัมน์เพิ่มเติม">
      <table className="w-full text-left text-sm"><thead><tr><th>ผู้เข้าร่วม</th><th>สถานะ</th>{columns.filter(([key]) => visible.includes(key)).map(([key, label]) => <th key={key}>{label}</th>)}<th>จัดการ</th></tr></thead>
        <tbody>{rows.map(({ person, reg }) => <tr key={reg.user_id}><td><b className="block">{person.full_name}</b><span className="font-mono text-sm text-slate-600">{person.student_id}</span></td><td>{status(reg)}</td>
          {columns.filter(([key]) => visible.includes(key)).map(([key]) => <td key={key}>{value(key, person, reg)}</td>)}<td><div className="flex gap-2">{actions(reg, person)}</div></td></tr>)}</tbody>
      </table>
    </div>
    <div className="divide-y divide-slate-200 md:hidden">{rows.map(({ person, reg }) => <article key={reg.user_id} className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{person.full_name}</h3><p className="mt-1 font-mono text-sm text-slate-600">{person.student_id}</p></div>{status(reg)}</div>
      <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-[#7c0a02]">ดูรายละเอียดและจัดการ</summary>
        <dl className="space-y-3 border-t border-slate-200 py-4">{columns.map(([key, label]) => <div key={key} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 text-sm"><dt className="text-slate-600">{label}</dt><dd className="break-words font-medium text-slate-900">{value(key, person, reg)}</dd></div>)}</dl>
        <div className="flex flex-wrap gap-2 pb-4">{actions(reg, person)}</div>
      </details>
    </article>)}</div>
  </>;
}
