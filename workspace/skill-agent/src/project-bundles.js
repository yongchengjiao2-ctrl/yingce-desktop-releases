import {a as api,o as initRequest} from './request-Dlp4yxtR.js';
import {r as storageFor,t as initStorage} from './localforage-storage-BDs_z-cE.js';
import {t as userScope,n as initScope} from './user-scope-CMp2r8yk.js';
import {_ as canvasStore,d as initCanvas} from './use-asset-store-yGdco-1O.js';
import {flushCreationConversations,filterDeletedConversations} from './creation-history-storage.js';
import {projectFrontend,projectIdFromCard} from './project-bundle-core.js';
initRequest();initStorage();initScope();initCanvas();
const keys=['yingce-skill-agent-v1','creation-conversations-v1','yingce-chapter-outputs-v1'];
async function call(action,data){
 const r=await api.raw({url:'/desktop/project-bundles/'+action,baseURL:'',method:data===undefined?'GET':'POST',data,timeout:0,validateStatus:()=>true});
 if(r.status!==200)throw Error(r.data?.error||'此功能需要重新启动影策后使用');return r.data;
}
async function applyReceipt(r){
 const scope=userScope(),store=storageFor(scope);
 for(const key of keys){
  const imported=r.frontend?.[key];if(!Array.isArray(imported))continue;
  const old=JSON.parse(await store.getItem(key)||'[]'),seen=new Set(old.map(v=>v.id));
  for(const entry of imported)if(!seen.has(entry.id)){old.push({...entry,scope,importedFromBundle:r.id});seen.add(entry.id);}
  await store.setItem(key,JSON.stringify(old));
 }
 for(const record of r.frontend?.['yingce-creation-skill-selections-v1']||[])localStorage.setItem('yingce:creation-skills:'+scope+':'+record.id,JSON.stringify(record.skillIds));
 await call('ack',{id:r.id});
 window.dispatchEvent(new Event('yingce-project-history-imported'));
}
const el=(tag,text,parent,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;parent?.append(n);return n;};
let transferBusy=false;
const icon=(path)=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+path+'"/></svg>';
const packageIcon=()=>icon('m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 9 8-4.5M12 12 4 7.5M12 12v9M8 5.25l8 4.5');
function notice(text,error=false){let n=document.getElementById('ysa-transfer-notice');if(!n){n=el('div',null,document.body,'ysa-transfer-notice');n.id='ysa-transfer-notice';n.setAttribute('role','status');}n.replaceChildren();n.dataset.error=String(error);el('span',text,n);const b=el('button','关闭',n);b.onclick=()=>n.remove();return n;}
async function collectFrontend(projectId){
 const scope=userScope();const before={promises:[]};window.dispatchEvent(new CustomEvent('yingce-before-project-export',{detail:before}));await Promise.all([...before.promises,flushCreationConversations(scope)]);
 const sync=await import('./user-data-sync-B6hrlYAn.js');sync.s();for(const p of canvasStore.getState().projects)await sync.g(p.id);
 const records={};for(const key of keys)records[key]=JSON.parse(await storageFor(scope).getItem(key)||'[]');
 records['creation-conversations-v1']=filterDeletedConversations(scope,records['creation-conversations-v1']);
 const selected=projectFrontend(records,projectId);selected['yingce-creation-skill-selections-v1']=selected['creation-conversations-v1'].map(c=>({id:c.id,skillIds:JSON.parse(localStorage.getItem('yingce:creation-skills:'+scope+':'+c.id)||'[]')}));return selected;
}
async function exportProject(projectId,trigger){
 if(transferBusy)return;if(document.querySelector('.ysa-panel [data-stop]:not(:disabled)'))throw Error('请先停止生成，再打包项目');
 transferBusy=true;if(trigger){trigger.disabled=true;trigger.setAttribute('aria-busy','true');}
 try{notice('正在打包项目…');const frontend=await collectFrontend(projectId),r=await call('export',{projectId,frontend});notice('项目已打包：'+r.path+' · '+(r.bytes/1024/1024).toFixed(1)+' MB');return r;}
 catch(e){notice(e.message,true);throw e;}finally{transferBusy=false;if(trigger){trigger.disabled=false;trigger.removeAttribute('aria-busy');}}
}
async function importProject(){
 if(transferBusy)return;if(document.querySelector('.ysa-panel [data-stop]:not(:disabled)'))throw Error('请先停止生成，再导入项目');
 transferBusy=true;
 try{const r=await call('import',{});if(r.cancelled)return;await applyReceipt(r);const n=notice('项目已导入，重新载入后查看章节、画布和聊天记录。'),b=el('button','查看项目',n);b.onclick=()=>location.reload();return r;}
 catch(e){notice(e.message,true);throw e;}finally{transferBusy=false;}
}
async function show(){
 if(document.getElementById('yingce-project-bundles'))return;
 const d=el('dialog',null,document.querySelector('.app-user-workspace')||document.body,'ysa-dialog ysa-bundle-dialog');d.id='yingce-project-bundles';
 const head=el('header',null,d);el('strong','项目打包与迁移',head);const close=el('button','关闭',head);close.onclick=()=>{d.close();d.remove();};d.oncancel=e=>{e.preventDefault();close.click();};
 const body=el('section',null,d,'ysa-dialog-body');el('p','将当前账号的短剧项目、章节、画布、聊天记录与引用素材打包，带到另一台电脑继续创作。',body);
 const grid=el('div',null,body,'ysa-bundle-grid');
 let busy=false;const buttons=[];
 const status=el('p','',body,'ysa-bundle-status');status.setAttribute('role','status');
 const action=(title,description,fn)=>{const b=el('button',null,grid);el('strong',title,b);el('span',description,b);buttons.push(b);b.onclick=async()=>{if(busy)return;busy=true;buttons.forEach(v=>v.disabled=true);status.textContent='正在处理，请稍候…';try{await fn();}catch(e){status.textContent=e.message;}finally{busy=false;buttons.forEach(v=>v.disabled=false);}};};
 action('导出 ZIP','章节格式、对话与素材一起保存',async()=>{
  if(document.querySelector('.ysa-panel [data-stop]:not(:disabled)'))throw Error('请先停止生成，再打包项目');
  const match=/^\/projects\/([^/]+)\/chapters(?:\/([^/]+))?/.exec(location.pathname);let editor;
  if(match){const projectId=decodeURIComponent(match[1]),chapterId=match[2]?decodeURIComponent(match[2]):sessionStorage.getItem('project-active-chapter:'+projectId);window.dispatchEvent(new CustomEvent('yingce-agent-editor-request',{detail:{projectId,chapterId,action:'snapshot',done:v=>editor=v}}));if(editor?.dirty)throw Error('请先保存章节中的修改，再导出 ZIP');}
  const scope=userScope(),frontend={};
  const before={promises:[]};window.dispatchEvent(new CustomEvent('yingce-before-project-export',{detail:before}));await Promise.all([...before.promises,flushCreationConversations(scope)]);
  const sync=await import('./user-data-sync-B6hrlYAn.js');sync.s();
  for(const p of canvasStore.getState().projects)await sync.g(p.id);
  for(const key of keys)frontend[key]=JSON.parse(await storageFor(scope).getItem(key)||'[]');
  frontend['creation-conversations-v1']=filterDeletedConversations(scope,frontend['creation-conversations-v1']);
  frontend['yingce-creation-skill-selections-v1']=frontend['creation-conversations-v1'].map(c=>({id:c.id,skillIds:JSON.parse(localStorage.getItem('yingce:creation-skills:'+scope+':'+c.id)||'[]')}));
  const r=await call('export',{frontend});status.textContent='已导出：'+r.path+'（'+(r.bytes/1024/1024).toFixed(1)+' MB）';
 });
 action('导入 ZIP','恢复为副本，保留已有项目',async()=>{if(document.querySelector('.ysa-panel [data-stop]:not(:disabled)'))throw Error('请先停止生成，再导入项目');const r=await call('import',{});if(r.cancelled){status.textContent='已取消导入';return;}await applyReceipt(r);status.textContent='导入成功。重新载入后可查看项目和聊天记录。';const refresh=el('button','重新载入',status);refresh.onclick=()=>location.reload();});
 action('打开打包目录','查找、复制已导出的 ZIP 文件',async()=>{await call('open-folder',{});status.textContent='已打开打包目录';});
 action('打开功能源文件','查看项目迁移功能的源代码',async()=>{await call('open-source',{});status.textContent='已定位功能源文件';});
 el('small','另一台电脑需安装支持此功能的影策，在此处导入 ZIP。模型密钥、登录账号不随项目迁移。导入前自动备份。',body);
 d.showModal();try{const r=await call('info');el('p','默认打包目录：'+r.folder,body,'ysa-bundle-path');const pending=await call('pending');for(const r of pending.records)await applyReceipt(r);}catch(e){status.textContent=e.message;}
}
function mount(){
 document.getElementById('yingce-project-bundle-launch')?.remove();
 const library=/^\/projects\/?$/.test(location.pathname),admin=/^\/admin(?:\/|$)/.test(location.pathname);
 if(!library){document.querySelectorAll('.ysa-project-import-card,.ysa-bundle-empty-grid').forEach(n=>n.remove());}
 if(library){
  for(const card of document.querySelectorAll('a.project-library-card')){
   if(card.querySelector('.ysa-project-export'))continue;const id=projectIdFromCard(card),cover=card.querySelector('.project-library-cover');if(!id||!cover)continue;
   const b=el('button',null,cover,'ysa-project-export');b.type='button';b.innerHTML=packageIcon();b.setAttribute('aria-label','一键打包项目');b.dataset.ysaTip='一键打包项目';b.title='一键打包项目';
   b.onclick=event=>{event.preventDefault();event.stopPropagation();exportProject(id,b).catch(()=>{});};
  }
  const page=document.querySelector('.project-library-page');if(page){
   const nativeGrid=page.querySelector('.project-library-grid:not(.ysa-bundle-empty-grid)');if(nativeGrid)page.querySelectorAll('.ysa-bundle-empty-grid').forEach(n=>n.remove());
   let grid=nativeGrid||page.querySelector('.project-library-grid');if(!grid){grid=el('div',null,null,'library-grid project-library-grid ysa-bundle-empty-grid');const last=page.querySelector('.library-load-more');if(last)last.before(grid);else page.append(grid);}
   if(!grid.querySelector('.ysa-project-import-card')){const card=el('button',null,grid,'product-collection-card library-card ysa-project-import-card');card.type='button';card.setAttribute('aria-label','一键上传项目');const artwork=el('span',null,card,'ysa-import-artwork');artwork.innerHTML=icon('M12 16V4m-4 4 4-4 4 4M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5');el('strong','一键上传项目',card);el('span','选择项目 ZIP，恢复章节、聊天与画布',card,'ysa-import-description');el('small','从另一台电脑继续你的创作',card);card.onclick=()=>importProject().catch(()=>{});}
  }
 }
 let b=document.getElementById('ysa-admin-bundles');if(!admin){b?.remove();return;}
 if(!b){const host=document.querySelector('.admin-main,.admin-content,main');if(host){b=el('button','项目打包管理',host,'ysa-admin-bundles');b.id='ysa-admin-bundles';b.onclick=show;}}
}
const css=el('link',null,document.head);css.rel='stylesheet';css.href=new URL('./project-bundles.css',import.meta.url).href;
new MutationObserver(mount).observe(document.body,{childList:true,subtree:true});mount();
