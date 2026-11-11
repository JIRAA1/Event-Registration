export function birthDateToInput(value:string):string {
  const digits=value.trim().replace(/[๐-๙]/g,d=>String(d.charCodeAt(0)-0x0e50));
  if(!/^\d{8}$/.test(digits))return '';
  const iso=String(Number(digits.slice(4))-543).padStart(4,'0')+'-'+digits.slice(2,4)+'-'+digits.slice(0,2);
  return birthDateFromInput(iso)?iso:'';
}

export function birthDateFromInput(value:string):string {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return '';
  const [year,month,day]=value.split('-').map(Number);
  const date=new Date(0);
  date.setUTCFullYear(year,month-1,day);
  if(year<1 || year+543>9999 || date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day)return '';
  return value.slice(8,10)+value.slice(5,7)+String(year+543).padStart(4,'0');
}
