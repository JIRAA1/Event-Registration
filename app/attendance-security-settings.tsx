'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ShieldCheck, MapPin, Navigation, UserX, Loader2, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';

export function AttendanceSecuritySettings({ token, eventId }: { token: string; eventId: string }) {
  const [radius, setRadius] = useState(100);
  const [accuracy, setAccuracy] = useState(50);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [student, setStudent] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    let disposed = false;
    setLoaded(false);
    void supabase
      ?.rpc('admin_scan_security', { p_token: token, p_event: eventId })
      .then(({ data, error }) => {
        if (disposed) return;
        if (error) {
          setStatus({ ok: false, text: error.message });
          return;
        }
        setRadius(data.radius_m);
        setAccuracy(data.accuracy_m);
        setLoaded(true);
      });
    return () => {
      disposed = true;
    };
  }, [token, eventId]);

  async function save() {
    if (busy || !supabase) return;
    setBusy(true);
    setStatus(null);
    try {
      const { error } = await supabase.rpc('admin_scan_security', {
        p_token: token,
        p_event: eventId,
        p_radius: radius,
        p_accuracy: accuracy,
      });
      if (error) {
        setStatus({ ok: false, text: error.message });
      } else {
        setStatus({ ok: true, text: 'บันทึกเกณฑ์ระยะห่าง GPS สำหรับกิจกรรมนี้เรียบร้อยแล้ว' });
      }
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (resetBusy || !supabase) return;
    setResetBusy(true);
    setStatus(null);
    try {
      const { error } = await supabase.rpc('admin_reset_student_device', {
        p_token: token,
        p_student_id: student,
        p_reason: reason,
      });
      if (error) {
        setStatus({ ok: false, text: error.message });
      } else {
        setStatus({
          ok: true,
          text: `ปลดล็อกบัญชี ${student} เรียบร้อยแล้ว นักศึกษาสามารถเข้าสู่ระบบบนเครื่องใหม่ได้ทันที`,
        });
        setStudent('');
        setReason('');
      }
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <div className="mb-6 space-y-5">
      {/* Alert Banner */}
      {status && (
        <div
          className={`flex items-start gap-2.5 rounded-2xl p-4 text-xs font-semibold shadow-sm border transition-all ${
            status.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}
        >
          {status.ok ? (
            <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle size={16} className="text-rose-600 flex-shrink-0 mt-0.5" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-bold">{status.ok ? 'สำเร็จ' : 'เกิดข้อผิดพลาด'}</p>
            <p className="mt-0.5 leading-relaxed">{status.text}</p>
          </div>
        </div>
      )}

      {/* GPS Settings Card */}
      <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-50 text-[#7c0a02]">
            <MapPin size={20} />
          </span>
          <div>
            <h3 className="text-sm font-extrabold text-slate-900">กำหนดระยะห่าง GPS ตอนสแกน (รายกิจกรรม)</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              ควบคุมไม่ให้นักศึกษาฝากเพื่อนสแกนจากนอกพื้นที่จัดงาน
            </p>
          </div>
        </div>

        <form
          onSubmit={e => {
            e.preventDefault();
            void save();
          }}
          className="mt-5 space-y-4 text-xs"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Radius setting */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <label className="block font-bold text-slate-800">
                ระยะห่างจากสตาฟสูงสุด (เมตร)
              </label>
              <p className="mt-0.5 text-[11px] text-slate-500">
                หากนักศึกษาอยู่ไกลกว่านี้ ระบบจะเด้งถามสตาฟ
              </p>
              <div className="mt-3 flex items-center gap-2">
                <input
                  required
                  type="number"
                  min={10}
                  max={1000}
                  value={radius}
                  onChange={e => setRadius(Number(e.target.value))}
                  className="h-10 w-28 rounded-xl border border-slate-300 bg-white px-3 font-mono text-sm font-extrabold text-slate-900 focus:border-[#7c0a02] focus:outline-none"
                />
                <span className="font-bold text-slate-500">เมตร</span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {[50, 100, 200, 500].map(val => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setRadius(val)}
                    className={`rounded-lg px-2 py-1 text-[10px] font-bold border transition-colors ${
                      radius === val
                        ? 'border-[#7c0a02] bg-[#7c0a02] text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {val} ม.
                  </button>
                ))}
              </div>
            </div>

            {/* Accuracy setting */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <label className="block font-bold text-slate-800">
                ความคลาดเคลื่อน GPS สูงสุด (เมตร)
              </label>
              <p className="mt-0.5 text-[11px] text-slate-500">
                เกณฑ์ความแม่นยำของดาวเทียมที่ยอมรับได้
              </p>
              <div className="mt-3 flex items-center gap-2">
                <input
                  required
                  type="number"
                  min={5}
                  max={200}
                  value={accuracy}
                  onChange={e => setAccuracy(Number(e.target.value))}
                  className="h-10 w-28 rounded-xl border border-slate-300 bg-white px-3 font-mono text-sm font-extrabold text-slate-900 focus:border-[#7c0a02] focus:outline-none"
                />
                <span className="font-bold text-slate-500">เมตร</span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {[25, 50, 75, 100].map(val => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setAccuracy(val)}
                    className={`rounded-lg px-2 py-1 text-[10px] font-bold border transition-colors ${
                      accuracy === val
                        ? 'border-[#7c0a02] bg-[#7c0a02] text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {val} ม.
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-[11px] text-slate-500">
              * ค่าแนะนำ: รัศมี 100 เมตร / ความคลาดเคลื่อน 50 เมตร
            </span>
            <button
              type="submit"
              disabled={busy || !loaded}
              className="inline-flex items-center gap-2 rounded-xl bg-[#7c0a02] px-5 py-2.5 font-bold text-white shadow-sm hover:bg-[#600801] disabled:opacity-40 active:scale-95 transition-transform"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              <span>บันทึกเกณฑ์ GPS</span>
            </button>
          </div>
        </form>
      </section>

      {/* Reset Student Device Card */}
      <section className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
            <UserX size={20} />
          </span>
          <div>
            <h3 className="text-sm font-extrabold text-slate-900">ปลดล็อกเครื่องนักศึกษา (Device Reset)</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              ใช้ในกรณีที่นักศึกษาทำโทรศัพท์หาย เปลี่ยนเครื่อง หรือเปิดเว็บใหม่ไม่ได้
            </p>
          </div>
        </div>

        <form
          onSubmit={e => {
            e.preventDefault();
            void reset();
          }}
          className="mt-5 space-y-4 text-xs"
        >
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3.5 text-[11px] text-amber-900">
            💡 <strong>คำแนะนำ:</strong> เมื่อกดปลดล็อกแล้ว เซสชันเดิมบนเครื่องเก่าจะถูกตัดทันที นักศึกษาสามารถเข้าสู่ระบบบนเครื่องใหม่ได้เลย โดยประวัติการลงทะเบียนและสถานะการเข้าร่วมกิจกรรมยังอยู่ครบถ้วน
          </div>

          <div>
            <label className="block font-bold text-slate-700">
              รหัสนักศึกษา <span className="text-rose-500">*</span>
            </label>
            <input
              required
              value={student}
              onChange={e => setStudent(e.target.value)}
              placeholder="เช่น 6801234"
              className="mt-1.5 h-10 w-full max-w-sm rounded-xl border border-slate-300 bg-slate-50 px-3 font-mono text-xs font-semibold text-slate-900 focus:border-[#7c0a02] focus:bg-white focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700">
              เหตุผลในการปลดล็อก <span className="text-rose-500">*</span>
            </label>
            <textarea
              required
              minLength={5}
              maxLength={500}
              rows={2}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="ระบุเหตุผล เช่น โทรศัพท์แบตเตอรี่หมด ตรวจบัตรตัวจริงแล้ว..."
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-slate-50 p-2.5 text-xs text-slate-900 focus:border-[#7c0a02] focus:bg-white focus:outline-none"
            />
            <span className="text-[10px] text-slate-400">ต้องการอย่างน้อย 5 ตัวอักษร</span>
          </div>

          <button
            type="submit"
            disabled={resetBusy || !loaded || reason.trim().length < 5 || !student.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-700 px-5 py-2.5 font-bold text-white shadow-sm hover:bg-amber-800 disabled:opacity-40 active:scale-95 transition-transform"
          >
            {resetBusy ? <Loader2 size={14} className="animate-spin" /> : <UserX size={14} />}
            <span>ยืนยันปลดล็อกเครื่อง</span>
          </button>
        </form>
      </section>
    </div>
  );
}
