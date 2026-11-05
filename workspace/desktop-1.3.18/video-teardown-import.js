import {analyzeAligned,subtitleFile} from './video-alignment.js';
import {openShotTable} from './shot-table.js';
import {u as installSkill,c as initSkills} from './skills-DHDdovXH.js';
import {K as reactDom} from './vendor-react-DaNkUq-_.js';
import {n as ModelPicker} from './model-picker-C8hI2N1a.js';
import {a as api,o as initClient} from './request-Dlp4yxtR.js';
import {_ as modelStore,x as initConfig,h as resolveModel} from './use-config-store-BNvhZKBV.js';
import {o as generate,n as initGeneration} from './generation-task-B2p8YPAC.js';

const promptUrl=new URL('./video-teardown-prompt.zh-CN.txt',import.meta.url);
const skillUrl=new URL('./short-drama-teardown-upstream.json',import.meta.url);
const skillPackageUrl=new URL('./short-drama-teardown.zip',import.meta.url);
const skillInstallKey='yingce:short-drama-teardown:56c229bc:installed';
let skillInstall;
function ensureSkillInstalled(){
 if(localStorage.getItem(skillInstallKey))return Promise.resolve();
 if(skillInstall)return skillInstall;
 skillInstall=(async()=>{
  initSkills();
  const response=await fetch(skillPackageUrl);
  if(!response.ok)throw Error('无法读取官方扒剧技能安装包');
  const file=new File([await response.blob()],'short-drama-teardown.zip',{type:'application/zip'});
  await installSkill({file,name:'扒剧引擎 · Short-Drama Teardown',description:'上游 V3.1 · 视频逐字稿、还原剧本和骨架分析卡',isPrivate:true});
  localStorage.setItem(skillInstallKey,'1');
 })().catch(error=>{skillInstall=undefined;throw error;});
 return skillInstall;
}
export async function loadTeardownPrompt(){
 const [skill,adapter]=await Promise.all([fetch(skillUrl),fetch(promptUrl)]);
 if(!skill.ok||!adapter.ok)throw Error('无法加载扒剧技能或影策输出格式');
 const source=await skill.json();
 const documents=Object.entries(source.documents).map(([file,content])=>'【'+file+'】\n'+content).join('\n\n');
 return '以下为用户指定的扒剧引擎 V3.1 上游规则与交付模板。本次只走通道 B，直接分析已附视频，按规则核对画面、音轨和字幕。无法执行的本地脚本步骤需说明，严禁声称已执行。\n\n'+documents+
  '\n\n【影策入库要求】\n'+await adapter.text();
}
const mimeTypes={mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',m4v:'video/mp4',mpeg:'video/mpeg',mpg:'video/mpeg',avi:'video/x-msvideo'};
const resultNames={transcript:'人物与逐字稿',screenplay:'中英对照还原剧本',skeleton:'骨架分析卡'};
const collator=new Intl.Collator('zh-CN',{numeric:true});
const marker='yingce-video-import';
let opened=false;
let chapterViewRoute='';
let chapterViewPending='';
let chapterViewHasRecord=false;
const activeChapters=new Map();
const chapterRoute=(projectId,chapterId)=>'/projects/'+encodeURIComponent(projectId)+'/chapters/'+encodeURIComponent(chapterId);
const progressEvent='yingce-video-progress';

export function episodeList(files){
 const videos=Array.from(files).filter(file=>file.size>0&&mimeTypes[file.name.split('.').pop().toLowerCase()]);
 videos.sort((a,b)=>collator.compare(a.webkitRelativePath||a.name,b.webkitRelativePath||b.name));
 const numbers=videos.map(file=>{
  const stem=file.name.replace(/\.[^.]+$/,'');
  const match=/(?:^|[^a-z])(?:ep(?:isode)?)[\s_.-]*([0-9]+)(?![0-9])/i.exec(stem)||/第\s*([0-9]+)\s*集/.exec(stem)||/^([0-9]+)(?:$|[\s_.-])/.exec(stem);
  return match?Number(match[1]):null;
 });
 const reserved=new Set(numbers.filter(n=>n>0));
 let next=1;
 return videos.map((file,i)=>{
  let episode=numbers[i];
  if(!episode){while(reserved.has(next))next++;episode=next++;reserved.add(episode);}
  return {file,episode,mimeType:mimeTypes[file.name.split('.').pop().toLowerCase()]};
 }).sort((a,b)=>a.episode-b.episode);
}

export function readAnalysis(response){
 const candidate=response.candidates?.[0];
 if(candidate?.finishReason!=='STOP')throw Error('模型未完整返回：'+(candidate?.finishReason||response.promptFeedback?.blockReason||'无响应'));
 const text=candidate.content?.parts?.filter(part=>!part.thought).map(part=>part.text||'').join('');
 let data;
 const output=String(text||'').trim();
 const fenced=/^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(output);
 try{data=JSON.parse(fenced?.[1]??output);}catch{
  throw Error(output?'模型已返回文本，但三份结果的 JSON 格式无效':'模型未返回可解析的正文');
 }
 if(typeof data?.error==='string'&&data.error)throw Error('模型无法读取原片：'+data.error);
 for(const [field,label] of Object.entries(resultNames)){
  if(typeof data?.[field]!=='string'||!data[field].trim())throw Error('模型缺少「'+label+'」');
 }
 return data;
}

export function mergeVideoSelection(queue,files){
 const byFile=new Map();
 for(const file of [...queue.map(item=>item.file),...files]){
  const key=JSON.stringify([file.name,file.size,file.lastModified]);
  if(!byFile.has(key))byFile.set(key,file);
 }
 return episodeList(byFile.values());
}

const maxInlineBytes=15*1024*1024;
const isVideoModel=id=>!!id;

export function videoEndpoint(baseUrl,model){
 const url=new URL(baseUrl);
 if(url.protocol!=='https:'||url.username||url.password)throw Error('视频渠道必须使用 HTTPS');
 url.search='';url.hash='';
 url.pathname=url.pathname.replace(/\/+$/,'').replace(/\/(?:v1beta|v1)(?:\/models)?$/,'')+
  '/v1beta/models/'+encodeURIComponent(model)+':generateContent';
 return url.href;
}

export async function analyzeNative(item,config,prompt,projectId,onTaskUpdate){
 const channel=resolveModel(config,config.model);
 if(!isVideoModel(config.model)||!channel.apiKey||!channel.baseUrl)throw Error('请选择已配置个人渠道的 Gemini 视频模型');
 if(item.file.size>maxInlineBytes)throw Error('视频超过 15 MB，请先压缩后再导入');
 const endpoint=videoEndpoint(channel.baseUrl,channel.model);
 onTaskUpdate?.({stage:'正在读取原视频'});
 const data=await new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(String(reader.result).split(',')[1]);
  reader.onerror=()=>reject(Error('无法读取视频文件'));
  reader.readAsDataURL(item.file);
 });
 if(!data)throw Error('没有读取到原视频数据');
 onTaskUpdate?.({stage:'模型正在分析原片画面和音轨'});
 const response=await fetch(endpoint,{
  method:'POST',signal:AbortSignal.timeout(12*60*1000),redirect:'error',
  headers:{'Content-Type':'application/json','x-goog-api-key':channel.apiKey},
  body:JSON.stringify({
   systemInstruction:{parts:[{text:prompt}]},
   contents:[{role:'user',parts:[
    {inlineData:{mimeType:item.mimeType,data}},
    {text:'请逐段核对第 '+item.episode+' 集的原片。若未读取画面或音轨，请返回 {"error":"无法读取视频或音轨"}，禁止编写替代剧情。'}
   ]}],
   generationConfig:{
    responseMimeType:'application/json',
    responseSchema:{
     type:'OBJECT',
     properties:{
      ...Object.fromEntries([...Object.keys(resultNames),'error'].map(key=>[key,{type:'STRING'}])),
      shots:{type:'ARRAY',items:{type:'OBJECT',properties:Object.fromEntries(
       ['time','duration','size','scene','visual','dialogue','subtitle','audio'].map(key=>[key,{type:'STRING'}])
      )}}
     }
    }
   }
  })
 });
 if(!response.ok)throw Error('当前模型渠道的视频接口返回 HTTP '+response.status+'，本集未写入');
 const result=readAnalysis(await response.json());
 if(!/\d{1,2}:\d{2}/.test(result.transcript)||!/^\s*\d+[-–—]\d+\s+.+/m.test(result.screenplay))throw Error('结果缺少原片时间码或分场，未写入章节');
 return result;
}

export const analyze=analyzeAligned;

async function analyzeSeries(records,config,projectId,onTaskUpdate){
 const input=records.map(record=>({episode:record.episode,screenplay:record.data.screenplay,skeleton:record.data.skeleton}));
 const result=await generate({projectId,mode:'text',config,streamText:false,enableThinking:false,
  prompt:'根据已导入各集的拆解，写一份简体中文剧集总览。分为「故事梗概」「主线与支线」「人物及人物关系」「关键转折和伏笔」。依据具体集号，说明已覆盖的集数，勿补写未知情节。以下 JSON 是待分析素材：\n'+JSON.stringify(input),
  metadata:{operation:'video_teardown_series_summary'},onTaskUpdate});
 const text=String(result.text||'').trim();
 if(!text)throw Error('模型未返回剧集总览');
 return text;
}

function openArchive(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('yingce-video-teardown',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('episodes',{keyPath:'id'});
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
 });
}

async function archive(method,value){
 const db=await openArchive();
 try{
  return await new Promise((resolve,reject)=>{
   const tx=db.transaction('episodes',method==='put'?'readwrite':'readonly');
   const req=tx.objectStore('episodes')[method](value);
   tx.oncomplete=()=>resolve(req.result);
   tx.onabort=tx.onerror=()=>reject(tx.error||req.error);
  });
 }finally{db.close();}
}

const escapeHtml=text=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export const chapterHtml=text=>text.split(/\r?\n/).filter(line=>line.trim()).map(line=>/^\d+-\d+\s|^【(?:全剧总览|本集还原剧本)】/.test(line)?'<h2><strong>'+escapeHtml(line)+'</strong></h2>':'<p>'+escapeHtml(line)+'</p>').join('');

export const screenplayDocument=text=>'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>中英对照还原剧本</title><style>body{max-width:850px;margin:32px auto;padding:0 28px;font:15px/1.55 Arial,"Microsoft YaHei",sans-serif;color:#222}p{margin:0 0 5px}h2{font-size:22px;font-weight:700;line-height:1.4;margin:18px 0 7px}@media print{body{margin:0;padding:0}}</style><main>'+chapterHtml(text)+'</main></html>';
function download(record,field,plain=false){
 const rich=field==='screenplay'&&!plain;
 const url=URL.createObjectURL(new Blob([rich?screenplayDocument(record.data[field]):record.data[field]],{type:rich?'text/html;charset=utf-8':'text/plain;charset=utf-8'}));
 const link=document.createElement('a');
 link.href=url;link.download='第'+record.episode+'集-'+resultNames[field]+(rich?'.html':'.txt');link.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function element(tag,text,parent){
 const el=document.createElement(tag);
 if(text)el.textContent=text;
 parent?.append(el);
 return el;
}
function action(parent,text,fn){
 const button=element('button',text,parent);
 button.type='button';
 button.className='yingce-video-button';
 button.onclick=fn;
 return button;
}
function resultLinks(parent,record){
 if(record.video&&(record.error||!record.data))action(parent,'继续处理',()=>showImporter({resumeRecord:record,model:record.model}));
 if(record.data?.review?.length)action(parent,'待复核 '+record.data.review.length+' 项',()=>{
  const dialog=element('dialog',null,document.body);dialog.className='yingce-video-dialog';
  element('h2','本集待复核内容',dialog);
  element('pre',record.data.review.join('\n\n'),dialog).className='yingce-video-output';
  action(dialog,'关闭',()=>dialog.close());dialog.onclose=()=>dialog.remove();dialog.showModal();
 });
 if(record.data){for(const [field,label] of Object.entries(resultNames))action(parent,'下载'+label,()=>download(record,field));action(parent,'下载剧本纯文本',()=>download(record,'screenplay',true));}
 if(record.projectId&&record.chapterId){
  const link=element('a','打开章节',parent);
  link.href='/projects/'+encodeURIComponent(record.projectId)+'/chapters/'+encodeURIComponent(record.chapterId);
 }
}
async function droppedFiles(transfer){
 const entries=[...transfer.items].map(item=>item.webkitGetAsEntry?.()).filter(Boolean);
 if(!entries.length)return [...transfer.files];
 async function read(entry){
  if(entry.isFile)return [await new Promise((resolve,reject)=>entry.file(resolve,reject))];
  if(!entry.isDirectory)return [];
  const reader=entry.createReader(),files=[];
  for(;;){
   const batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));
   if(!batch.length)return files;
   for(const child of batch)files.push(...await read(child));
  }
 }
 const files=[];
 for(const entry of entries)files.push(...await read(entry));
 return files;
}

export function VideoImportInline({react,options}){
 const host=react.useRef(null);
 const latest=react.useRef(options);
 latest.current=options;
 const [slot,setSlot]=react.useState(null);
 const [model,setModel]=react.useState('');
 const [running,setRunning]=react.useState(false);
 const config=react.useSyncExternalStore(modelStore.subscribe,()=>modelStore.getState().config);
 const models=(config?.textModels||[]).filter(isVideoModel);
 const selected=models.includes(model)?model:models.includes(options.model)?options.model:models[0]||'';
 const selectedRef=react.useRef(selected);
 selectedRef.current=selected;
 react.useEffect(()=>showImporter({host:host.current,readOptions:()=>latest.current,
  mountModelPicker:setSlot,readModel:()=>selectedRef.current,onRunning:setRunning}),[]);
 return react.createElement(react.Fragment,null,react.createElement('div',{ref:host}),
  slot?reactDom().createPortal(react.createElement(ModelPicker,{
   config,value:selected,onChange:value=>{if(!running)setModel(value);},capability:'text',modelFilter:isVideoModel,
   variant:'creation',fullWidth:true,showSelectedPrice:false,showOptionPrices:false,
   placeholder:'选择已配置的视觉模型',popoverClassName:'agent-model-picker-popover yingce-video-model-popover'
  }),slot):null);
}

export function showImporter(projectStyle={}){
 const inline=!!projectStyle.host;
 if(!inline&&opened)return;
 if(!inline)opened=true;
 const dialog=element(inline?'section':'dialog',null,projectStyle.host||document.body);
 dialog.className=inline?'yingce-video-inline':'yingce-video-dialog';
 const dismiss=()=>{if(inline)projectStyle.readOptions?.().dismiss?.();else dialog.close();};
 const isProject=/^\/projects\/([0-9a-f]{32})(?:\/|$)/i.exec(location.pathname);
 const header=element('header',null,dialog);header.className='yingce-video-header';
 const heading=element('div',null,header);
 element('h2','导入视频',heading);
 element('p','通过视频改编 · 按集分析并保存',heading);
 const close=action(header,'×',dismiss);close.setAttribute('aria-label','关闭');if(inline){close.hidden=true;header.hidden=true;}
 const body=element('div',null,dialog);body.className='yingce-video-body';
 element('label',isProject?'当前项目':'新项目名称',body).htmlFor='yingce-video-project-name';
 const name=element('input',null,body);name.id='yingce-video-project-name';
 name.placeholder=isProject?'将追加到当前项目':'输入项目名称，可留空';
 name.value=projectStyle.name||'';
 name.disabled=!!isProject||!!projectStyle.resumeRecord;
 if(inline){name.hidden=true;body.querySelector('label[for=yingce-video-project-name]').hidden=true;}
 if(!inline)element('p','按集号排序，逐集生成剧本、逐字稿和骨架分析卡。',body);
 const drop=element('div',null,body);drop.className='yingce-video-drop';
 element('strong','将视频或文件夹拖到这里',drop);
 element('p','原音转写 · 逐句画面核对 · 单集上限 2 GB',drop);
 const pickers=element('div',null,drop);pickers.className='yingce-video-pickers';
 const files=element('input',null,drop);
 files.type='file';files.multiple=true;files.hidden=true;files.accept=Object.keys(mimeTypes).map(ext=>'.'+ext).join(',');
 const folder=element('input',null,drop);
 folder.type='file';folder.hidden=true;folder.multiple=true;folder.webkitdirectory=true;
 action(pickers,'选择视频',()=>files.click());
 action(pickers,'选择文件夹',()=>folder.click());
 element('label','分析模型',body).htmlFor='yingce-video-model';
 const model=element(projectStyle.mountModelPicker?'div':'select',null,body);model.id='yingce-video-model';
 if(projectStyle.mountModelPicker)projectStyle.mountModelPicker(model);
 const readModel=()=>projectStyle.readModel?projectStyle.readModel():model.value;
 initConfig();
 function syncModels(){
  if(projectStyle.mountModelPicker)return;
  const config=modelStore.getState().config,selected=model.value;
  model.replaceChildren();
  const placeholder=element('option','选择已配置的视觉模型',model);placeholder.value='';
  for(const id of (config?.textModels||[]).filter(isVideoModel)){
   const [channel,modelName]=id.includes('::')?id.split('::'):[null,id];
   const label=config.channels?.find(item=>item.id===channel)?.name;
   const option=element('option',modelName+(label?' · '+label:''),model);option.value=id;
  }
  const preferred=selected||(projectStyle.readOptions?.()||projectStyle).model||config?.chapterTextModel||config?.textModel;
  if(preferred&&[...model.options].some(option=>option.value===preferred))model.value=preferred;
 }
 syncModels();
 const unsubscribe=modelStore.subscribe(()=>{if(!model.disabled)syncModels();});
 let disposed=false;
 const dispose=()=>{if(disposed)return;disposed=true;unsubscribe();if(!inline)opened=false;dialog.remove();};
 if(!inline)dialog.onclose=dispose;
 const status=element('div',null,body);status.setAttribute('role','status');
 const total=element('progress',null,body);total.hidden=true;total.max=1;total.value=0;total.setAttribute('aria-label','总进度');
 const list=element('div',null,drop);list.className='yingce-video-queue';list.setAttribute('aria-label','已选视频');
 const footer=element('footer',null,dialog);footer.className='yingce-video-footer';
 let queue=[],running=false,projectId=isProject?.[1]||projectStyle.resumeRecord?.projectId,finished=new Set(),seriesDone=false;
 let jumped=false;
 const notify=()=>window.dispatchEvent(new Event(progressEvent));
 const updateEditor=(chapterId,sourceText)=>window.dispatchEvent(new CustomEvent('yingce-video-chapter-saved',{detail:{projectId,chapterId,sourceText}}));
 const saveChapter=async(chapterId,sourceText,expected)=>{
  const path='/projects/'+encodeURIComponent(projectId)+'/units/'+encodeURIComponent(chapterId);
  const read=async()=>{const result=await api.get(path);return (result.unit||result).sourceText||'';};
  const current=await read();
  if(current===sourceText)return;
  if(current!==expected)throw Error('章节已有修改，分析结果已保留，可在创作历史中查看后合并');
  await api.patch(path,{sourceText});
  if(await read()!==sourceText)throw Error('章节正文保存后回读不一致');
 };
 const openChapter=id=>{
  const route=chapterRoute(projectId,id);
  const options=projectStyle.readOptions?.()||projectStyle;
  if(options.navigate)options.navigate(route);
  else{history.pushState({...history.state},'',route);window.dispatchEvent(new PopStateEvent('popstate',{state:history.state}));}
 };
 const begin=action(footer,'开始分析并按集保存',async()=>{
  if(running)return;
  if(!queue.length||!readModel()){status.textContent='请选择视频和已配置的分析模型。';return;}
  if(queue.some(item=>item.file.size>2*1024**3)){status.textContent='有视频超过 2 GB，请压缩后重新选择。';return;}
  if(new Set(queue.map(x=>x.episode)).size!==queue.length){status.textContent='文件夹有重复集号，请检查文件名。';return;}
  running=true;projectStyle.onRunning?.(true);
  if(queue[0])queue[0].batchError='';
  for(const control of [files,folder,model,close,begin,...pickers.children])control.disabled=true;
  try{
   initClient();initGeneration();
   const config={...modelStore.getState().config,model:readModel(),textModel:readModel(),taskWorkflowProvider:'model'};
   const channel=resolveModel(config,config.model);
   if(!channel.apiKey||!channel.baseUrl)throw Error('该模型没有可用的个人渠道配置');

   await ensureSkillInstalled();
   const prompt=await loadTeardownPrompt();
   if(!projectId){
    const options=projectStyle.readOptions?.()||projectStyle;
    const project=await api.post('/projects',{name:String(options.readName?.()||name.value).trim()||queue[0].file.name.replace(/\.[^.]+$/,'')+' · 视频拆解',type:'short-drama',sourceType:'video',aspectRatio:options.readAspectRatio?.()||'9:16',...options.settings});
    projectId=project.id||project.project.id;
   }
   for(const item of queue){
    if(!item.chapterId){
     const chapter=await api.post('/projects/'+encodeURIComponent(projectId)+'/units',{kind:'chapter',title:'第 '+item.episode+' 集',sourceText:''});
     item.chapterId=chapter.id||chapter.unit.id;
    }
    if(!activeChapters.has(item.chapterId))activeChapters.set(item.chapterId,{item,queue,finished,retry:()=>begin.onclick()});
   }
   if(!jumped){
    jumped=true;
    openChapter(queue[0].chapterId);
    dismiss();
   }
   notify();
   for(const item of queue){
    if(finished.has(item))continue;
       const update=(label,value)=>{
     item.status.textContent=label;item.phase=label;item.percent=value;notify();
     item.progress.hidden=false;
     if(value===undefined)item.progress.removeAttribute('value');else item.progress.value=value;
    };
    update('准备视频');
    status.textContent='已保存 '+finished.size+' / '+queue.length+' 集 · 正在处理第 '+item.episode+' 集';
    try{
     if(!item.record)await archive('put',{id:item.historyId??=crypto.randomUUID(),projectId,chapterId:item.chapterId,
      episode:item.episode,filename:item.file.name,video:item.file,model:config.model,mimeType:item.mimeType,updatedAt:new Date().toISOString()});
     item.record??={id:item.historyId??=crypto.randomUUID(),model:config.model,episode:item.episode,filename:item.file.name,video:item.file,updatedAt:new Date().toISOString(),mimeType:item.mimeType,
      data:await analyze({...item,knownCharacters:queue.filter(previous=>finished.has(previous)).flatMap(previous=>previous.record.data.characters||[])},config,prompt,projectId,task=>{
       const progress=Number(task?.progress);
       update(task?.stage||'模型分析中',progress>0&&progress<100?progress:undefined);
      })};
     update('正在保存章节');
     await archive('put',item.record);
     const sourceText=chapterHtml(item.record.data.screenplay);
     await saveChapter(item.chapterId,sourceText,'');
     item.record.projectId=projectId;
     item.record.chapterId=item.chapterId;
     item.record.updatedAt=new Date().toISOString();
     delete item.record.error;
     updateEditor(item.chapterId,sourceText);
     await archive('put',item.record);
     chapterViewRoute='';
     document.getElementById('yingce-chapter-video-mode')?.remove();
     finished.add(item);
     update(item.record.data.review?.length?'已保存 · '+item.record.data.review.length+' 项待复核':'已保存',100);total.value=finished.size;

    }catch(error){
     update('失败 · '+error.message,0);
     try{
      await archive('put',{...item.record,id:item.record?.id||(item.historyId??=crypto.randomUUID()),
       projectId,chapterId:item.chapterId,model:config.model,episode:item.episode,filename:item.file.name,video:item.file,
       error:error.message,updatedAt:new Date().toISOString()});
     }catch{}
    }
   }
   if(queue.length>1&&finished.size===queue.length&&!seriesDone){
    status.textContent='各集已保存，正在生成全剧总览…';
    total.removeAttribute('value');
    const records=queue.map(item=>item.record);
    const first=records[0];
    first.seriesSummary??=await analyzeSeries(records,config,projectId);
    const sourceText=chapterHtml('【全剧总览】\n'+first.seriesSummary+'\n\n【本集还原剧本】\n'+first.data.screenplay);
    await saveChapter(first.chapterId,sourceText,chapterHtml(first.data.screenplay));
    updateEditor(first.chapterId,sourceText);
    await archive('put',first);
    seriesDone=true;total.value=finished.size;
   }
   notify();
   status.textContent='已保存 '+finished.size+' / '+queue.length+' 集'+(seriesDone?'，全剧总览已写入第一集章首。':'。');
  }catch(error){status.textContent=error.message;if(jumped){queue[0].batchError=error.message;notify();}}
  finally{running=false;projectStyle.onRunning?.(false);for(const control of [files,folder,model,close,begin,...pickers.children])control.disabled=false;}
 });
 begin.classList.add('ant-btn','ant-btn-primary');
 dialog.addEventListener('cancel',event=>{if(running)event.preventDefault();});
 function select(selection){
  if(running||jumped)return;
  const selected=episodeList(selection);
  if(!selected.length){status.textContent='没有找到可导入的视频。';return;}
  queue=mergeVideoSelection(queue,selected.map(item=>item.file));
  finished=new Set();seriesDone=false;
  total.max=Math.max(queue.length,1);total.value=0;list.replaceChildren();
  for(const item of queue){
   item.row=element('div',null,list);item.row.className='yingce-video-episode';
   const details=element('div',null,item.row);details.className='yingce-video-file-details';
   const filename=element('strong','第 '+item.episode+' 集 · '+item.file.name,details);filename.title=item.file.name;
   element('small',(item.file.size/1048576).toFixed(1)+' MB',details);
   item.status=element('div','等待分析',details);
   item.progress=element('progress',null,item.row);item.progress.max=100;item.progress.value=0;
   item.progress.hidden=true;
   item.progress.setAttribute('aria-label','第 '+item.episode+' 集进度');
  }
  status.textContent='已选择 '+queue.length+' 个视频，按集号排序。';
 }
 files.onchange=()=>{select(files.files);files.value='';};
 folder.onchange=()=>{select(folder.files);folder.value='';};
 drop.ondragover=event=>{event.preventDefault();if(!running)event.dataTransfer.dropEffect='copy';};
 drop.ondrop=async event=>{
  event.preventDefault();
  if(running)return;
  try{
   const dropped=await droppedFiles(event.dataTransfer);
   if(running||disposed||(!inline&&!dialog.open))return;
   files.value='';folder.value='';select(dropped);
  }catch(error){status.textContent='读取拖入文件失败：'+error.message;}
 };
 if(projectStyle.resumeRecord?.video){
  select([projectStyle.resumeRecord.video]);
  if(queue[0]){
   queue[0].chapterId=projectStyle.resumeRecord.chapterId;
   queue[0].episode=projectStyle.resumeRecord.episode;
   queue[0].row.querySelector('strong').textContent='第 '+queue[0].episode+' 集 · '+queue[0].file.name;
   queue[0].progress.setAttribute('aria-label','第 '+queue[0].episode+' 集进度');
   queue[0].historyId=projectStyle.resumeRecord.id;
   if(projectStyle.resumeRecord.data)queue[0].record=projectStyle.resumeRecord;
  }
 }
 if(!inline)dialog.showModal();
 return dispose;
}

function mountChapterProgress(route,anchor){
 const match=/\/chapters\/([^/]+)$/.exec(route);
 const run=match&&activeChapters.get(match[1]);
 let panel=document.getElementById('yingce-video-chapter-progress');
 if(!run||!anchor){panel?.remove();return;}
 const {item,queue,finished,retry}=run;
 const value=typeof item.percent==='number'?Math.min(100,Math.max(0,item.percent)):null;
 const label=item.batchError||item.phase||'等待分析';
 const failed=/^失败/.test(label)||!!item.batchError;
 const pending=!label.startsWith('已保存')&&!failed;
 const text=(pending?'视频解析中 · ':'')+label;
 const stamp=JSON.stringify([match[1],text,value,finished.size,queue.length]);
 if(panel?.dataset.stamp===stamp)return;
 if(!panel){panel=element('section',null,document.body);panel.id='yingce-video-chapter-progress';panel.className='yingce-video-chapter-progress';panel.setAttribute('role','status');}
 panel.dataset.stamp=stamp;panel.replaceChildren();
 const ring=element('div',value===null?'':value+'%',panel);
 ring.className='yingce-video-ring'+(value===null?' yingce-video-ring-working':'');
 ring.style.setProperty('--episode-progress',(value??28)+'%');
 const info=element('div',null,panel);
 const status=element('strong',text,info);if(pending)status.className='yingce-video-animated-text';
 element('div','第 '+item.episode+' 集 · 总进度 '+finished.size+' / '+queue.length+' 集',info);
 if(failed)action(panel,'重试未完成项',retry);
 const toolbar=anchor.parentElement;
 if(toolbar)toolbar.after(panel);
}
function mountChapterVideo(route,anchor){
 const match=/^\/projects\/([^/]+)\/chapters\/([^/]+)$/.exec(route);
 const current=document.getElementById('yingce-chapter-video-mode');
 if(chapterViewRoute!==route){document.body.classList.remove('yingce-video-chapter');current?.remove();chapterViewRoute='';chapterViewHasRecord=false;}
 const toolbar=document.querySelector('button[aria-label="段落格式"]')?.parentElement;
 if(!match||!anchor||!toolbar||chapterViewPending===route||(chapterViewRoute===route&&(current?.isConnected||!chapterViewHasRecord)))return;
 chapterViewRoute=route;chapterViewPending=route;
 archive('getAll').then(records=>{
  if(location.pathname!==route||!toolbar.isConnected){if(chapterViewRoute===route)chapterViewRoute='';chapterViewPending='';return;}
  const record=records.filter(item=>item.projectId===decodeURIComponent(match[1])&&item.chapterId===decodeURIComponent(match[2]))
   .sort((a,b)=>Number(!!b.data)-Number(!!a.data)||String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  chapterViewPending='';
  chapterViewHasRecord=!!(record?.video||record?.filename);
  document.body.classList.toggle('yingce-video-chapter',chapterViewHasRecord);if(!chapterViewHasRecord)return;
  const wrapper=element('span',null,toolbar);wrapper.id='yingce-chapter-video-mode';
  const icon=(label,paths,click)=>{
   const button=action(wrapper,'',click);
   button.title=label;button.setAttribute('aria-label',label);
   button.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">'+paths+'</svg>';
  };
  icon('逐镜拆解表','<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18M3 15h18"/>',()=>openShotTable(route,record));
  icon('原视频','<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3Z"/>',()=>{
   const dialog=element('dialog',null,document.body);dialog.className='yingce-video-dialog';
   const header=element('header',null,dialog);header.className='yingce-video-header';
   dialog.classList.add('yingce-video-preview');
   element('h2','第 '+record.episode+' 集 · 原视频',header);
   action(header,'×',()=>dialog.close()).setAttribute('aria-label','关闭');
   let url;
   if(record.video){
    const video=element('video',null,dialog);video.controls=true;video.preload='metadata';
    url=URL.createObjectURL(record.video);video.src=url;
   }else element('p','这集的早期记录未保存原视频，请重新导入。',dialog);
   if(record.data){
    const output=element('pre',record.data.screenplay,dialog);output.className='yingce-video-output';
    for(const [field,label] of Object.entries(resultNames))action(dialog,label,()=>{output.textContent=record.data[field];});
    if(record.data.review?.length)action(dialog,'待复核 '+record.data.review.length+' 项',()=>{
     output.textContent=record.data.review.join('\n\n');
    });
    if(record.data.utterances)for(const [mode,label] of [['zh','简体中文字幕'],['en','英文字幕'],['both','中英双语字幕']]){
     action(dialog,label,()=>{
      const data=URL.createObjectURL(new Blob([subtitleFile(record.data.utterances,mode)],{type:'text/plain;charset=utf-8'}));
      const link=element('a');link.href=data;link.download='第'+record.episode+'集-'+mode+'.srt';link.click();setTimeout(()=>URL.revokeObjectURL(data),1000);
     });
    }
   }
   dialog.onclose=()=>{dialog.querySelector('video')?.pause();if(url)URL.revokeObjectURL(url);dialog.remove();};
   dialog.showModal();
  });
 }).catch(()=>{chapterViewPending='';if(chapterViewRoute===route)chapterViewRoute='';});
}

function mountVideoHistory(route,anchor){
 let section=document.getElementById('yingce-video-history');
 if(!/^\/tasks(?:\/|$)/.test(route)){section?.remove();return;}
 if(!anchor||section)return;
 section=element('details',null,anchor.parentElement);
 section.id='yingce-video-history';section.className='yingce-video-history';
 element('summary','视频拆解记录',section);
 const body=element('div',null,section);
 section.ontoggle=async()=>{
  if(!section.open)return;
  body.replaceChildren();
  try{
   const records=await archive('getAll');
   if(!records.length)element('p','暂无视频拆解记录',body);
   for(const record of records.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')))){
    const row=element('div',null,body);row.className='yingce-video-episode';
    element('strong','第 '+record.episode+' 集 · '+record.filename,row);
    element('div',record.error?'失败 · '+record.error:record.data&&record.chapterId?'已保存到章节':record.data?'已返回，待保存到章节':'等待分析或阶段处理未完成',row);
    resultLinks(row,record);
   }
  }catch(error){element('p',error.message,body);}
 };
 const container=anchor.closest('header')||anchor.parentElement;
 container.after(section);
}
function mount(){

 const current=document.getElementById(marker);
 const route=location.pathname;
 const buttons=[...document.querySelectorAll('button')];
 const chapterButton=buttons.find(b=>/^生成到分镜制作(?:（已生成）)?$/.test(b.textContent.trim()));
 mountChapterProgress(route,chapterButton);
 mountChapterVideo(route,chapterButton);
 if(!/^\/tasks(?:\/|$)/.test(route)){current?.remove();mountVideoHistory(route,null);return;}
 if(current)return;
 const near=buttons.find(b=>b.textContent.trim()==='新建任务');
 mountVideoHistory(route,near);
 if(!near)return;
 const button=element('button',route.startsWith('/tasks')?'通过视频改编':'导入视频');
 button.type='button';button.id=marker;button.className='yingce-video-button';button.onclick=()=>showImporter();
 near.after(button);
}
if(typeof document!=='undefined'){
 const style=element('style',null,document.head);
 style.textContent=`
 body.yingce-video-chapter .tiptap p,body.yingce-video-chapter .ProseMirror p{margin-block:0 5px!important;line-height:1.55} body.yingce-video-chapter .tiptap h2,body.yingce-video-chapter .ProseMirror h2{font-size:22px!important;font-weight:700!important;line-height:1.4;margin-block:14px 6px!important}
 .yingce-video-button{padding:7px 12px;border:1px solid var(--border,#dedee7);border-radius:8px;margin:4px;cursor:pointer;background:var(--muted,#f4f4f7);color:var(--foreground,#292844)}
 #yingce-chapter-video-mode{display:inline-flex;align-items:center;gap:2px;border-left:1px solid var(--border,#ddd);margin-left:6px;padding-left:6px;flex-shrink:0} #yingce-chapter-video-mode .yingce-video-button{padding:4px;margin:0;border:0;background:transparent;color:var(--muted-foreground,#666);border-radius:4px} #yingce-chapter-video-mode .yingce-video-button:hover{background:var(--surface-hover,#eee)}
 .yingce-video-dialog.yingce-shot-table{width:min(1480px,94vw);max-width:94vw}
 .yingce-shot-scroll{max-height:58vh;overflow:auto}
 .yingce-shot-scroll table{border-collapse:collapse;width:100%;min-width:0;table-layout:fixed;font-size:12px}
 .yingce-shot-scroll th,.yingce-shot-scroll td{padding:6px;border:1px solid var(--border,#ddd);vertical-align:top}
 .yingce-shot-scroll th{position:sticky;top:0;background:var(--muted,#f5f5f7);z-index:1;text-align:left}
 .yingce-shot-scroll textarea{width:100%;min-width:0;resize:none;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;background:var(--card,#fff);color:inherit;padding:4px;font:inherit;line-height:1.5}
 .yingce-shot-scroll td:nth-child(4) button{display:block;white-space:nowrap;font-size:11px;margin-top:4px}
 .yingce-shot-column-grip{position:absolute;right:-3px;top:0;bottom:0;width:8px;cursor:col-resize;touch-action:none;z-index:2}.yingce-shot-column-grip:hover,.yingce-shot-column-grip:focus{background:var(--primary,#5b54d1);opacity:.5}
 .yingce-shot-scroll img{display:block;width:90px;height:auto}
 .yingce-shot-table video[hidden]{display:none}
 .yingce-video-button:disabled{opacity:.55;cursor:default}
 .yingce-video-dialog{position:fixed;inset:0;margin:auto;width:min(500px,92vw);max-height:84vh;overflow:auto;border:1px solid var(--border,#dedee7);border-radius:14px;background:var(--card,#fff);color:var(--foreground,#181832);box-shadow:0 12px 48px #16162d55;padding:18px}
 .yingce-video-dialog::backdrop{background:#15151d70;backdrop-filter:blur(3px)}
 .yingce-video-header{display:flex;align-items:center;justify-content:space-between;padding:0 0 12px;border-bottom:1px solid var(--border,#e8e8ee)}
 .yingce-video-header h2{font-size:17px;font-weight:650}.yingce-video-header button{font-size:20px;line-height:1;background:transparent;border:0}
 .yingce-video-body{padding:14px 0}.yingce-video-dialog input,.yingce-video-dialog select{display:block;margin:6px 0 12px;padding:8px;border:1px solid var(--border,#dedee7);border-radius:8px;width:100%;background:var(--muted,#f7f7f9)}
 .yingce-video-drop{border:1px dashed var(--border,#c6c6d1);padding:26px 12px;border-radius:10px;background:var(--muted,#f7f7f9);margin:12px 0;text-align:center}.yingce-video-drop input[hidden]{display:none}.yingce-video-pickers{display:flex;justify-content:center;gap:8px;flex-wrap:wrap}.yingce-video-header p,.yingce-video-file-details small{color:var(--muted-foreground,#707078)}
 .yingce-video-dialog p{margin:8px 0;overflow-wrap:anywhere}.yingce-video-inline [hidden]{display:none!important}.yingce-video-inline select{display:block;width:100%;padding:7px;margin:4px 0 8px;border:1px solid var(--border,#ddd);border-radius:8px;background:var(--muted,#f5f5f7)}.yingce-video-inline progress{width:100%;height:7px;accent-color:var(--primary)}.yingce-video-inline .yingce-video-body{padding:0}.yingce-video-inline .yingce-video-footer{margin-top:8px}.yingce-video-dialog progress[hidden]{display:none}.yingce-video-dialog progress{width:100%;height:7px;accent-color:var(--primary,#5b54d1)}
 .yingce-video-queue{display:grid;gap:8px;margin:8px 0 0;max-height:180px;overflow:auto;text-align:left}.yingce-video-episode{padding:8px 12px;border:1px solid #e8e8ef;border-radius:9px;overflow-wrap:anywhere}
 .yingce-video-footer{display:flex;flex-wrap:wrap;justify-content:flex-end;border-top:1px solid var(--border,#e8e8ee);padding-top:10px}
 .yingce-video-file-details{display:flex;gap:6px 12px;flex-wrap:wrap;align-items:baseline}.yingce-video-footer .ant-btn-primary{color:var(--primary-foreground,#fff);background:var(--primary,#5b54d1);border-color:var(--primary,#5b54d1)}
 .yingce-video-chapter-progress{display:flex;align-items:center;gap:12px;margin:10px 12px;padding:12px 16px;background:var(--muted,#f5f5f7);color:var(--foreground,#222);border:1px solid var(--border,#ddd);border-radius:10px}
 .yingce-video-ring{display:grid;place-items:center;flex:0 0 44px;height:44px;border-radius:50%;font-size:10px;font-weight:650;background:radial-gradient(closest-side,var(--muted,#f5f5f7) 77%,transparent 80%),conic-gradient(var(--primary,#5b54d1) var(--episode-progress),var(--border,#ddd) 0)}
 .yingce-video-ring-working{animation:yingce-video-spin 1s linear infinite}.yingce-video-animated-text{animation:yingce-video-pulse 1.35s ease-in-out infinite}
 @keyframes yingce-video-spin{to{transform:rotate(360deg)}}@keyframes yingce-video-pulse{50%{opacity:.55}}
 .yingce-video-model-popover{z-index:1200!important}
 .yingce-video-history{width:100%;max-width:100%;margin:8px 0;padding:10px;border:1px solid var(--border,#ddd);border-radius:9px}.yingce-video-history summary{cursor:pointer}.yingce-video-history>div{max-height:42vh;overflow:auto}.yingce-video-history .yingce-video-episode{margin-top:6px}
 .yingce-video-create .ant-modal{padding-bottom:0}
 .yingce-video-create .ant-modal-content{padding:clamp(12px,2vh,22px) 24px}
 .yingce-video-create .ant-modal-header{margin-bottom:4px}
 .yingce-video-create .ant-form-item{margin-bottom:clamp(4px,1vh,10px)}
 .yingce-video-create .ant-form-item-label{padding-bottom:3px}
 .yingce-video-create .app-story-source{min-height:34px;height:auto;padding:4px 8px;flex-direction:row;align-items:center;justify-content:center;gap:6px}
 .yingce-video-create .app-story-modal-style{min-height:32px;padding-block:4px}
 .yingce-video-inline .yingce-video-drop{padding:8px;margin:3px 0 6px}
 .yingce-video-inline .yingce-video-drop p{margin:1px 0;font-size:11px}
 .yingce-video-inline .yingce-video-pickers .yingce-video-button{padding:4px 8px;margin:2px}
 .yingce-video-inline .yingce-video-queue{max-height:clamp(38px,11vh,110px);margin-top:4px;gap:4px}
 .yingce-video-inline .yingce-video-queue:empty{display:none}
 .yingce-video-inline .yingce-video-episode{padding:4px 7px}
 .yingce-video-inline .yingce-video-file-details{gap:0 8px;font-size:11px}
 .yingce-video-inline .yingce-video-file-details strong{min-width:0;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .yingce-video-inline [role=status]{font-size:11px;line-height:1.3}
 .yingce-video-inline select{margin:2px 0 4px;padding:4px 7px}
 .yingce-video-inline .yingce-video-footer{margin-top:4px;padding-top:4px}
 .yingce-video-preview video{max-height:26vh!important}.yingce-video-preview .yingce-video-output{max-height:22vh}
 .yingce-video-dialog video{display:block;width:min(100%,480px);max-height:35vh;margin-bottom:10px;background:#111}.yingce-video-output{max-height:30vh;overflow:auto;white-space:pre-wrap}
 `;
 ensureSkillInstalled().catch(error=>console.warn('扒剧技能安装未完成',error.message));
 window.addEventListener(progressEvent,mount);
 new MutationObserver(mount).observe(document.body,{subtree:true,childList:true});
 mount();
}
