// A browser credential, not a claim to identify physical hardware.
export function getDeviceSecret(): string {
  const key='aru-device-secret-v1';
  try {
    const saved=localStorage.getItem(key);
    if(saved && /^[0-9a-f]{64}$/.test(saved))return saved;
    const secret=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
    localStorage.setItem(key,secret);
    return secret;
  } catch { throw new Error('กรุณาอนุญาตการจัดเก็บข้อมูลเว็บไซต์เพื่อยืนยันเครื่องที่ใช้งาน'); }
}
