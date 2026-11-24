'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Round = { closed_at: string | null; available_count: number; candidates: { student_id: string; full_name: string }[] };
export function PasscodeRound({ token, eventId, refresh, onClosed }: { token: string; eventId: string; refresh: () => Promise<void>; onClosed: (closed: boolean) => void }) {
  const [round, setRound] = useState<Round | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    setRound(null); setNotice(''); onClosed(false);
    void supabase?.rpc('admin_passcode_round', { p_token: token, p_event: eventId }).then(({ data, error }) => {
      if (!active) return;
      if (error) setNotice('โหลดสถานะรอบไม่สำเร็จ'); else { setRound(data); onClosed(!!data?.closed_at); }
    });
    return () => { active = false; };
  }, [token, eventId, onClosed]);
  async function act(action: 'CLOSE' | 'RECLAIM') {
    if (!supabase || busy) return;
    const message = action === 'CLOSE'
      ? 'ปิดรอบสแกนนี้? หลังยืนยันจะหยุดสแกนเข้า/ออกตามปกติ ให้แอดมินยืนยันรายการตกหล่นเท่านั้น'
      : `คืนรหัสจากผู้ไม่สแกนออก ${round?.candidates.length || 0} คน? คนเดิมจะไม่ได้รหัสกลับจากการจับคู่อัตโนมัติ`;
    if (!window.confirm(message)) return;
    setBusy(true); setNotice('');
    try {
      const { data, error } = await supabase.rpc('admin_passcode_round', { p_token: token, p_event: eventId, p_action: action });
      if (error || !data?.success) throw new Error(error?.message || 'ดำเนินการไม่สำเร็จ');
      setRound(data); onClosed(!!data.closed_at); setNotice(action === 'CLOSE' ? 'ปิดรอบสแกนแล้ว' : `คืนรหัสแล้ว ${data.reclaimed_count} รหัส`);
      await refresh();
    } catch (error) { setNotice(error instanceof Error ? error.message : 'ดำเนินการไม่สำเร็จ'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
    <h3 className="font-bold">ปิดรอบและคืน Passcode</h3>
    <p className="text-sm">{round?.closed_at ? 'ปิดรอบสแกนแล้ว' : 'ปิดรอบเมื่อหมดเวลาสแกนออก ก่อนคืนรหัสจากผู้ที่ไม่สแกนออก'} รหัสของคนที่สแกนออกแล้วจะคงเดิม</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="action-secondary" disabled={busy || !round || !!round.closed_at} onClick={() => void act('CLOSE')}>ปิดรอบสแกน</button>
      <button type="button" className="action-primary" disabled={busy || !round?.closed_at || !round.candidates.length} onClick={() => void act('RECLAIM')}>คืน Passcode จากผู้ไม่สแกนออก ({round?.candidates.length || 0})</button>
    </div>
    {!!round?.candidates.length && <details><summary className="cursor-pointer text-sm">ตรวจรายชื่อก่อนคืนรหัส ({round.candidates.length} คน)</summary>
      <ul className="mt-2 max-h-48 overflow-y-auto text-sm">{round.candidates.map(p => <li key={p.student_id} className="break-words py-1">{p.student_id} · {p.full_name}</li>)}</ul>
    </details>}
    {round?.closed_at && <p className="text-sm">รหัสที่คืนมาว่าง {round.available_count} รหัส · ไปหน้าสแกน เลือก “ยืนยันกลุ่มตกหล่น” แล้วสแกน QR จากมือถือของนักศึกษา ตรวจบัตรและระบุเหตุผลก่อนอนุมัติ ระหว่างนี้ให้สถานะกิจกรรมเป็นเปิดใช้งานเพื่อให้นักศึกษาเปิด QR ได้</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
