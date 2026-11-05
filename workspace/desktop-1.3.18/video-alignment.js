import {_ as modelStore,h as resolveModel} from './use-config-store-BNvhZKBV.js';
import {o as generate,n as initGeneration} from './generation-task-B2p8YPAC.js';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const format=ms=>{
 const seconds=Math.floor(ms/1000),hundredths=Math.floor(ms%1000/10);
 return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')+'.'+String(hundredths).padStart(2,'0');
};
const clean=value=>String(value??'').trim();
export function parse(text){
 const raw=clean(text),match=/^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw);
 const value=match?.[1]??raw;
 try{return JSON.parse(value);}catch(error){
  // Some channels prepend a skill acknowledgement before a complete object.
  // Parse the complete object as-is; stage validators still check its contents.
  const start=value.indexOf('{'),end=value.lastIndexOf('}');
  if(start<0||end<=start)throw error;
  return JSON.parse(value.slice(start,end+1));
 }
}
export async function cache(method,key,value){
 const db=await new Promise((resolve,reject)=>{
  const req=indexedDB.open('yingce-video-alignment',1);
  req.onupgradeneeded=()=>req.result.createObjectStore('stages');
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 });
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction('stages',method==='put'?'readwrite':'readonly');
  const request=method==='put'?tx.objectStore('stages').put(value,key):tx.objectStore('stages').get(key);
  tx.oncomplete=()=>resolve(request.result);tx.onerror=tx.onabort=()=>reject(tx.error);
 });}finally{db.close();}
}
export async function prepareVideo(file,onUpdate){
 const upload=await fetch('/desktop/video-prep',{method:'POST',body:file});
 const job=await upload.json();
 if(!upload.ok)throw Error(job.error||'无法准备原片，请重新启动影策');
 for(;;){
  const response=await fetch('/desktop/video-prep/'+job.id);
  const value=await response.json();
  if(!response.ok)throw Error(value.error||'原音处理失败');
  if(response.status===200)return {...value,id:job.id};
  onUpdate?.({stage:value.stage,progress:Math.round((value.progress||0)*0.25)});
  await pause(1500);
 }
}
export function reference(frame,label){
 return {id:crypto.randomUUID(),name:label+' '+format(frame.time_ms)+'.jpg',type:'image/jpeg',dataUrl:frame.image};
}
export async function packReferences(images){
 const packed=[];
 const frames=images.filter(image=>!image.name.startsWith('字幕带'));
 for(let i=0;i<frames.length;i+=4){
  const group=frames.slice(i,i+4),sample=new Image();sample.src=group[0].dataUrl;await sample.decode();
  const height=Math.round(720*sample.height/sample.width)+28;
  const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=Math.ceil(group.length/2)*height;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#111';ctx.fillRect(0,0,canvas.width,canvas.height);
  for(let j=0;j<group.length;j++){
   const image=new Image();image.src=group[j].dataUrl;await image.decode();
   const x=j%2*720,y=Math.floor(j/2)*height;
   ctx.fillStyle='#fff';ctx.font='17px sans-serif';ctx.fillText(group[j].name.replace('.jpg',''),x+4,y+20);
   ctx.drawImage(image,x,y+28,720,height-28);
  }
  packed.push({id:crypto.randomUUID(),name:'带时间码画面总览 '+i+'.jpg',type:'image/jpeg',dataUrl:canvas.toDataURL('image/jpeg',0.85)});
 }
 return [...packed,...images.filter(image=>image.name.startsWith('字幕带'))];
}
function languageField(utterance){
 const zh=clean(utterance.zh_hans),en=clean(utterance.en);
 return en+(zh?'（'+zh+'）':'');
}
export function validateAligned(data,start,end,duration){
 if(!Array.isArray(data.utterances)||!Array.isArray(data.shots))throw Error('核对结果缺少逐句或逐镜数组');
 for(const row of data.utterances){
  if(!Number.isInteger(row.start_ms)||!Number.isInteger(row.end_ms)||row.start_ms<0||row.end_ms>duration||
   row.start_ms>=row.end_ms)
   throw Error('逐句时间码越界，请核对本段');
  if(!clean(row.en)&&!clean(row.zh_hans))throw Error('返回了空台词');
  if(!['对白','画外对白','OS','VO','待复核'].includes(row.speech_type)){
   row.speech_type='待复核';row.needs_review=true;
  }
  if(!clean(row.speaker_id)){row.speaker_id='待核对说话人';row.needs_review=true;}
  if(!clean(row.evidence)){row.evidence='模型未提供完整归属依据，请回听原片。';row.needs_review=true;}
  if(typeof row.needs_review!=='boolean')row.needs_review=true;
 }
 data.utterances=data.utterances.filter(row=>(row.start_ms+row.end_ms)/2>=start&&(row.start_ms+row.end_ms)/2<end);
 return data;
}
export function buildDeliverables(episode,prepared,characters,utterances,shots,skeleton){
 const names=new Map(characters.map(person=>[person.id,person.name]));
 const utteranceText=row=>{const label=(names.get(row.speaker_id)||row.speaker_id)+'【'+row.speech_type+'】：';return (row.bilingual_sentences?.length?row.bilingual_sentences:[row]).map(sentence=>label+languageField(sentence)).join('\n');};
 const rows=utterances.slice().sort((a,b)=>a.start_ms-b.start_ms);
 const warnings=rows.filter(row=>row.needs_review).map(row=>format(row.start_ms)+'–'+format(row.end_ms)+' '+utteranceText(row)+'\n依据 '+row.evidence);
 for(let i=1;i<rows.length;i++)if(rows[i].start_ms<rows[i-1].end_ms)
  warnings.push(format(rows[i].start_ms)+' 台词时间重叠，需回听确认是否同时发声。');
 const tokenize=text=>clean(text).toLowerCase().match(/[a-z]+(?:'[a-z]+)?|[\u4e00-\u9fff]/g)||[];
 for(const segment of prepared.segments||[]){
  const expected=tokenize(segment.text);
  const nearby=rows.filter(row=>row.end_ms>segment.start_ms-500&&row.start_ms<segment.end_ms+500);
  const covered=new Set(tokenize(nearby.map(row=>prepared.language==='en'?row.en:row.zh_hans).join(' ')));
  const missing=expected.filter(token=>!covered.has(token));
  if(expected.length&&missing.length/expected.length>0.2)
   warnings.push(format(segment.start_ms)+'–'+format(segment.end_ms)+' 原音转写中有尚未对齐的文字「'+missing.join(' ')+'」。请回听确认是否漏句或 ASR 误识。');
 }
 const screenplay=[],transcript=['人物档案',...characters.map(person=>person.id+' '+person.name+' '+person.evidence),'逐字稿'];
 for(const row of rows)transcript.push(format(row.start_ms)+'–'+format(row.end_ms)+' '+utteranceText(row)+'\n'+row.evidence+(row.needs_review?'〔待复核〕':''));
 let scene='',sceneNumber=0;
 for(const [index,shot] of shots.entries()){
  if(shot.scene!==scene){
   scene=shot.scene;sceneNumber++;
   const nextScene=shots.slice(index+1).find(candidate=>candidate.scene!==scene);
   const sceneEnd=nextScene?.start_ms??prepared.duration_ms;
   const scenePeople=[...new Set(rows.filter(row=>row.end_ms>shot.start_ms&&row.start_ms<sceneEnd)
    .map(row=>names.get(row.speaker_id)||row.speaker_id))];
   screenplay.push(episode+'-'+sceneNumber+' '+(scene||'场景待复核'),'人物 '+(scenePeople.join('、')||'无可确认对白人物'));
  }
  screenplay.push('▲ '+shot.visual);
  for(const row of rows.filter(row=>row.start_ms>=shot.start_ms&&row.start_ms<shot.end_ms))
   screenplay.push(utteranceText(row)+(row.needs_review?'〔待复核〕':''));
  shot.audio='人声依据原音转写对齐。配乐、环境音、音色与混响需回听复核。';
  shot.time=format(shot.start_ms)+'–'+format(shot.end_ms);
  shot.duration=((shot.end_ms-shot.start_ms)/1000).toFixed(2);
  shot.dialogue=rows.filter(row=>Math.max(row.start_ms,shot.start_ms)<Math.min(row.end_ms,shot.end_ms)).map(utteranceText).join('\n');
 }
 return {transcript:transcript.join('\n\n'),screenplay:screenplay.join('\n'),
  skeleton,characters,utterances:rows,shots,review:warnings,method:prepared.method,
  duration_ms:prepared.duration_ms,prepId:prepared.id};
}

export function configureAlignmentModel(config){
 const selected=config.model.split('::'),model=selected.at(-1);
 const match=config.channels.find(channel=>selected.length>1?channel.id===selected[0]:channel.models.includes(model));
 if(!match)throw Error('找不到所选模型的渠道');
 const configured=match.modelCosts?.find(row=>row.model===model)?.protocol||match.interfaceType;
 if(!configured&&match.apiFormat==='claude')throw Error('请先为此渠道选择可用的文本与视觉请求协议');
 const protocol=configured||'a6api-chat';
 const updated={...match,modelCosts:[...(match.modelCosts||[]).filter(row=>row.model!==model),{
  ...(match.modelCosts?.find(row=>row.model===model)||{}),model,capability:'text',protocol
 }]};
 if(!configured)modelStore.getState().updateConfig('channels',config.channels.map(channel=>channel.id===match.id?updated:channel));
 return {...config,channels:config.channels.map(channel=>channel.id!==match.id?channel:{
  ...updated,modelCosts:updated.modelCosts.map(cost=>cost.model!==model?cost:{
   ...cost,defaultOptions:{...cost.defaultOptions,response_format:{type:'json_object'},stream:false}
  })
 })};
}

const stringSchema={type:'string'};
const objectSchema=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const alignmentSchema=objectSchema({
 utterances:{type:'array',items:objectSchema({
  start_ms:{type:'integer'},end_ms:{type:'integer'},speaker_id:stringSchema,
  speech_type:{type:'string',enum:['对白','画外对白','OS','VO','待复核']},
  en:stringSchema,zh_hans:stringSchema,subtitle_source:stringSchema,evidence:stringSchema,needs_review:{type:'boolean'}
 })},
 shots:{type:'array',items:objectSchema({
  id:{type:'integer'},size:stringSchema,scene:stringSchema,visual:stringSchema,subtitle:stringSchema,audio:stringSchema
 })}
});
const charactersSchema=objectSchema({characters:{type:'array',items:objectSchema({id:stringSchema,name:stringSchema,evidence:stringSchema})}});
const skeletonSchema=objectSchema({skeleton:stringSchema});
export function structuredConfig(config,stage,specifiedSchema){
 const schema=specifiedSchema||(stage==='characters'?charactersSchema:stage==='skeleton'?skeletonSchema:alignmentSchema);
 return {...config,channels:config.channels.map(channel=>({
  ...channel,modelCosts:channel.modelCosts?.map(cost=>({
   ...cost,defaultOptions:{...cost.defaultOptions,response_format:{
    type:'json_schema',json_schema:{name:stage.replace(/-/g,'_'),strict:true,schema}
   }}
  }))
 }))};
}

export async function analyzeAligned(...args){
 const {analyzeWithEvidence}=await import('./video-evidence-analysis.js');
 return analyzeWithEvidence(...args);
}
export function subtitleFile(utterances,mode){
 const clock=ms=>{
  const total=Math.max(0,Math.round(ms)),sec=Math.floor(total/1000);
  return [Math.floor(sec/3600),Math.floor(sec/60)%60,sec%60].map(n=>String(n).padStart(2,'0')).join(':')+','+String(total%1000).padStart(3,'0');
 };
 return utterances.map((row,index)=>(index+1)+'\n'+clock(row.start_ms)+' --> '+clock(row.end_ms)+'\n'+
  (mode==='en'?row.en:mode==='zh'?row.zh_hans:row.en+'\n'+row.zh_hans)).join('\n\n')+'\n';
}
