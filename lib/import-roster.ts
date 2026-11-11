type ImportReply = {
  data: {success?:boolean;imported_count?:number;skipped_count?:number;message?:string}|null;
  error: {code?:string;message:string;details?:string;hint?:string}|null;
};

export async function importRosterInBatches<T>(
  students:readonly T[],
  send:(batch:T[])=>PromiseLike<ImportReply>,
  progress:(processed:number,total:number)=>void,
){
  let processed=0;
  let imported=0;
  let skipped=0;
  let batchSize=25;
  progress(0,students.length);
  while(processed<students.length){
    const batch=students.slice(processed,processed+batchSize);
    let reply:ImportReply;
    try{reply=await send(batch);}
    catch(error){
      return {processed,imported,skipped,error:error instanceof Error?error.message:'เชื่อมต่อฐานข้อมูลไม่สำเร็จ'};
    }
    if(reply.error?.code==='57014' && batch.length>1){
      batchSize=Math.max(1,Math.floor(batch.length/2));
      continue;
    }
    if(reply.error || !reply.data?.success){
      const error=reply.error
        ? [reply.error.code,reply.error.message,reply.error.details,reply.error.hint].filter(Boolean).join(' · ')
        : reply.data?.message||'นำเข้ารายชื่อไม่สำเร็จ';
      return {processed,imported,skipped,error};
    }
    imported+=reply.data.imported_count||0;
    skipped+=reply.data.skipped_count||0;
    processed+=batch.length;
    progress(processed,students.length);
  }
  return {processed,imported,skipped,error:undefined};
}
