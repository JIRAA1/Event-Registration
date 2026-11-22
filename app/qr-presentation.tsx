'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

// Keep the live QR mounted while changing its presentation, so enlarging it
// never starts a second ticket request or displays a stale copy.
export function QrPresentation({ title, children }: { title: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [expanded, setExpanded] = useState(false);
  function resize(next: boolean) {
    const element = dialog.current;
    if (!element) return;
    element.close();
    if (next) element.showModal();
    else element.show();
    setExpanded(next);
    trigger.current?.focus();
  }
  return <dialog ref={dialog} open aria-labelledby={titleId} aria-modal={expanded || undefined}
    className={`qr-presentation ${expanded ? 'qr-presentation-expanded' : ''}`}
    onCancel={event => { event.preventDefault(); resize(false); }}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="text-sm font-semibold text-[#7c0a02]">บัตรเข้าร่วมกิจกรรม</p>
        <h2 id={titleId} className="mt-1 break-words text-lg font-bold text-slate-900">{title}</h2></div>
      <button ref={trigger} type="button" className="action-secondary shrink-0" onClick={() => resize(!expanded)} aria-label={expanded ? 'ย่อ QR กลับ' : 'ขยาย QR เต็มหน้าจอ'}>
        {expanded ? <Minimize2 size={20} /> : <Maximize2 size={20} />}<span className="hidden sm:inline">{expanded ? 'ย่อกลับ' : 'ขยาย QR'}</span>
      </button>
    </div>
    {children}
  </dialog>;
}
