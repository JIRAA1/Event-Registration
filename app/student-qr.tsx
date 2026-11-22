'use client';

import { useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { getDeviceSecret } from '@/lib/device-identity';
import { LocationAccess, useLocationAccess } from './location-access';
import { supabase } from '@/lib/supabase';
import { MapPin, ShieldAlert, RefreshCw, AlertCircle, ScanLine, LogOut, CheckCircle2 } from 'lucide-react';

function cx(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(' ');
}

type Ticket = { token: string; mode: string };

export function StudentQr({ session, eventId }: { session: string; eventId: string }) {
  const gps = useLocationAccess();
  const [fallback, setFallback] = useState(false);
  const readLocation = gps.read;
  const allowed = gps.ready || fallback;
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [message, setMessage] = useState('กำลังโหลด QR…');
  const [action, setAction] = useState<'retry' | null>(null);
  const request = useRef<(transfer: boolean) => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let version = 0;
    let timer: ReturnType<typeof setTimeout>;
    let deadline = 0;

    function clearCard() {
      version++;
      clearTimeout(timer);
      deadline = 0;
      setTicket(null);
      setAction(null);
    }
    async function load(transfer = false) {
      if (document.hidden || disposed || !allowed) return;
      clearTimeout(timer);
      const current = ++version;
      const started = Date.now();
      setAction(null);
      try {
        if (!supabase || !navigator.onLine) throw new Error();
        const { data, error } = await supabase.rpc('issue_location_qr', {
          p_session_token: session,
          p_event_id: eventId,
          p_device: getDeviceSecret(),
          p_location: readLocation(),
        });
        if (disposed || current !== version) return;
        if (error) throw error;
        if (!data?.success) {
          clearCard();
          setMessage(data?.message || 'ออก QR ไม่สำเร็จ');
          setAction('retry');
          return;
        }
        deadline = started + Number(data.ttl_ms);
        const left = deadline - Date.now();
        if (left <= 0) {
          clearCard();
          setMessage('กำลังต่ออายุบัตร…');
          timer = setTimeout(() => void load(), 250);
          return;
        }

        setTicket({ token: data.token, mode: data.mode });
        setRemaining(Math.ceil(left / 1000));
        // Revalidate ownership while visible. The server reuses a still-valid ticket.
        timer = setTimeout(() => void load(), Math.min(10000, left));
      } catch (error) {
        if (disposed || current !== version) return;
        clearCard();
        setMessage(error instanceof Error ? error.message : 'โหลด QR ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง');
        setAction('retry');
      }
    }
    function resume() {
      clearCard();
      setMessage('กำลังตรวจสอบบัตร…');
      if (!document.hidden) void load();
    }
    request.current = load;
    resume();
    const tick = setInterval(() => {
      if (deadline) setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 250);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', resume);
    return () => {
      disposed = true;
      clearInterval(tick);
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', resume);
    };
  }, [eventId, session, allowed, readLocation]);

  return (
    <div className="my-5 text-center max-w-sm mx-auto">
      {/* GPS Status Indicator */}
      <LocationAccess gps={gps} compact={Boolean(ticket)} />

      {/* Fallback Option when GPS is not ready */}
      {!gps.ready && !fallback && (
        <div className="my-3 rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 p-3.5 text-xs text-amber-900">
          <p className="font-bold">อุปกรณ์ไม่รองรับหรือเปิด GPS ไม่ได้?</p>
          <p className="mt-1 text-[11px] text-amber-800">
            คุณสามารถใช้โหมดพิเศษเพื่อแสดง QR ได้ แต่ต้องแสดงบัตรนักศึกษาตัวจริงให้สตาฟตรวจ
          </p>
          <button
            type="button"
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 font-bold text-amber-900 border border-amber-300 shadow-sm hover:bg-amber-100 active:scale-95"
            onClick={() => setFallback(true)}
          >
            <ShieldAlert size={14} className="text-amber-700" />
            <span>แสดง QR (โหมดตรวจตัวจริง)</span>
          </button>
        </div>
      )}

      {/* Fallback Active Banner */}
      {fallback && !gps.ready && (
        <div className="my-2 rounded-xl bg-amber-100 border border-amber-300 px-3 py-1.5 text-[11px] font-bold text-amber-900 flex items-center justify-center gap-1.5">
          <AlertCircle size={13} className="text-amber-700" />
          <span>โหมดไม่มี GPS: โปรดเตรียมบัตรนักศึกษาให้สตาฟตรวจ</span>
        </div>
      )}

      {/* QR Code Presentation */}
      {!allowed ? (
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-8">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-[#7c0a02]">
            <MapPin size={24} />
          </div>
          <p className="mt-3 text-sm font-bold text-slate-800">กรุณาอนุญาตพิกัด GPS</p>
          <p className="mt-1 text-xs text-slate-500">ระบบจำเป็นต้องใช้พิกัดเพื่อยืนยันว่านักศึกษาอยู่ในพื้นที่จัดกิจกรรม</p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={gps.request}
              className="rounded-xl bg-[#7c0a02] px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-[#600801] active:scale-95"
            >
              เปิดใช้งานตำแหน่ง (GPS)
            </button>
          </div>
        </div>
      ) : ticket && remaining > 0 ? (
        <div className="space-y-4">
          {/* Laser Scan Frame & Corners */}
          <div className="qr-frame relative mx-auto inline-block p-4 sm:p-5 rounded-3xl bg-white shadow-xl border border-amber-200/60">
            <div className="corner-reticle corner-tl" />
            <div className="corner-reticle corner-tr" />
            <div className="corner-reticle corner-bl" />
            <div className="corner-reticle corner-br" />
            <div className="qr-laser-beam" />
            <div className="qr-ticket flex justify-center">
              <QRCodeCanvas
                value={'ARU1:' + ticket.token}
                size={230}
                marginSize={3}
                level="M"
                fgColor="#000000"
                bgColor="#ffffff"
                role="img"
                aria-label="QR กิจกรรมแบบใช้ครั้งเดียว"
              />
            </div>
          </div>

          {/* Mode Pill & Countdown Tracker */}
          <div className="space-y-2">
            <div>
              <span
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold shadow-sm',
                  ticket.mode === 'CHECKIN'
                    ? 'border border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border border-sky-300 bg-sky-50 text-sky-800'
                )}
              >
                <span
                  className={cx(
                    'h-2 w-2 rounded-full animate-pulse',
                    ticket.mode === 'CHECKIN' ? 'bg-emerald-500' : 'bg-sky-500'
                  )}
                />
                {ticket.mode === 'CHECKIN' ? (
                  <span className="flex items-center gap-1">
                    <ScanLine size={13} />
                    <span>บัตรสแกนเข้า (Check-in)</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <LogOut size={13} />
                    <span>บัตรสแกนออก (Check-out)</span>
                  </span>
                )}
              </span>
            </div>

            {/* Micro Timer Bar */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50/90 py-2.5 px-3.5 shadow-sm">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-bold text-slate-600 text-[11px]">
                  <RefreshCw
                    size={12}
                    className={remaining <= 5 ? 'text-rose-500 animate-spin' : 'text-slate-400'}
                  />
                  <span>รหัสหมุนเวียนอัตโนมัติ</span>
                </span>
                <span className="font-mono text-xs font-black text-[#7c0a02]">
                  {remaining} วินาที
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className={cx(
                    'h-full rounded-full transition-all duration-300',
                    remaining <= 5
                      ? 'bg-rose-500'
                      : 'bg-gradient-to-r from-amber-500 to-[#7c0a02]'
                  )}
                  style={{ width: `${Math.max(0, Math.min(100, (remaining / 30) * 100))}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl bg-slate-50 px-4 py-8 border border-slate-200">
          <p role="status" className="text-sm font-semibold text-slate-600">
            {ticket ? 'กำลังต่ออายุบัตร…' : message}
          </p>
          {action && (
            <button
              type="button"
              className="mt-4 rounded-xl bg-[#7c0a02] px-5 py-3 text-xs font-bold text-white shadow-md hover:bg-[#600801] active:scale-95"
              onClick={() => {
                setMessage('กำลังตรวจสอบบัตร…');
                request.current(false);
              }}
            >
              โหลด QR ใหม่
            </button>
          )}
        </div>
      )}
    </div>
  );
}
