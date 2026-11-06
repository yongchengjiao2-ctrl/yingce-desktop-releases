export async function referencePicker({references,dialog,el,button,projectData,readChapter,snapshot,getSelection,route,plain,onApply,openHistory}){
  const d=dialog('参考内容');d.body.closest('dialog').classList.add('ysa-reference-dialog');
  const key=r=>r.sourceKey||(r.chapterId?'chapter:'+r.chapterId:r.label==='人物、场景、道具设定'?'project-assets':r.label==='项目大纲与设定'?'project-outline':r.label?.startsWith('资料 · ')?'file:'+r.label.slice(5):r.id);
  const pending=new Map(references.map(r=>[key(r),r])),controls=[];
  el('p','选择本轮需要的资料，确认后才会带入。章节可多选；点击已选内容可取消。',d.body);
  const sources=el('div',null,d.body,'ysa-reference-sources'),chapters=el('div',null,d.body,'ysa-reference-chapters'),selected=el('div',null,d.body,'ysa-reference-selected');
  const feedback=el('p','',d.body);feedback.setAttribute('role','status');
  const refresh=()=>{
    selected.replaceChildren();el('strong',`已选 ${pending.size} 项`,selected);
    if(!pending.size)el('p','暂未选择参考内容',selected);
    for(const [id,r] of pending){const row=el('div',null,selected);el('span',r.label,row);const remove=button(row,'移除',()=>{pending.delete(id);refresh();});remove.setAttribute('aria-label','移除引用：'+r.label);}
    for(const {control,id} of controls)control.setAttribute('aria-pressed',String(pending.has(id)));
    apply.textContent=`确认引用${pending.size?' · '+pending.size:''}`;
  };
  const choice=(parent,title,id,load)=>{
    const control=button(parent,title,async()=>{
      if(control.disabled)return;
      if(pending.has(id)){pending.delete(id);refresh();return;}
      control.disabled=true;
      try{const ref=await load();if(!ref.text?.trim())throw Error('此资料暂无正文');pending.set(id,{...ref,sourceKey:id});refresh();}
      catch(error){feedback.textContent=error.message;}finally{control.disabled=false;}
    });control.setAttribute('aria-label',title);control.setAttribute('aria-pressed',String(pending.has(id)));controls.push({control,id});return control;
  };
  const selectedText=getSelection();
  const selectionId='selection:'+selectedText?.chapterId+':'+selectedText?.selection?.from+':'+selectedText?.selection?.to;
  const selectionButton=choice(sources,'选中文字',selectionId,async()=>({label:'章节选中文字',text:selectedText.text,chapterId:selectedText.chapterId}));selectionButton.disabled=!selectedText?.text||selectedText.route!==route().pathname;
  const current=route();
  choice(sources,'当前章节','chapter:'+current.chapterId,async()=>{const snap=snapshot();return{label:'章节 · '+snap.title,text:snap.field==='sourceText'?plain(snap.content):snap.content,chapterId:snap.chapterId,projectId:snap.projectId};});
  const showChapters=button(sources,'选择章节',async()=>{
    if(showChapters.getAttribute('aria-expanded')==='true'){chapters.hidden=true;showChapters.setAttribute('aria-expanded','false');return;}
    chapters.hidden=false;showChapters.setAttribute('aria-expanded','true');
    if(chapters.children.length)return;
    showChapters.disabled=true;
    try{const data=await projectData();const units=(data.units||[]).filter(u=>u.kind==='chapter');
      if(!units.length)el('p','当前项目暂无章节',chapters);
      for(const u of units)choice(chapters,u.title,'chapter:'+u.id,async()=>{const r=await readChapter(u.id),unit=r.unit||r;return{label:'章节 · '+unit.title,text:plain(unit.sourceText)+(unit.screenplayText?'\n【画面剧本】\n'+unit.screenplayText:''),chapterId:u.id,projectId:current.projectId};});
    }catch(error){feedback.textContent=error.message;showChapters.setAttribute('aria-expanded','false');}finally{showChapters.disabled=false;}
  });showChapters.setAttribute('aria-expanded','false');chapters.hidden=true;
  choice(sources,'人物与场景','project-assets',async()=>{const data=await projectData();return{label:'人物、场景、道具设定',text:JSON.stringify((data.assets||[]).map(a=>({name:a.name||a.title,category:a.category,description:a.description,character:a.character,extraInfo:a.extraInfo})),null,2)};});
  choice(sources,'项目大纲','project-outline',async()=>{const data=await projectData(),p=data.project||data;return{label:'项目大纲与设定',text:JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k])=>/name|description|outline|synopsis|setting|style|summary/i.test(k))),null,2)};});
  button(sources,'从历史对话选择',()=>{if(JSON.stringify([...pending.values()])!==JSON.stringify(references)){feedback.textContent='请先确认当前选择，再从历史对话添加内容。';return;}d.close();return openHistory();});
  const upload=el('label','本地资料（TXT、Markdown、JSON、CSV，最大 1 MB）',d.body),file=el('input',null,upload);file.type='file';file.accept='.txt,.md,.json,.csv';
  file.onchange=async()=>{try{const f=file.files[0];if(!f)return;if(f.size>1024*1024)throw Error('文件不能超过 1 MB');const text=await f.text();if(!text.trim())throw Error('文件内容为空');pending.set('file:'+f.name,{label:'资料 · '+f.name,text,sourceKey:'file:'+f.name});refresh();}catch(error){feedback.textContent=error.message;}finally{file.value='';}};
  const apply=button(d.footer,'确认引用',async()=>{if(apply.disabled)return;apply.disabled=true;try{await onApply([...pending.values()]);d.close();}catch(error){feedback.textContent=error.message;}finally{apply.disabled=false;}});
  refresh();return d;
}
