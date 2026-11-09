'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

type BrowserInfo = Pick<Navigator, 'userAgent' | 'vendor'> & {
  userAgentData?: { brands: readonly { brand: string }[] };
  brave?: unknown;
};

export function acceptsBrowser(browser: BrowserInfo) {
  const ua = browser.userAgent;
  const embedded = /\b(?:Line\/|FBAN|FBAV|FB_IAB|Instagram|Messenger|GSA\/|wv\b)/i;
  const alternative = /(?:Edg(?:A|iOS|e)?|OPR|OPiOS|SamsungBrowser|Firefox|FxiOS|Chromium|DuckDuckGo|YaBrowser|Vivaldi|UCBrowser)\//i;
  if (embedded.test(ua) || alternative.test(ua) || browser.brave) return false;
  const brands = browser.userAgentData?.brands;
  if (brands?.length) return brands.some(({brand}) => brand === 'Google Chrome');
  if (/\bCriOS\/\d/.test(ua)) return true;
  if (/\bChrome\/\d/.test(ua)) return browser.vendor === 'Google Inc.';
  return browser.vendor === 'Apple Computer, Inc.' && /Version\/\d/.test(ua) && /Safari\/\d/.test(ua);
}

export default function BrowserGate({children}: {children: ReactNode}) {
  const [allowed,setAllowed] = useState<boolean | null>(null);
  const [address,setAddress] = useState('');
  const [feedback,setFeedback] = useState('');
  const linkInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setAddress(window.location.origin + window.location.pathname);
    setAllowed(acceptsBrowser(navigator));
  }, []);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(address);
      setFeedback('คัดลอกแล้ว เปิด Chrome หรือ Safari แล้ววางลิงก์ได้เลย');
    } catch {
      linkInput.current?.focus();
      linkInput.current?.select();
      setFeedback('แตะค้างที่ลิงก์แล้วเลือกคัดลอก');
    }
  }

  if (allowed) return children;
  return <main className="canvas-grid grid min-h-screen place-items-center p-4">
    {allowed === null ? <p role="status">กำลังตรวจสอบเบราว์เซอร์…</p> :
      <section className="bento w-full max-w-md space-y-4 p-6 sm:p-8">
        <img src="/aru-icon.jpg" alt="ARU Event Pass" width={48} height={48} className="rounded-xl"/>
        <h1 className="text-2xl font-bold text-slate-900">กรุณาเปิดด้วย Chrome หรือ Safari</h1>
        <p className="text-sm leading-6 text-slate-700">หากเปิดจาก LINE หรือ Facebook ให้แตะเมนูและเลือกเปิดในเบราว์เซอร์ภายนอก หรือคัดลอกลิงก์ไปวางใน Chrome หรือ Safari</p>
        <input ref={linkInput} aria-label="ลิงก์ Event Pass" readOnly value={address} onFocus={e=>e.target.select()} className="w-full rounded-xl border border-slate-300 bg-white p-3"/>
        <button type="button" onClick={copyLink} className="w-full rounded-xl bg-[#7c0a02] p-3 font-bold text-white">คัดลอกลิงก์</button>
        <p role="status" className="text-sm text-slate-700">{feedback}</p>
      </section>}
  </main>;
}
