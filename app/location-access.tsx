'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Navigation, RefreshCw, AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';

export type LocationFix = {
  lat: number;
  lon: number;
  accuracy: number;
  timestamp: number;
};

export function useLocationAccess(enabled = true) {
  const latest = useRef<LocationFix | null>(null);
  const watch = useRef<number | null>(null);
  const [message, setMessage] = useState('กำลังเตรียมการตรวจสอบพิกัด GPS…');
  const [attempted, setAttempted] = useState(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const stop = useCallback(() => {
    if (watch.current !== null) {
      navigator.geolocation?.clearWatch(watch.current);
      watch.current = null;
    }
  }, []);

  const request = useCallback(() => {
    stop();
    latest.current = null;
    setReady(false);
    setLoading(true);
    setAttempted(true);
    setPermissionDenied(false);

    if (!navigator.geolocation || !window.isSecureContext) {
      setLoading(false);
      setMessage('อุปกรณ์นี้ไม่รองรับ GPS หรือไม่ได้เปิดใช้งานผ่าน HTTPS');
      return;
    }

    setMessage('กำลังจับสัญญาณดาวเทียม GPS… กรุณากด "อนุญาต" บนเบราว์เซอร์');

    watch.current = navigator.geolocation.watchPosition(
      p => {
        const fix: LocationFix = {
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: p.coords.accuracy,
          timestamp: p.timestamp,
        };
        latest.current = fix;
        setAccuracy(Math.round(p.coords.accuracy));
        setReady(true);
        setLoading(false);
        setMessage(`รับสัญญาณ GPS เรียบร้อย · ความแม่นยำ ±${Math.round(p.coords.accuracy)} เมตร`);
      },
      e => {
        latest.current = null;
        setReady(false);
        setLoading(false);
        setAccuracy(null);
        if (e.code === 1) {
          setPermissionDenied(true);
          setMessage('ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง: กรุณากดเปิดสิทธิ์ Location ในเบราว์เซอร์');
        } else {
          setMessage('ยังไม่สามารถจับสัญญาณ GPS ได้ กรุณาเปิด Location Service ของเครื่อง หรือย้ายไปบริเวณที่โปร่ง');
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 }
    );
  }, [stop]);

  useEffect(() => {
    if (enabled) {
      request();
    } else {
      stop();
      latest.current = null;
      setReady(false);
      setLoading(false);
    }
    return stop;
  }, [enabled, request, stop]);

  const read = useCallback(() => {
    const p = latest.current;
    return p && Math.abs(Date.now() - p.timestamp) <= 30000 ? p : null;
  }, []);

  return { message, attempted, ready, loading, accuracy, permissionDenied, request, read };
}

export function LocationAccess({ gps, compact = false }: { gps: ReturnType<typeof useLocationAccess>; compact?: boolean }) {
  if (gps.ready) {
    return (
      <div className="my-2.5 flex items-center justify-between gap-3 rounded-2xl border border-emerald-200/90 bg-emerald-50/80 px-3.5 py-2.5 text-xs text-emerald-900 shadow-sm backdrop-blur-sm">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
          </span>
          <div className="min-w-0">
            <p className="font-bold flex items-center gap-1 truncate">
              <MapPin size={13} className="text-emerald-700 flex-shrink-0" />
              <span>พิกัด GPS เชื่อมต่อแล้ว</span>
              {gps.accuracy !== null && (
                <span className="rounded-full bg-emerald-200/70 px-1.5 py-0.2 text-[10px] font-extrabold text-emerald-800">
                  ±{gps.accuracy} ม.
                </span>
              )}
            </p>
            {!compact && <p className="text-[11px] text-emerald-700/90 truncate">สัญญาณดาวเทียมแม่นยำ พร้อมใช้ยืนยันการสแกน</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={gps.request}
          title="รีเฟรชสัญญาณ GPS"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 transition-colors hover:bg-emerald-200 active:scale-95"
        >
          <RefreshCw size={12} />
        </button>
      </div>
    );
  }

  if (gps.loading) {
    return (
      <div className="my-2.5 flex items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50/90 px-4 py-3 text-xs text-sky-900 shadow-sm">
        <Loader2 size={16} className="animate-spin text-sky-600 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-bold">กำลังค้นหาสัญญาณดาวเทียม GPS…</p>
          <p className="text-[11px] text-sky-700">กรุณากด &quot;อนุญาต&quot; หากเบราว์เซอร์ถามสิทธิ์เข้าถึงตำแหน่ง</p>
        </div>
      </div>
    );
  }

  return (
    <div className="my-2.5 rounded-2xl border border-amber-200 bg-amber-50/90 p-3.5 text-xs text-amber-950 shadow-sm">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-bold">{gps.permissionDenied ? 'ยังไม่ได้รับอนุญาตพิกัด GPS' : 'ยังไม่สามารถรับสัญญาณ GPS ได้'}</p>
          <p className="mt-0.5 text-[11px] text-amber-800 leading-relaxed">
            {gps.permissionDenied
              ? 'กรุณากดไอคอนแม่กุญแจที่แถบ URL ของเบราว์เซอร์ → เลือก "สิทธิ์/Permissions" → เปิด "ตำแหน่ง/Location"'
              : gps.message}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={gps.request}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3 py-1.5 font-bold text-white shadow-sm hover:bg-amber-700 active:scale-95"
            >
              <Navigation size={12} />
              <span>{gps.attempted ? 'ขอตำแหน่งอีกครั้ง' : 'เปิดใช้งาน GPS'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
