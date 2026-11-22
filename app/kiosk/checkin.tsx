'use client';
import { useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { PasswordInput } from '../password-input';
import { LoginHelp } from '../register/registration-admin';
import { RegistrationFrame } from '../register/registration-frame';
import { errorText, normalizeDigits, signupRpc, type SignupInfo, type Station } from '@/lib/event-registration';
import { CheckCircle2, Clock3, Loader2, QrCode, ScanLine, UserCheck, Users } from 'lucide-react';

export function KioskCheckin({ station, onExit }: { station: Station; onExit: () => void }) {
  const [info, setInfo] = useState<SignupInfo>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ student_id: string; full_name: string; status: string }>();
  const [url, setUrl] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const lock = useRef(false);

  useEffect(() => {
    let active = true;
    setUrl((process.env.NEXT_PUBLIC_NATIVE_PUBLIC_SITE || window.location.origin) + '/?event=' + encodeURIComponent(station.event));
    signupRpc<SignupInfo>('registration_info', { p_event: station.event })
      .then(data => { if (active) setInfo(data); })
      .catch(error => { if (active) setError(errorText(error)); });
    return () => { active = false; };
  }, [station.event]);

  useEffect(() => {
    if (!result) return;
    const expires = Date.now() + 90000;
    const clear = () => { if (Date.now() >= expires) setResult(undefined); };
    const timer = setTimeout(clear, 90000);
    document.addEventListener('visibilitychange', clear);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', clear); };
  }, [result]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => { if (!lock.current) form.current?.reset(); }, 300000); };
    reset();
    document.addEventListener('pointerdown', reset);
    document.addEventListener('keydown', reset);
    return () => { clearTimeout(timer); document.removeEventListener('pointerdown', reset); document.removeEventListener('keydown', reset); };
  }, []);

  async function checkin(element: HTMLFormElement) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    const data = new FormData(element);
    try {
      const response = await signupRpc<NonNullable<typeof result>>('registration_station_checkin', {
        p_station: station.token, p_event: station.event,
        p_student_id: normalizeDigits(String(data.get('student_id') || '')),
        p_password: String(data.get('password') || ''),
      });
      element.reset(); setResult(response);
    } catch (error) { setError(errorText(error)); }
    finally { lock.current = false; setBusy(false); }
  }

  return (
    <RegistrationFrame kiosk title={info?.event?.title || 'เช็กอินเข้าร่วมกิจกรรม'} location={info?.event?.location}>
      {error && (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {result ? (
        /* Success screen */
        <div className="space-y-5 text-center">
          <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl shadow-md text-white ${result.status === 'COMPLETED' ? 'bg-emerald-600' : 'bg-amber-500'}`}>
            {result.status === 'COMPLETED' ? <CheckCircle2 size={30} strokeWidth={2.5} /> : <Clock3 size={30} strokeWidth={2.5} />}
          </div>
          <div>
            <h2 className={`text-xl font-extrabold ${result.status === 'COMPLETED' ? 'text-emerald-800' : 'text-amber-900'}`}>
              {result.status === 'COMPLETED' ? 'เข้าร่วมกิจกรรมสำเร็จแล้ว' : 'กำลังเข้าร่วมกิจกรรม'}
            </h2>
            <p className="mt-1 text-sm font-semibold text-slate-700">{result.full_name}</p>
            <p className="text-xs text-slate-500 font-mono">{result.student_id}</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="mb-3 flex items-center justify-center gap-1.5 text-xs font-bold text-slate-600">
              <QrCode size={14} />
              <span>สแกนเพื่อเปิด Event Pass</span>
            </p>
            <div className="qr-ticket flex justify-center rounded-xl p-3 bg-white border border-slate-100">
              <QRCodeCanvas value={url} size={200} marginSize={3} />
            </div>
            <p className="mt-3 text-xs text-slate-500">ใช้มือถือสแกน แล้วเข้าสู่ระบบด้วยบัญชีของคุณ</p>
            <p className="mt-1 flex items-center justify-center gap-1 text-[11px] text-slate-400">
              <Clock3 size={11} />
              <span>หน้าจอนี้จะล้างข้อมูลใน 90 วินาที</span>
            </p>
          </div>

          <button
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#7c0a02] px-4 py-3 font-bold text-white shadow-sm transition hover:bg-[#620701] active:scale-95"
            onClick={() => { setResult(undefined); setError(''); }}
          >
            <Users size={16} />
            <span>เสร็จแล้ว · คนถัดไป</span>
          </button>
        </div>
      ) : (
        /* Login form */
        <form
          ref={form}
          className="space-y-4"
          autoComplete="off"
          onSubmit={event => { event.preventDefault(); void checkin(event.currentTarget); }}
        >
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#7c0a02]/10 text-[#7c0a02]">
              <ScanLine size={16} />
            </div>
            <h2 className="text-lg font-extrabold text-slate-900">ยืนยันบัญชีเพื่อเช็กอินเข้างาน</h2>
          </div>

          <div className="space-y-3">
            <label className="block text-sm font-semibold text-slate-700">
              รหัสนักศึกษา
              <input
                name="student_id"
                required
                inputMode="numeric"
                pattern="[0-9๐-๙]{7,8}"
                maxLength={8}
                className="mt-1.5 block h-12 w-full rounded-xl border border-slate-300 px-4 text-base font-mono focus:border-[#7c0a02] focus:outline-none focus:ring-2 focus:ring-[#7c0a02]/20"
                placeholder="เช่น 6801234"
              />
            </label>

            <label className="block text-sm font-semibold text-slate-700">
              รหัสผ่าน
              <PasswordInput
                name="password"
                required
                autoComplete="off"
                className="mt-1.5 block h-12 w-full rounded-xl border border-slate-300 px-4 text-base"
              />
              <small className="mt-1 block font-normal text-slate-500">
                รหัสผ่านเริ่มต้นคือวันเกิด พ.ศ. 8 หลัก เช่น 01012549
              </small>
            </label>
          </div>

          <button
            disabled={busy || !info?.event || info.event.closed}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#7c0a02] px-4 py-3.5 font-extrabold text-white shadow-md transition hover:bg-[#620701] active:scale-95 disabled:opacity-50"
          >
            {busy ? (
              <><Loader2 size={18} className="animate-spin" /><span>กำลังเช็กอิน…</span></>
            ) : (
              <><UserCheck size={18} /><span>ยืนยันและเช็กอินเข้างาน</span></>
            )}
          </button>
        </form>
      )}

      <LoginHelp popupOnly loginFailed={error.includes('รหัสผ่านไม่ถูกต้อง')} />
      <footer>
        <button disabled={busy} onClick={onExit} className="action-secondary">
          ออกจากบัญชีเครื่อง
        </button>
      </footer>
    </RegistrationFrame>
  );
}
