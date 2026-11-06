import {buildContext,usableMessages,uid} from './skill-agent-core.js';
export const MATERIAL_KEY='yingce-confirmed-materials-v1';
export const MATERIAL_TYPES={character:'人物',setting:'世界观与设定',outline:'总纲',episode:'集纲',rule:'创作规则'};
export function reviseMaterial(records,draft,projectId){
  if(!projectId)throw Error('请先打开一个项目');
  if(!MATERIAL_TYPES[draft.type]||!draft.title?.trim()||!draft.content?.trim())throw Error('请填写资料分类、标题和正文');
  const previous=draft.id?records.find(r=>r.id===draft.id&&r.projectId===projectId):null;
  if(draft.id&&!previous)throw Error('资料已不存在，请重新打开资料库');
  if(previous&&draft.revision!==previous.revision)throw Error('资料已被修改，请重新打开后编辑');
  const updatedAt=new Date().toISOString();
  const item={id:previous?.id||uid(),projectId,type:draft.type,title:draft.title.trim(),content:draft.content.trim(),enabled:draft.enabled!==false,archived:false,revision:(previous?.revision||0)+1,updatedAt,sourceMessageId:draft.sourceMessageId||previous?.sourceMessageId||'',revisions:[...(previous?.revisions||[]),...(previous?[{revision:previous.revision,title:previous.title,content:previous.content,updatedAt:previous.updatedAt}]:[])]};
  item.sourceConversationId=draft.sourceConversationId||previous?.sourceConversationId||'';
  return {item,records:[...records.filter(r=>r.id!==item.id),item]};
}
export function materialStore(store,scope){
  let queue=Promise.resolve();
  const list=async()=>{const value=JSON.parse(await store.getItem(MATERIAL_KEY)||'[]');if(!Array.isArray(value))throw Error('资料库格式异常，未覆盖原记录');return value;};
  const save=(draft,projectId)=>{
    const write=async()=>{const result=reviseMaterial(await list(),draft,projectId);await store.setItem(MATERIAL_KEY,JSON.stringify(result.records));return result.item;};
    const job=queue.catch(()=>{}).then(()=>globalThis.navigator?.locks? navigator.locks.request('yingce-materials:'+scope,write):write());queue=job;return job;
  };
  return {list,save,flush:()=>queue};
}
export function projectContext(records,projectId,references,messages,prompt,includeDraft=true){
  if(!projectId)throw Error('请先关联当前项目');
  const confirmed=records.filter(r=>r.projectId===projectId&&r.enabled&&!r.archived);
  const refs=[...confirmed.map(r=>({label:`已确认${MATERIAL_TYPES[r.type]} · ${r.title} · 第${r.revision}版`,text:r.content})),...references];
  const latest=includeDraft?[...usableMessages(messages)].reverse().find(m=>m.role==='assistant'):null;
  if(latest)refs.push({label:'当前未确认工作稿',text:'这是最近回复，仅用于本轮修改，尚未确认为正式设定。\n'+latest.content});
  const context=buildContext(refs,[],'创作依据：已确认资料是正式依据；当前工作稿和普通引用仅供本轮讨论。发现冲突请指出，不得自行更改正式设定。未提供的历史细节请询问，不得假装记得。\n\n'+prompt);
  return {...context,materials:confirmed.map(r=>({id:r.id,title:r.title,revision:r.revision})),workingDraftId:latest?.id||null,referenceCount:references.length};
}
