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
  let retryCount=0;
  progress(0,students.length);
  while(processed<students.length){
    const batch=students.slice(processed,processed+batchSize);
    let reply:ImportReply;
    try{
      reply=await send(batch);
    }catch(error){
      if(retryCount<3){
        retryCount++;
        batchSize=Math.max(5,Math.floor(batchSize/2));
        await new Promise(r=>setTimeout(r,1000));
        continue;
      }
      return {processed,imported,skipped,error:error instanceof Error?error.message:'เชื่อมต่อฐานข้อมูลไม่สำเร็จ'};
    }
    const isTimeout = Boolean(reply.error && (
      reply.error.code==='57014' ||
      reply.error.code==='57P01' ||
      /timeout|canceling statement|500|internal server/i.test(reply.error.message||'')
    ));
    if(isTimeout && batch.length>1){
      batchSize=Math.max(5,Math.floor(batch.length/2));
      await new Promise(r=>setTimeout(r,1000));
      continue;
    }
    if(reply.error || !reply.data?.success){
      if(retryCount<2 && batch.length>5){
        retryCount++;
        batchSize=Math.max(5,Math.floor(batchSize/2));
        await new Promise(r=>setTimeout(r,1000));
        continue;
      }
      const error=reply.error
        ? [reply.error.code,reply.error.message,reply.error.details,reply.error.hint].filter(Boolean).join(' · ')
        : reply.data?.message||'นำเข้ารายชื่อไม่สำเร็จ';
      return {processed,imported,skipped,error};
    }
    retryCount=0;
    imported+=reply.data.imported_count||0;
    skipped+=reply.data.skipped_count||0;
    processed+=batch.length;
    progress(processed,students.length);
    // Brief breather between batches to avoid overloading database CPU with bcrypt
    await new Promise(r=>setTimeout(r,80));
  }
  return {processed,imported,skipped,error:undefined};
}
