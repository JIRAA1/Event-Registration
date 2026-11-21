'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { LocationFix } from './location-access';
import { AlertTriangle, CheckCircle2, ShieldAlert, UserCheck, X, Sparkles } from 'lucide-react';

type Warning = {
  message: string;
  distance_m: number | null;
  radius_m: number;
  student_id: string;
  full_name: string;
  student_accuracy: number | null;
  staff_accuracy: number | null;
};

export function useSecureScan(context: string) {
  const [warning, setWarning] = useState<Warning | null>(null);
  const answer = useRef<((reason: string | null) => void) | null>(null);
  const busy = useRef(false);

  function settle(reason: string | null) {
    const resolve = answer.current;
    answer.current = null;
    setWarning(null);
    resolve?.(reason);
  }

  useEffect(() => () => {
    const resolve = answer.current;
    answer.current = null;
    resolve?.(null);
  }, [context]);

  useEffect(() => {
    setWarning(null);
  }, [context]);

  async function scan(
    args: { p_session_token: string; p_event_id: string; p_scan_mode: string; p_ticket: string },
    read: () => LocationFix | null
  ) {
    if (busy.current || !supabase) return null;
    busy.current = true;
    try {
      let response = await supabase.rpc('redeem_location_qr', { ...args, p_location: read() });
      if (response.data?.code === 'GPS_CONFIRM_REQUIRED') {
        const reason = await new Promise<string | null>(resolve => {
          answer.current = resolve;
          setWarning(response.data as Warning);
        });
        if (reason === null) return null;
        response = await supabase.rpc('redeem_location_qr', {
          ...args,
          p_location: read(),
          p_confirm: true,
          p_reason: reason,
        });
      }
      return response;
    } finally {
      busy.current = false;
    }
  }

  return { scan, confirmation: warning ? <Confirmation warning={warning} done={settle} /> : null };
}

const QUICK_REASONS = [
  'ตรวจบัตรนักศึกษาตัวจริงแล้ว GPS คลาดเคลื่อน',
  'เครื่องนักศึกษาไม่มี GPS ตรวจบัตรตัวจริงแล้ว',
  'สแกนในอาคาร สัญญาณดาวเทียมอ่อน ตรวจบัตรแล้ว',
];

function Confirmation({ warning: w, done }: { warning: Warning; done: (reason: string | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const isValid = reason.trim().length >= 5;

  return (
    <dialog
      ref={ref}
      onCancel={e => {
        e.preventDefault();
        done(null);
      }}
      aria-labelledby="gps-warning-title"
      className="m-auto max-h-[90dvh] w-[min(94vw,500px)] overflow-y-auto overscroll-contain rounded-3xl border border-rose-200 bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-900/60 backdrop:backdrop-blur-sm"
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-rose-500 to-[#7c0a02] p-5 text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
              <ShieldAlert size={26} className="text-white" />
            </span>
            <div>
              <h2 id="gps-warning-title" className="text-base font-extrabold">
                ต้องยืนยันตัวนักศึกษาก่อนสแกน
              </h2>
              <p className="mt-0.5 text-xs text-rose-100">ตรวจพบเงื่อนไขพิกัด GPS พิเศษ</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="ปิดการยืนยัน GPS"
            onClick={() => done(null)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/80 hover:bg-white/20 active:scale-95"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-4 text-xs">
        {/* Student Card */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">ข้อมูลนักศึกษา</span>
          <p className="mt-1 text-base font-extrabold text-slate-900">{w.full_name}</p>
          <p className="mt-0.5 font-mono text-xs font-semibold text-[#7c0a02]">รหัสประจำตัว: {w.student_id}</p>
        </div>

        {/* Distance / GPS Status Banner */}
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3.5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="font-extrabold text-amber-950 text-sm">
                {w.distance_m === null
                  ? '⚠️ ไม่สามารถคำนวณระยะห่างได้ (ไม่มีพิกัด GPS)'
                  : `📏 ระยะห่างประมาณ ${Math.round(w.distance_m)} เมตร (เกณฑ์สูงสุด ${w.radius_m} ม.)`}
              </p>
              <p className="mt-1 text-[11px] text-amber-800 leading-relaxed">
                {w.message}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold text-slate-600">
                <span className="rounded-lg bg-white/80 px-2 py-1 border border-amber-200">
                  GPS นักศึกษา: {w.student_accuracy === null ? 'ไม่มีพิกัด' : `±${Math.round(w.student_accuracy)} ม.`}
                </span>
                <span className="rounded-lg bg-white/80 px-2 py-1 border border-amber-200">
                  GPS สตาฟ: {w.staff_accuracy === null ? 'ไม่มีพิกัด' : `±${Math.round(w.staff_accuracy)} ม.`}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 border border-slate-200 text-slate-600">
          <p className="font-bold text-slate-800">📋 ขั้นตอนของสตาฟ:</p>
          <ul className="mt-1 space-y-0.5 list-disc list-inside text-[11px]">
            <li>ขอดูบัตรนักศึกษาตัวจริง หรือบัตรประชาชน</li>
            <li>ตรวจใบหน้านักศึกษาให้ตรงกับบัตรก่อนกดยืนยัน</li>
            <li>การอนุมัติจะถูกบันทึกชื่อสตาฟและเหตุผลในระบบ Audit</li>
          </ul>
        </div>

        {/* Form */}
        <form
          onSubmit={e => {
            e.preventDefault();
            if (isValid) done(reason.trim());
          }}
          className="space-y-3"
        >
          <div>
            <label className="block font-bold text-slate-700">
              ระบุเหตุผลในการอนุมัติ <span className="text-rose-500">*</span>
            </label>

            {/* Quick Reason Chips */}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {QUICK_REASONS.map(qr => (
                <button
                  key={qr}
                  type="button"
                  onClick={() => setReason(qr)}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-600 hover:border-[#7c0a02] hover:text-[#7c0a02] transition-colors"
                >
                  + {qr}
                </button>
              ))}
            </div>

            <textarea
              autoFocus
              required
              minLength={5}
              maxLength={500}
              rows={2}
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-[#7c0a02] focus:outline-none focus:ring-1 focus:ring-[#7c0a02]"
              placeholder="กรอกเหตุผลอย่างน้อย 5 ตัวอักษร เช่น ตรวจบัตรตัวจริงแล้ว..."
            />
            <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1">
              <span>{reason.trim().length < 5 ? `ต้องการอีก ${5 - reason.trim().length} ตัวอักษร` : '✓ ครบตามเกณฑ์แล้ว'}</span>
              <span>{reason.length}/500</span>
            </div>
          </div>

          <div className="flex gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => done(null)}
              className="flex-1 rounded-xl border border-slate-300 bg-white py-2.5 font-bold text-slate-700 hover:bg-slate-50 active:scale-95 transition-transform"
            >
              ไม่อนุมัติ / ยกเลิก
            </button>
            <button
              type="submit"
              disabled={!isValid}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#7c0a02] py-2.5 font-bold text-white shadow-md hover:bg-[#600801] disabled:opacity-40 active:scale-95 transition-transform"
            >
              <UserCheck size={14} />
              <span>ยืนยันและเช็กชื่อ</span>
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
