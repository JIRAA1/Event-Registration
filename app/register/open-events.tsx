'use client';
import { useEffect, useRef, useState } from 'react';
import { errorText, signupRpc } from '@/lib/event-registration';
import { Calendar, Clock3, Loader2, MapPin, Plus, RefreshCw } from 'lucide-react';

export function OpenEvents({ token, refresh }: { token: string; refresh: () => Promise<void> }) {
  const [events, setEvents] = useState<{ id: string; title: string; location: string }[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revision, reload] = useState(0);
  const lock = useRef(false);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    signupRpc<typeof events>('student_open_events', { p_token: token })
      .then(data => { if (active) setEvents(data); })
      .catch(error => { if (active) setNotice(errorText(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, revision]);

  async function join(id: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setNotice('');
    try {
      const result = await signupRpc<{ pending?: boolean; already?: boolean }>('registration_join', { p_event: id, p_token: token });
      setNotice(result.pending ? 'ส่งใบสมัครแล้ว รอแอดมินยืนยันเข้าร่วมกิจกรรม' : result.already ? 'คุณลงทะเบียนกิจกรรมนี้แล้ว' : 'ลงทะเบียนสำเร็จ เปิด QR ได้จากกิจกรรมที่ฉันลงทะเบียน');
      setEvents(previous => previous.filter(event => event.id !== id));
      await refresh();
    } catch (error) { setNotice(errorText(error)); }
    finally { lock.current = false; setBusy(false); reload(value => value + 1); }
  }

  if (!token) return null;

  return (
    <section className="bento overflow-hidden" aria-label="กิจกรรมที่เปิดรับสมัคร">
      {/* Section Header */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-4 sm:p-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#7c0a02]/10 text-[#7c0a02]">
            <Calendar size={16} />
          </div>
          <h2 className="text-sm font-extrabold text-slate-900">กิจกรรมที่เปิดรับสมัคร</h2>
        </div>
        <button
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm transition hover:border-[#7c0a02] hover:text-[#7c0a02] active:scale-95 disabled:opacity-50"
          disabled={busy || loading}
          onClick={() => reload(v => v + 1)}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          <span>รีเฟรช</span>
        </button>
      </div>

      <div className="p-4 sm:p-5 space-y-3">
        {/* Notice Banner */}
        {notice && (
          <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-xs font-semibold text-amber-900">
            {notice}
          </div>
        )}

        {/* Loading State */}
        {loading && !events.length && (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400">
            <Loader2 size={16} className="animate-spin" />
            <span>กำลังโหลดกิจกรรม…</span>
          </div>
        )}

        {/* Empty State */}
        {!loading && !events.length && (
          <div className="rounded-2xl border border-dashed border-slate-200 py-8 text-center">
            <Calendar size={28} className="mx-auto mb-2 text-slate-300" />
            <p className="text-xs text-slate-400">ยังไม่มีกิจกรรมใหม่ที่เปิดรับสมัคร</p>
          </div>
        )}

        {/* Event Items */}
        {events.map(event => (
          <article
            key={event.id}
            className="group flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-[#7c0a02]/40 hover:shadow-md"
          >
            <div className="min-w-0 flex-1">
              <h3 className="break-words text-sm font-extrabold text-slate-900 group-hover:text-[#7c0a02] transition-colors">
                {event.title}
              </h3>
              {event.location && (
                <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                  <MapPin size={12} className="text-[#7c0a02] flex-shrink-0" />
                  <span>{event.location}</span>
                </p>
              )}
            </div>
            <button
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#7c0a02] px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#620701] active:scale-95 disabled:opacity-60"
              disabled={busy}
              onClick={() => void join(event.id)}
            >
              <Plus size={13} />
              <span>สมัครเข้าร่วม</span>
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
