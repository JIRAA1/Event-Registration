type Reply = {data: {success?:boolean;message?:string;added_count?:number;matched_count?:number;waiting_count?:number;available_count?:number}|null;error:{code?:string;message:string}|null};

// Do not retry ambiguous network failures automatically. A user can safely rerun:
// inserts skip duplicates and matching only considers unassigned registrations.
export async function addPasscodeBatches(codes:string[],send:(batch:string[])=>PromiseLike<Reply>,progress:(done:number,total:number,added:number)=>void){
  let done=0,added=0,size=50;
  progress(0,codes.length,0);
  while(done<codes.length){
    const batch=codes.slice(done,done+size);
    const {data,error}=await send(batch);
    if(error?.code==='57014'&&batch.length>1){size=Math.max(1,Math.floor(batch.length/2));continue;}
    if(error||!data?.success)throw new Error(`ยืนยันแล้ว ${done}/${codes.length} รหัส · ${error?.message||data?.message||'เพิ่มไม่สำเร็จ'} · ส่งรายการเดิมซ้ำได้ ระบบข้ามรหัสที่มีแล้ว`);
    added+=data.added_count||0;done+=batch.length;progress(done,codes.length,added);
  }
  return added;
}

export async function matchPasscodeBatches(send:(limit:number)=>PromiseLike<Reply>,progress:(matched:number,waiting:number,available:number)=>void){
  let matched=0,size=25;
  // Bound each UI run even if new attendees keep arriving throughout it.
  for(let batch=0;batch<1000;){
    const {data,error}=await send(size);
    if(error?.code==='57014'&&size>1){size=Math.max(1,Math.floor(size/2));continue;}
    if(error||!data)throw new Error(`จับคู่ที่ยืนยันแล้ว ${matched} คน · ${error?.message||'เชื่อมต่อไม่สำเร็จ'} · กดจับคู่ต่อได้`);
    const count=data.matched_count||0,waiting=data.waiting_count||0,available=data.available_count||0;
    matched+=count;batch++;progress(matched,waiting,available);
    if(!count||!waiting||!available)return {matched,waiting,available};
  }
  throw new Error(`จับคู่แล้ว ${matched} คน ถึงขีดจำกัดรอบนี้ กรุณากดจับคู่ต่อ`);
}
