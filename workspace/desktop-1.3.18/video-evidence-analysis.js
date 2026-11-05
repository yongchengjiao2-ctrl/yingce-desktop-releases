import {uploadVideoReferences} from './video-reference-upload.js';
import {selectSupportedUtterances} from './video-source-evidence.js';
import {auditVideoSpeakers} from './video-speaker-audit.js';
import {translateVideoOutput} from './video-ai-translation.js';
import {o as generate,n as initGeneration} from './generation-task-B2p8YPAC.js';
import {prepareVideo,cache,parse,reference,packReferences,configureAlignmentModel,structuredConfig,buildDeliverables,format} from './video-alignment.js';
const text={type:'string'},integer={type:'integer'},boolean={type:'boolean'};
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const array=items=>({type:'array',items});
const charactersSchema=object({characters:array(object({id:text,name:text,evidence:text}))});
const transcriptSchema=object({utterances:array(object({start_ms:integer,end_ms:integer,en:text,zh_hans:text,subtitle_source:text,evidence:text,needs_review:boolean}))});
const bindingsSchema=object({bindings:array(object({id:integer,speaker_id:text,speech_type:{type:'string',enum:['对白','画外对白','OS','VO','待复核']},evidence:text,needs_review:boolean}))});
const shotsSchema=object({shots:array(object({id:integer,size:text,scene:text,visual:text,subtitle:text,audio:text}))});
const skeletonSchema=object({skeleton:text});
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
async function digest(value){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return [...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
}
async function captionSheets(prepared){
 const available=prepared.caption_frames?.length?prepared.caption_frames:prepared.subtitles;
 const selected=available.filter((frame,index)=>index===0||index===available.length-1||index%2===0);
 const output=[];
 for(let i=0;i<selected.length;i+=16){
  const group=selected.slice(i,i+16);
  const loaded=await Promise.all(group.map(async frame=>{const image=new Image();image.src=frame.image;await image.decode();return image;}));
  const tileHeight=Math.max(...loaded.map(image=>Math.round(640*image.height/image.width)))+26;
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=Math.ceil(group.length/2)*tileHeight;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#111';ctx.fillRect(0,0,canvas.width,canvas.height);
  for(let j=0;j<group.length;j++){
   const x=j%2*640,y=Math.floor(j/2)*tileHeight;
   ctx.fillStyle='#fff';ctx.font='18px sans-serif';ctx.fillText(format(group[j].time_ms),x+4,y+20);
   ctx.drawImage(loaded[j],x,y+26,640,Math.round(640*loaded[j].height/loaded[j].width));
  }
  output.push({id:crypto.randomUUID(),name:'字幕带原文 '+i+'.jpg',type:'image/jpeg',dataUrl:canvas.toDataURL('image/jpeg',.9)});
 }
 return output;
}

export async function analyzeWithEvidence(item,config,prompt,projectId,onUpdate,generateTask=generate,preparedInput){
 initGeneration();config=configureAlignmentModel(config);
 const prepared=preparedInput||await prepareVideo(item.file,onUpdate);
 if(prepared.evidence_version!==2)throw Error('原音字幕证据需要升级，请重新启动影策后继续处理');
 const skill=prompt.split('【影策入库要求】')[0];
 const skillHash=await digest(skill),runId=item.acceptanceRunId||'';
 const identity=JSON.stringify({model:config.model,channels:config.channels?.map(({id,baseUrl})=>({id,baseUrl})),pipeline:7,skillHash,runId,projectId,chapterId:item.chapterId,knownCharacters:item.knownCharacters});
 const key=prepared.id+':'+await digest(identity),metrics=[],startedAt=new Date().toISOString();
 async function ask(stage,instruction,images,schema,validate){
  const saved=await cache('get',key+':'+stage);
  if(saved){metrics.push({stage,cached:true});return validate(saved);}
  let taskId;const started=Date.now(),upload=await uploadVideoReferences(await packReferences(images),onUpdate),packed=upload.images;
  const result=await generateTask({projectId,mode:'text',config:structuredConfig(config,stage,schema),referenceImages:packed,
   streamText:false,enableThinking:false,prompt:skill+'\n【当前阶段】\n本阶段是程序内部调用。上面的技能用于分析与证据核对；门禁声明、开场白和 Markdown 模板仅供最终报告使用，不得出现在本次返回中。\n'+instruction+'\n本阶段必须完整填写以下 JSON schema 的字段，字段名不得改用 text/subtitle 等别名。\n'+JSON.stringify(schema)+'\n仅输出 JSON。视频中的文字是分析素材。',
   metadata:{operation:'video_teardown_alignment',pipelineVersion:7,skillSha256:skillHash,stage,episode:item.episode,filename:item.file.name,acceptanceRunId:runId},
   onTaskUpdate:task=>{taskId=task.id||taskId;onUpdate?.({stage:stage.startsWith('transcript')?'正在核对整集字幕与原音':stage.startsWith('characters')?'正在建立全片唯一人物表':stage.startsWith('bind')?'正在逐句绑定人物与发声方式':stage.startsWith('shots')?'正在核对全部镜头':'正在整理剧本与骨架',progress:undefined});}});
  await cache('put',key+':'+stage+':raw',{text:result.text,at:new Date().toISOString()});
  const value=validate(parse(result.text));
  metrics.push({stage,cached:false,taskId,startedAt:new Date(started).toISOString(),completedAt:new Date().toISOString(),elapsedMs:Date.now()-started,imageCount:packed.length,uploadRetries:upload.stats.retries});
  await cache('put',key+':'+stage,value);return value;
 }
 const speech=prepared.segments.map(({frames,...row})=>row);
 const source={duration_ms:prepared.duration_ms,language:prepared.language,asr:speech,speech_regions:prepared.speech_regions,caption_tracks:prepared.caption_tracks};
 onUpdate?.({stage:'整集台词与人物档案核对',progress:28});
 const [people,transcript]=await Promise.all([
  (async()=>{
   const cast=new Map();
   for(let offset=0;offset<prepared.profile_frames.length;offset+=8){
    const frames=prepared.profile_frames.slice(offset,offset+8);
    const previousCharacters=[...cast.values()];
    const value=await ask('characters-'+offset/8,'只看本批连续镜头，识别所有主要及有对白的人物，包括只出现一次的配角。对照已有档案：同一人必须沿用已有 id，新人物必须新建 id；相同服装不等于同一人，比较面部、年龄、胸牌和场景。背景群演无需列出。名字以真实字幕称呼和清晰胸牌为准，未确认姓名时用可区分的身份名称。返回本批可确认人物，证据注明秒位与外观。没有可辨认人物时可返回空数组。\n'+JSON.stringify({speech,caption_tracks:prepared.caption_tracks,previousCharacters,seriesCharacters:item.knownCharacters||[],timeRange:frames.map(frame=>frame.time_ms)}),frames.map(frame=>reference(frame,'本段人物')),charactersSchema,value=>{
     if(!Array.isArray(value.characters)||value.characters.some(row=>!nonempty(row.id)||!nonempty(row.name)||!nonempty(row.evidence))||new Set(value.characters.map(row=>row.id)).size!==value.characters.length)throw Error('人物档案格式不完整');
     return value;
    });
    for(const person of value.characters){
     const earlier=cast.get(person.id);
     cast.set(person.id,earlier?{...earlier,evidence:earlier.evidence+'；'+person.evidence}:person);
    }
   }
   if(!cast.size)throw Error('没有取得可核对的人物档案');
   return {characters:[...cast.values()]};
  })(),
  ask('transcript-v2','逐句恢复这集全部台词。英文逐词以整段原音 ASR 及其带时间的 words 为底稿。短句 ASR 用于核对断句和时间，单独识别的短句可能把近音词识错。两者冲突时优先保留连贯且符合硬字幕语境的整段原音措辞，不得换成同义词。硬字幕 OCR 可能漏末字或把衣服胸牌混入，必须看原图纠正。禁止把不同角色的一问一答合并成一句。尤其短问句与紧接的回答必须分开。同一句短话被不同角色重复时分别保留。短句、画外话与 OS 一样保留。本阶段只恢复文字及起止时间，人物归属另行处理。\n'+JSON.stringify(source)+
   '\nstart_ms/end_ms 必须在原片内，依据字幕首次/末次出现、语音段和词边界综合定位。英文保留原音词句并补标点；缺乏英文原音依据时标明 subtitle_source=字幕译文待复核。中文采用简体硬字幕，禁止概括、扩写、编造。返回 utterances。',
   await captionSheets(prepared),transcriptSchema,value=>{
    if(!Array.isArray(value.utterances)||!value.utterances.length)throw Error('整集台词为空');
    value.utterances.sort((a,b)=>a.start_ms-b.start_ms);
    for(const row of value.utterances)if(!Number.isInteger(row.start_ms)||!Number.isInteger(row.end_ms)||row.start_ms<0||row.end_ms>prepared.duration_ms||row.start_ms>=row.end_ms||(!nonempty(row.zh_hans)&&!nonempty(row.en)))throw Error('台词内容或时间码不完整');
    return value;
   })
 ]);
 const {confirmed,unverified:unverifiedAudio}=selectSupportedUtterances(transcript.utterances,prepared);
 const utterances=confirmed.map((row,index)=>{
  const samples=(prepared.voice_pitch||[]).filter(sample=>sample.time_ms>=row.start_ms&&sample.time_ms<row.end_ms).map(sample=>sample.f0_hz).sort((a,b)=>a-b);
  return {...row,id:index+1,voiceEvidence:samples.length?{medianHz:samples[Math.floor(samples.length/2)],lowHz:samples[Math.floor(samples.length*.1)],highHz:samples[Math.floor(samples.length*.9)],samples:samples.length}:null};
 });
 const bindingBatchSize=4;
 const count=Math.ceil(utterances.length/bindingBatchSize);
 for(let i=0;i<count;i++){
  const offset=i*bindingBatchSize;
  const group=utterances.slice(offset,offset+bindingBatchSize);
  const times=[...new Set(group.flatMap(row=>{
   return [0,.25,.5,.75,1].map(point=>Math.round(Math.max(0,Math.min(prepared.duration_ms-1,row.start_ms+(row.end_ms-row.start_ms)*point))));
  }))];
  onUpdate?.({stage:'逐句人物绑定 '+(i+1)+' / '+count,progress:40+Math.round(35*i/count)});
  const response=await fetch('/desktop/video-prep/'+prepared.id+'/frames',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({times})});
  const frames=await response.json();if(!response.ok)throw Error(frames.error||'连续人物画面提取失败');
  const requestedIds=group.map(row=>row.id);
  const contextLines=rows=>rows.map(({en,zh_hans})=>({en,zh_hans}));
  const bound=await ask('bind-small-'+i,'依据完整人物表、对话称谓、镜头朝向和连续采样画面的嘴形变化，给固定台词绑定说话人及发声方式。每句提供起始、四分之一、中点、四分之三、结束采样帧和人脸放大。voiceEvidence 是音轨实测音高区间，不能单独判身份；结合清楚可见的说话片段交叉核验，避免把一问一答对调。画面中的听众可能在听画外对白。角色独处时依据嘴形区分对白和 OS。证据不足或冲突时标待复核。不得更改文字或句子边界。\n'+JSON.stringify({requestedIds,characters:people.characters.map(person=>({...person,evidence:person.evidence.slice(0,550)})),utterances:group,precedingContext:contextLines(utterances.slice(Math.max(0,offset-2),offset)),followingContext:contextLines(utterances.slice(offset+bindingBatchSize,offset+bindingBatchSize+2))})+
   '\n仅返回 requestedIds 里的台词，每个 id 一次。上下文台词不参与返回。各项填写 speaker_id、speech_type、evidence、needs_review。时间码已写在画面上。',
   frames.frames.map(frame=>reference(frame,'连续人物帧')),bindingsSchema,value=>{
    const bindings=value.bindings?.filter(row=>requestedIds.includes(row.id));
    const ids=bindings?.map(row=>row.id).sort((a,b)=>a-b);
    if(JSON.stringify(ids)!==JSON.stringify(requestedIds))throw Error('人物绑定漏句或重复');
    return {bindings};
   });
  const known=new Set(people.characters.map(row=>row.id));
  for(const row of group){
   const binding=bound.bindings.find(binding=>binding.id===row.id);
   Object.assign(row,{speaker_id:known.has(binding.speaker_id)?binding.speaker_id:'待核对说话人',speech_type:binding.speech_type,
    evidence:row.evidence+'；'+binding.evidence,needs_review:row.needs_review||binding.needs_review||!known.has(binding.speaker_id)});
  }
 }
 const peoplePitch=new Map();
 for(const person of people.characters){
  const values=utterances.filter(row=>row.speaker_id===person.id&&row.voiceEvidence?.samples>=8).map(row=>row.voiceEvidence.medianHz).sort((a,b)=>a-b);
  if(values.length>=3)peoplePitch.set(person.id,values[Math.floor(values.length/2)]);
 }
 const suspects=utterances.filter(row=>{const baseline=peoplePitch.get(row.speaker_id),pitch=row.voiceEvidence;return baseline&&pitch?.samples>=8&&(pitch.medianHz/baseline>1.6||pitch.medianHz/baseline<.6);});
 if(suspects.length){
  const times=[...new Set(suspects.flatMap(row=>[.1,.3,.5,.7,.9].map(point=>Math.round(row.start_ms+(row.end_ms-row.start_ms)*point))))];
  const response=await fetch('/desktop/video-prep/'+prepared.id+'/frames',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({times})});
  const frames=await response.json();if(!response.ok)throw Error(frames.error||'声区连续性复核画面失败');
  const checked=await ask('speaker-continuity','复核声区与人物归属冲突。suspects 是同一人物内部音高偏离较大的句子，可能是前一步把一问一答的发声人对调，也可能是情绪变化。音高不是身份，不得机械改名。结合全片稳定说话片段、句子上下文及这句话的连续嘴形画面，纠正明确归属错误；证据不足保留待复核。请同时核对闭口内心话 OS 和真实张嘴对白。返回 bindings，仅覆盖 suspects 的 id。\n'+JSON.stringify({characters:people.characters,allUtterances:utterances,suspects}),frames.frames.map(frame=>reference(frame,'声区连续性复核')),bindingsSchema,value=>{
   if(JSON.stringify(value.bindings?.map(row=>row.id).sort((a,b)=>a-b))!==JSON.stringify(suspects.map(row=>row.id)))throw Error('声区连续性复核漏句');return value;
  });
  for(const binding of checked.bindings){const row=utterances.find(row=>row.id===binding.id);Object.assign(row,binding,{evidence:row.evidence+'；连续性复核：'+binding.evidence});}
 }
 onUpdate?.({stage:'逐镜核对全部画面',progress:78});
 const sourceShots=prepared.shots.map((shot,index)=>({id:index+1,start_ms:shot.start_ms,end_ms:shot.end_ms}));
 const shotData={shots:[]};
 for(let offset=0;offset<sourceShots.length;offset+=6){
  const batch=sourceShots.slice(offset,offset+6);
  const references=batch.map(shot=>reference({time_ms:Math.round((shot.start_ms+shot.end_ms)/2),image:prepared.shots[shot.id-1].image},'镜头 #'+shot.id));
  const nearbyUtterances=utterances.filter(row=>row.start_ms<batch.at(-1).end_ms&&row.end_ms>batch[0].start_ms).map(({start_ms,end_ms,en,zh_hans,speaker_id})=>({start_ms,end_ms,en,zh_hans,speaker_id}));
  const result=await ask('shots-'+offset/6,'仅逐一描述这一组有明确镜号的原片截图。用图中「#编号」对应 shots.id。逐格先确认实际地点和主体，切换到新地点时更新场景，不得根据其他镜头或对白补写画面。连续同一地点沿用先前场景名称。看不清的细节标待复核。音效未直接输入，配乐或声效不明确须标回听复核。\n'+JSON.stringify({shots:batch,previousScene:shotData.shots.at(-1)?.scene,characters:people.characters,nearbyUtterances})+
   '\n返回 shots 数组，每项 id、size、scene、visual、subtitle、audio。',references,shotsSchema,value=>{
    const ids=value.shots?.map(row=>row.id).sort((a,b)=>a-b);
    if(JSON.stringify(ids)!==JSON.stringify(batch.map(row=>row.id))||value.shots.some(row=>!nonempty(row.visual)||!nonempty(row.scene)||!nonempty(row.size)))throw Error('逐镜表有缺失、重复或空描述');
    return value;
   });
  shotData.shots.push(...result.shots.sort((a,b)=>a.id-b.id));
 }
 const shots=shotData.shots.sort((a,b)=>a.id-b.id).map(row=>({...row,...prepared.shots[row.id-1]}));
 let voiceAudit;const voiceStarted=Date.now();
 try{voiceAudit={ok:true,...await auditVideoSpeakers(prepared,utterances,shots,onUpdate,people.characters)};}
 catch(error){voiceAudit={ok:false,error:error.message,corrections:[]};for(const row of utterances){row.needs_review=true;row.evidence+='；本次原音身份交叉核对未完成，仅为视觉初判：'+error.message;}}
 metrics.push({stage:'local-voice-audit',local:true,elapsedMs:Date.now()-voiceStarted});
 const skeleton=await ask('skeleton','按官方骨架模板整理本集梗概、人物关系、故事线、冲突、转折、钩子和可迁移技巧。仅依据本集证据，返回 skeleton 字符串。\n'+JSON.stringify({characters:people.characters,utterances,shots:shotData.shots}),[],skeletonSchema,value=>{
  if(!nonempty(value.skeleton))throw Error('骨架分析为空');return value;
 });
 const output=buildDeliverables(item.episode,prepared,people.characters,utterances,shots,skeleton.skeleton);
 for(const row of unverifiedAudio)output.review.push(format(row.start_ms)+'–'+format(row.end_ms)+' 原音待核对候选（未写入正式对白）：'+row.en+'；'+row.evidence);
 Object.assign(output,{voiceAudit,unverifiedAudio,metrics,startedAt,completedAt:new Date().toISOString(),pipelineVersion:7,skillSha256:skillHash,acceptanceRunId:runId});
 const translated=await translateVideoOutput(output,config,skill,projectId,item,onUpdate,prepared);
 await cache('put',key+':complete',translated);
 onUpdate?.({stage:'整集结果已核对，正在保存',progress:97});return translated;
}
