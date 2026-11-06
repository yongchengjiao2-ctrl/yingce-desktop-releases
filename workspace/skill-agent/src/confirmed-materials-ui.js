import {MATERIAL_TYPES,projectContext} from './confirmed-materials.js';
export async function openMaterials({store,projectId,dialog,el,button,seed,onSaved,assertActive}){
  assertActive();if(!projectId)throw Error('请先打开一个项目');
  const records=await store.list();assertActive();
  const d=dialog(seed?'确认采用为项目资料':'已确认资料库');
  el('p','只有你确认的资料才会作为正式依据。资料在本项目的会话间共用；保存到章节不会自动确认。',d.body);
  const editor=el('div',null,d.body,'ysa-material-editor'),rows=el('div',null,d.body);
  const edit=item=>{
    editor.replaceChildren();
    const field=(title,tag)=>{const label=el('label',title,editor);return el(tag,null,label);};
    const type=field('资料分类','select');for(const [value,label] of Object.entries(MATERIAL_TYPES)){const o=el('option',label,type);o.value=value;}type.value=item?.type||'setting';
    const title=field('资料标题','input');title.value=item?.title||'';title.required=true;
    const content=field('确认正文（可删去讨论、备选方案和说明）','textarea');content.value=item?.content||'';content.rows=10;content.required=true;
    if(item?.revisions?.length){const versions=el('details',null,editor);el('summary',`查看 ${item.revisions.length} 个旧版本`,versions);for(const version of [...item.revisions].reverse()){el('p',`第${version.revision}版 · ${version.title}`,versions);el('pre',version.content,versions);}}
    const enabled=field('后续请求带入此资料','input');enabled.type='checkbox';enabled.checked=item?.enabled!==false;
    const feedback=el('p','',editor);feedback.setAttribute('role','status');
    const save=button(editor,item?.id?'确认更新':'确认采用',async()=>{
      if(save.disabled)return;save.disabled=true;
      try{assertActive();await store.save({...item,type:type.value,title:title.value,content:content.value,enabled:enabled.checked},projectId);await onSaved();d.close();}
      catch(e){feedback.textContent=e.message;}finally{save.disabled=false;}
    });
  };
  if(seed)edit(seed);else{
    button(editor,'新增已确认资料',()=>edit(null));
    const own=records.filter(r=>r.projectId===projectId&&!r.archived);
    if(!own.length)el('p','暂无已确认资料。可手动新增，也可从助手回复中选择“确认采用”。',rows);
    for(const item of own){const row=el('div',null,rows);el('p',`${MATERIAL_TYPES[item.type]} · ${item.title} · 第${item.revision}版 · ${item.enabled?'将带入':'不带入'}`,row);button(row,'查看与编辑',()=>edit(item));}
  }
}
export async function openContextPreview({store,projectId,session,prompt,dialog,el,assertActive=()=>{}}){
  const context=projectContext(await store.list(),projectId,session.references||[],session.messages||[],prompt||'（本轮要求尚未填写）',session.includeWorkingDraft!==false);
  assertActive();
  const d=dialog('本轮上下文');
  el('p',`已确认资料 ${context.materials.length} 项 · 普通引用 ${context.referenceCount} 项 · 当前工作稿 ${context.workingDraftId?'1':'0'} 份 · 历史聊天不自动发送`,d.body);
  for(const item of context.materials)el('p',`${item.title} · 第${item.revision}版`,d.body);
  const details=el('details',null,d.body);el('summary','查看本轮组装正文（不含另外加载的技能指令）',details);el('pre',context.prompt,details);
}
