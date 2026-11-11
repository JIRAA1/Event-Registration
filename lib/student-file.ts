function csvRows(text:string,delimiter:string):string[][] {
  const rows:string[][]=[];
  let row:string[]=[];
  let cell='';
  let quoted=false;
  for(let index=0;index<text.length;index++){
    const char=text[index];
    if(char==='"'){
      if(quoted && text[index+1]==='"'){cell+='"';index++;}
      else quoted=!quoted;
    }else if(!quoted && char===delimiter){row.push(cell.trim());cell='';}
    else if(!quoted && (char==='\r' || char==='\n')){
      if(char==='\r' && text[index+1]==='\n')index++;
      row.push(cell.trim());rows.push(row);row=[];cell='';
    }else cell+=char;
  }
  if(quoted)throw new Error('เครื่องหมายคำพูดในไฟล์ CSV ไม่ครบ กรุณาตรวจไฟล์');
  row.push(cell.trim());rows.push(row);
  return rows.filter(values=>values.some(value=>value!==''));
}

export async function readStudentFile(file:File):Promise<string[][]>{
  if(/\.csv$/i.test(file.name)){
    const text=(await file.text()).replace(/^\uFEFF/,'');
    const comma=csvRows(text,',');
    const semicolon=csvRows(text,';');
    return (semicolon[0]?.length||0)>(comma[0]?.length||0)?semicolon:comma;
  }
  if(!/\.xlsx$/i.test(file.name))throw new Error('กรุณาเลือกไฟล์ CSV หรือ Excel .xlsx');
  try{
    const {readSheet}=await import('read-excel-file/browser');
    const rows=await readSheet(file);
    return rows.map(row=>row.map(value=>{
      if(value instanceof Date){
        const year=value.getUTCFullYear();
        return String(value.getUTCDate()).padStart(2,'0')+'/'+String(value.getUTCMonth()+1).padStart(2,'0')+'/'+(year>=2400?year:year+543);
      }
      return String(value??'').trim();
    })).filter(row=>row.some(value=>value!==''));
  }catch{
    throw new Error('อ่านไฟล์ Excel ไม่สำเร็จ กรุณาใช้ไฟล์ .xlsx ที่เปิดได้และไม่มีรหัสผ่าน');
  }
}
