'use client';
import { useEffect, useRef, useState } from 'react';
import { errorText, signupRpc } from '@/lib/event-registration';
import { AlertCircle, Calendar, CheckCircle2, Loader2, MapPin, Plus, QrCode, RefreshCw } from 'lucide-react';

type EventInfo = { id: string; title: string; location: string };
export function OpenEvents({ token, refresh, select, events }: {
  token: string; refresh: () => Promise<void>; select: (id: string) => void;
  events: { id: string; status: string }[];
}) {
  const [available, setAvailable] = useState<EventInfo[]>([]);
  const [loadError, setLoadError] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joined, setJoined] = useState<{ event: EventInfo; pending: boolean; ready: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, reload] = useState(0);
  const lock = useRef(false);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true); setLoadError('');
    signupRpc<EventInfo[]>('student_open_events', { p_token: token })
      .then(data => { if (active) setAvailable(data); })
      .catch(error => { if (active) setLoadError(errorText(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, revision]);

  async function syncJoined() {
    if (lock.current) return;
    lock.current = true; setBusy('refresh'); setJoinError('');
    try { await refresh(); setJoined(previous => previous ? { ...previous, ready: true } : null); }
    catch { setJoinError('สมัครสำเร็จแล้ว แต่โหลดบัตรไม่สำเร็จ กรุณาลองโหลดบัตรอีกครั้ง'); }
    finally { lock.current = false; setBusy(null); }
  }
  async function join(event: EventInfo) {
    if (lock.current) return;
    lock.current = true; setBusy(event.id); setJoinError(''); setJoined(null);
    try {
      const result = await signupRpc<{ pending?: boolean; already?: boolean }>('registration_join', { p_event: event.id, p_token: token });
      setAvailable(previous => previous.filter(item => item.id !== event.id));
      setJoined({ event, pending: Boolean(result.pending), ready: false });
      try { await refresh(); setJoined({ event, pending: Boolean(result.pending), ready: true }); }
      catch { setJoinError('สมัครสำเร็จแล้ว แต่โหลดบัตรไม่สำเร็จ กรุณาลองโหลดบัตรอีกครั้ง'); }
      reload(value => value + 1);
    } catch (error) { setJoinError(errorText(error)); }
    finally { lock.current = false; setBusy(null); }
  }
  if (!token) return null;
  const scanReady = joined && events.some(event => event.id === joined.event.id && event.status === 'ACTIVE');
  return <section className="bento overflow-hidden" aria-label="กิจกรรมที่เปิดรับสมัคร">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4 sm:p-5">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-rose-50 p-2.5 text-[#7c0a02]"><Calendar size={22} /></span><div><h2 className="text-lg font-bold">กิจกรรมที่เปิดรับสมัคร</h2><p className="mt-1 text-sm text-slate-600">เลือกกิจกรรมที่สนใจ แล้วเตรียมตัวเข้าร่วม</p></div></div>
      <button type="button" className="action-secondary" disabled={Boolean(busy) || loading} onClick={() => reload(value => value + 1)}><RefreshCw size={18} className={loading ? 'animate-spin' : ''} />รีเฟรช</button>
    </div>
    <div className="space-y-4 p-4 sm:p-5">
      {joined && <div role="status" className={`rounded-2xl border p-4 ${joined.pending ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-emerald-200 bg-emerald-50 text-emerald-950'}`}>
        <div className="flex items-start gap-3"><CheckCircle2 size={22} /><div><p className="font-bold">{joined.pending ? 'ส่งใบสมัครแล้ว รอแอดมินยืนยัน' : 'ลงทะเบียนเรียบร้อยแล้ว'}</p><p className="mt-1 text-sm">{joined.event.title}</p></div></div>
        {joined.ready && !joined.pending && <button type="button" className="action-primary mt-4 w-full sm:w-auto" onClick={() => select(joined.event.id)}><QrCode size={20} />{scanReady ? 'เปิด QR กิจกรรมนี้' : 'ดูรายละเอียดกิจกรรม'}</button>}
      </div>}
      {joinError && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900"><p>{joinError}</p>{joined && !joined.ready && <button type="button" className="action-secondary mt-3" disabled={Boolean(busy)} onClick={() => void syncJoined()}>ลองโหลดบัตรอีกครั้ง</button>}</div>}
      {loadError && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900"><p className="flex items-center gap-2 font-bold"><AlertCircle size={20} />โหลดกิจกรรมไม่สำเร็จ</p><p className="mt-2 text-sm">{loadError}</p><button type="button" className="action-secondary mt-3" disabled={loading} onClick={() => reload(value => value + 1)}>ลองอีกครั้ง</button></div>}
      {loading && !available.length && <div role="status" className="flex items-center justify-center gap-3 py-8 text-slate-600"><Loader2 size={22} className="animate-spin" />กำลังโหลดกิจกรรม…</div>}
      {!loading && !loadError && !available.length && <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-8 text-center"><Calendar size={28} className="mx-auto mb-3 text-slate-500" /><p className="font-medium text-slate-700">ยังไม่มีกิจกรรมใหม่ที่เปิดรับสมัคร</p><p className="mt-1 text-sm text-slate-600">กลับมาดูอีกครั้งเมื่อมีประกาศกิจกรรมใหม่</p></div>}
      {available.map(event => <article key={event.id} className="student-event-card flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1"><h3 className="text-base font-bold text-slate-900">{event.title}</h3>{event.location && <p className="mt-2 flex items-start gap-2 text-sm text-slate-600"><MapPin size={18} />{event.location}</p>}</div>
        <button type="button" className="action-primary w-full sm:w-auto" disabled={Boolean(busy)} onClick={() => void join(event)}>{busy === event.id ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}{busy === event.id ? 'กำลังสมัคร…' : 'สมัครเข้าร่วม'}</button>
      </article>)}
    </div>
  </section>;
}
