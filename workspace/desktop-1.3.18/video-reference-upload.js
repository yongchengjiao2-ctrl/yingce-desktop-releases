import {S as uploadResource,_ as resourceKey,l as initResources} from './resources-BQRUQGh-.js';
let pending=Promise.resolve(),lastUpload=0;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function uploadVideoReferences(references,onUpdate,options={}){
 if(!options.upload)initResources();
 const upload=options.upload||uploadResource,sleep=options.pause||pause,output=[],stats={retries:0,count:references.length};
 for(const reference of references){
  if(reference.storageKey){output.push(reference);continue;}
  const job=pending.catch(()=>{}).then(async()=>{
   await sleep(Math.max(0,400-(Date.now()-lastUpload)));
   const blob=await (await fetch(reference.dataUrl)).blob(),idempotencyKey='video-reference-'+crypto.randomUUID();
   for(let attempt=0;attempt<5;attempt++){
    try{
     onUpdate?.({stage:'正在准备核对画面 '+(output.length+1)+' / '+references.length});
     const resource=await upload(blob,'image',{fileName:reference.name,idempotencyKey});
     lastUpload=Date.now();
     return {...reference,dataUrl:'',storageKey:resourceKey(resource.id),type:resource.mimeType||reference.type};
    }catch(error){
     const retryable=error?.status===429||error?.status>=500||/请求次数已达上限|限流|too many requests|rate limit/i.test(error?.message||'');
     if(error?.name==='AbortError'||!retryable||attempt===4)throw error;
     stats.retries++;
     const specified=/([0-9]+)\s*秒/.exec(error.message||'');
     onUpdate?.({stage:'素材上传繁忙，正在等待重试'});
     await sleep(Math.max(specified?Number(specified[1])*1000:0,2000*(attempt+1)));
    }
   }
  });
  pending=job.catch(()=>{});
  output.push(await job);
 }
 return {images:output,stats};
}
