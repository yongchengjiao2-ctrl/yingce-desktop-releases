import {o as generate,n as initGeneration} from './generation-task-B2p8YPAC.js';
import {cache,parse,configureAlignmentModel,structuredConfig,buildDeliverables,format} from './video-alignment.js';
const schema={type:'object',properties:{translations:{type:'array',items:{type:'object',properties:{id:{type:'integer'},sentences:{type:'array',items:{type:'object',properties:{sentence_id:{type:'integer'},zh_hans:{type:'string'}},required:['sentence_id','zh_hans'],additionalProperties:false}},evidence:{type:'string'}},required:['id','sentences','evidence'],additionalProperties:false}}},required:['translations'],additionalProperties:false};
const nonempty=value=>typeof value==='string'&&value.trim().length>0;

export async function translateVideoOutput(output,config,skill,projectId,item,onUpdate,preparedInput){
 initGeneration();config=configureAlignmentModel(config);
 const segmenter=new Intl.Segmenter('en',{granularity:'sentence'});
 const source=output.utterances.map(row=>({id:row.id,start_ms:row.start_ms,end_ms:row.end_ms,en:row.en,sentences:[...segmenter.segment(row.en)].map((part,index)=>({sentence_id:index+1,en:part.segment.trim()})),speaker_id:row.speaker_id,previous_zh_hans:row.source_zh_hans??row.zh_hans,source_evidence:row.evidence.split('；整集AI翻译：')[0],needs_review:row.needs_review}));
 const signature=JSON.stringify({version:2,projectId,chapterId:item.chapterId,verificationRunId:item.acceptanceRunId||'',model:config.model,source,characters:output.characters});
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature)))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const key='ai-episode-translation:'+hash;
 const saved=await cache('get',key);let value=saved?.data||saved,metric;
 const validate=data=>{
  const ids=data.translations?.map(row=>row.id).sort((a,b)=>a-b);
  if(JSON.stringify(ids)!==JSON.stringify(source.map(row=>row.id).sort((a,b)=>a-b))||data.translations.some(row=>!nonempty(row.evidence)))throw Error('整集 AI 翻译缺句、重复或内容为空；原识别结果已保留');
  for(const row of data.translations){const expected=source.find(item=>item.id===row.id).sentences.map(item=>item.sentence_id);if(JSON.stringify(row.sentences?.map(item=>item.sentence_id).sort((a,b)=>a-b))!==JSON.stringify(expected)||row.sentences.some(item=>!nonempty(item.zh_hans)))throw Error('AI 翻译未逐句完整对应');}
  return data;
 };
 onUpdate?.({stage:'整集 AI 翻译与中英逐句核对',progress:94});
 if(value){value=validate(value);metric={...(saved?.metric||{}),stage:'ai-translation',cached:true};}
 else{
  let taskId;const started=Date.now();
  const result=await generate({projectId,mode:'text',config:structuredConfig(config,'ai-translation',schema),streamText:false,enableThinking:false,
   prompt:'【视频拆解 · 整集 AI 翻译】\n'+skill+'\n【本阶段：整集翻译】\n'+
    '你负责整集简体中文翻译。逐条阅读全部英文原音转写，以英文原音为底稿，结合人物表、已有中文初稿与硬字幕核对证据统一语气、称谓、指代和上下文。中文初稿和OCR可能有错，只作为校对参考，不得只复制而不核对英文。字幕缺失时由你依据英文翻译，不得把繁简转换当作翻译。已有字幕准确时可沿用准确译文。\n'+
    '完整覆盖每个输入id及其全部sentences，按sentence_id逐句翻译，严格一对一，不合并、遗漏、重复、补造台词。返回id、sentences（其中每项sentence_id、zh_hans）、evidence。不得返回或改变英文原文、时间码、说话人。中文全部简体；原音含糊或上下文有歧义时在evidence说明，不自行新增角色或情节。保留金额、否定、称谓、问答和情绪。\n'+
    JSON.stringify({characters:output.characters,utterances:source})+'\n严格使用以下JSON字段：'+JSON.stringify(schema),
   metadata:{operation:'video_teardown_alignment',pipelineVersion:7,stage:'ai-translation',acceptanceRunId:item.acceptanceRunId||'',skillSha256:output.skillSha256,episode:item.episode,filename:item.file?.name||item.filename},
   onTaskUpdate:task=>{taskId=task.id||taskId;onUpdate?.({stage:'整集 AI 翻译与中英逐句核对',progress:94});}});
  await cache('put',key+':raw',{text:result.text,taskId});
  value=validate(parse(result.text));
  metric={stage:'ai-translation',cached:false,taskId,startedAt:new Date(started).toISOString(),completedAt:new Date().toISOString(),elapsedMs:Date.now()-started,imageCount:0};
  await cache('put',key,{data:value,metric});
 }
 const rows=output.utterances.map(row=>{
  const translation=value.translations.find(translation=>translation.id===row.id);
  const pairs=source.find(item=>item.id===row.id).sentences.map(sentence=>({en:sentence.en,zh_hans:translation.sentences.find(item=>item.sentence_id===sentence.sentence_id).zh_hans}));
  return {...row,source_zh_hans:row.source_zh_hans??row.zh_hans,zh_hans:pairs.map(pair=>pair.zh_hans).join(''),bilingual_sentences:pairs,translation_evidence:translation.evidence,
   evidence:row.evidence.split('；整集AI翻译：')[0]+'；整集AI翻译：'+translation.evidence};
 });
 let prepared=preparedInput;
 if(!prepared){const response=await fetch('/desktop/video-prep/'+output.prepId);if(!response.ok)throw Error('无法回读原片时间轴，原分析结果已保留');prepared={...await response.json(),id:output.prepId};}
 const rendered=buildDeliverables(item.episode,prepared,output.characters,rows,structuredClone(output.shots),output.skeleton);
 for(const row of output.unverifiedAudio||[])rendered.review.push(format(row.start_ms)+'–'+format(row.end_ms)+' 原音待核对候选（未写入正式对白）：'+row.en+'；'+row.evidence);
 return {...output,...rendered,metrics:[...(output.metrics||[]).filter(row=>row.stage!=='ai-translation'),metric],
  translation:{model:config.model,version:2,...metric},pipelineVersion:7,completedAt:new Date().toISOString()};
}
