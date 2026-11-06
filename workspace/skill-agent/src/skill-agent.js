import {deleteCreationConversation,filterDeletedConversations} from './creation-history-storage.js';
import {composeButton,composerIcon} from './composer-icons.js';
import {agentTooltips} from './agent-tooltips.js';
import {projectSidebar} from './project-sidebar.js';
import {adaptiveComposer} from './adaptive-composer.js';
import {floatingAgent,iconButton} from './floating-agent.js';
import {outputRichText} from './output-rich-text.js';
import {startThemedSelects} from './themed-select.js';
import {mountNativeMessage} from './agent-native-message.js';
import {a as api, o as initRequest} from './request-Dlp4yxtR.js';
import {c as initSkills, f as addedSkills, u as installSkill, t as addSkill} from './skills-DHDdovXH.js';
import {a as skillRuntime, r as initSkillRuntime} from './skill-runtime-CF8drDK4.js';
import {_ as configStore, l as initConfig} from './use-config-store-BNvhZKBV.js';
import {o as generate, n as initGeneration} from './generation-task-B2p8YPAC.js';
import {r as storageFor, t as initStorage} from './localforage-storage-BDs_z-cE.js';
import {t as userScope, n as initScope} from './user-scope-CMp2r8yk.js';
import {_ as canvasStore, d as initCanvas} from './use-asset-store-yGdco-1O.js';
import {mountAgentControls} from './agent-composer-controls.js';
import {showChapterSave,conversationText,downloadOutput} from './chapter-output.js';
import {newSession, uid, buildContext, planWrite, assertUnchanged, importedSession, usableMessages} from './skill-agent-core.js';

initRequest(); initSkills(); initSkillRuntime(); initConfig(); initGeneration(); initStorage(); initScope(); initCanvas();
const KEY = 'yingce-skill-agent-v1';
let scope = userScope(), sessions = [], currentId = '', skills = [], busy = false, controller, panel, status, list, input, sessionPicker, skillPicker, modelPicker, chips;
const updateProjectSidebar=projectSidebar();
const messageViews=new Map();
let latestAnchor;
function positionLatest(){if(!list||!latestAnchor)return;const card=list.querySelector(`[data-message-id="${latestAnchor}"]`);if(card)list.scrollTop+=card.getBoundingClientRect().top-list.getBoundingClientRect().top-20;}
let saving = Promise.resolve(), selection, writeBusy = false, modal, openRoute = '', lastTask, expandButton, nativeControls,sessionTitle,editingTitle=false,floating,composerBehavior,fullscreenButton,minimized=false,backdrop;
const enc = encodeURIComponent;
const workspaceRoot=()=>document.querySelector('.app-user-workspace')||document.body;
const route = () => { const m = /^\/projects\/([^/]+)(?:\/chapters(?:\/([^/]+))?)?/.exec(location.pathname); const projectId=m ? decodeURIComponent(m[1]) : '';return {projectId, chapterId: m?.[2] ? decodeURIComponent(m[2]) : location.pathname.endsWith('/chapters') ? window.sessionStorage.getItem('project-active-chapter:'+projectId)||'' : ''}; };
const current = () => sessions.find(s => s.id === currentId);
const el = (tag, text, parent, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; parent?.append(n); return n; };
const button = (parent, text, fn, cls = '') => { const b = el('button', text, parent, cls); b.type = 'button'; b.onclick = () => Promise.resolve().then(fn).catch(showError); return b; };
const option = (parent, value, text) => { const o = el('option', text, parent); o.value = value; return o; };
const now = () => new Date().toISOString();
function note(text) { if (status) {status.textContent = text;status.hidden=!busy&&/^(当前目标|会话保存在本机|新会话已保存|会话已关联|已加入引用|生成完成)/.test(text);} }
function showError(error) { const text = error?.message || String(error); note(text); if (modal) { let target = modal.querySelector('.ysa-error'); if (!target) { target = el('p',null,modal.querySelector('section'),'ysa-error');target.setAttribute('role','alert'); } target.textContent = text; } }
function persist() {
  const targetScope = scope, data = JSON.stringify(sessions);
  const job = saving.catch(() => {}).then(() => storageFor(targetScope).setItem(KEY, data));
  saving = job; return job;
}
async function load() {
  const value = await storageFor(scope).getItem(KEY);
  sessions = value ? JSON.parse(value) : [];
  if (!Array.isArray(sessions)) throw Error('Agent 会话记录格式异常，请先导出备份，勿覆盖');
  let interrupted = false;
  for (const s of sessions) for (const m of s.messages || []) if (m.status === 'running') { m.status = 'interrupted'; interrupted = true; }
  if (interrupted) await persist();
}
function snapshot() {
  const target = route(); let result;
  window.dispatchEvent(new CustomEvent('yingce-agent-editor-request', {detail: {...target, action: 'snapshot', done: value => result = value}}));
  if (!result) throw Error('请先打开需要操作的章节');
  if (result.error) throw Error(result.error);
  return result;
}
function editorPlan(before, text, mode) {
  let result;
  window.dispatchEvent(new CustomEvent('yingce-agent-editor-request', {detail: {...before, action: 'plan', mode, text, selection: before.selection, done: v => result = v}}));
  if (!result || result.error) throw Error(result?.error || '章节编辑器未就绪');
  return result.content;
}
const plain = html => { const d = new DOMParser().parseFromString(html || '', 'text/html'); return d.body.textContent || ''; };
const escape = text => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=outputRichText;
async function projectData(projectId = route().projectId) {
  if (!projectId) throw Error('请先打开一个短剧项目');
  return api.get('/projects/' + enc(projectId));
}
async function refreshSkills() {
  skills = (await addedSkills()).skills || [];
  if (skillPicker) renderSkills();
}
function renderSkills() {
  skillPicker.replaceChildren();
  for (const s of skills) {
    const label = el('label', null, skillPicker, 'ysa-skill'); const check = el('input', null, label); check.type = 'checkbox'; check.checked = current()?.skillIds?.includes(s.skillId);
    el('span', s.skillName + (s.version ? ' · ' + s.version : ''), label); label.title = s.description || '';
    check.onchange = async () => { try { if (busy) { check.checked = !check.checked; return; } const ids = new Set(current().skillIds); check.checked ? ids.add(s.skillId) : ids.delete(s.skillId); if (ids.size > 4) { check.checked = false; throw Error('每次最多启用 4 个技能'); } current().skillIds = [...ids]; await persist(); renderChips(); } catch (e) { showError(e); } };
  }
  if (!skills.length) el('p', '还没有已添加的技能。可上传技能包，或在技能库中添加。', skillPicker);
  const missing = (current()?.skillIds || []).filter(id => !skills.some(s => s.skillId === id));
  if (missing.length) el('p', '部分已选技能已不可用，请移除后再发送。', skillPicker);
}
function renderModels() {
  if (!modelPicker) return;
  const cfg = configStore.getState().config;
  const selected = current()?.model || cfg.chapterTextModel || cfg.textModel || '';
  modelPicker.replaceChildren(); option(modelPicker, '', '选择文字模型');
  for (const value of cfg.textModels || []) option(modelPicker, value, value.includes('::') ? value.split('::').at(-1) : value);
  if (selected && ![...modelPicker.options].some(o => o.value === selected)) option(modelPicker, selected, selected);
  modelPicker.value = selected;
  nativeControls?.update();
}
function renderChips() {
  if (!chips) return; chips.replaceChildren();
  const s = current(); if (!s) return;
  for (const id of nativeControls ? [] : s.skillIds || []) button(chips, '技能：' + (skills.find(x => x.skillId === id)?.skillName || id) + ' ×', async () => { if (busy) return; s.skillIds = s.skillIds.filter(x => x !== id); await persist(); renderSkills(); renderChips(); }, 'ysa-chip');
  for(const r of s.references||[]){const chip=el('span',null,chips,'ysa-reference-chip');const preview=button(chip,'',()=>{const d=dialog('引用内容 · '+r.label);el('pre',r.text,d.body);},'ysa-reference-preview');preview.append(composerIcon('file'));el('span',r.label,preview);preview.setAttribute('aria-label','查看引用：'+r.label);const remove=button(chip,'',async()=>{if(busy)return;s.references=s.references.filter(x=>x.id!==r.id);await persist();renderChips();},'ysa-reference-remove');remove.append(composerIcon('close'));remove.setAttribute('aria-label','移除引用：'+r.label);remove.dataset.ysaTip='移除引用';remove.disabled=busy;}

}
function render() {
  if (!panel) return;
  sessionPicker.replaceChildren();
  const projectId = route().projectId;
  for (const s of [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) option(sessionPicker, s.id, (s.projectId === projectId && projectId ? '本项目 · ' : s.projectId ? '项目会话 · ' : '创作 · ') + s.title);
  sessionPicker.value = currentId;
  if(sessionTitle&&!editingTitle){sessionTitle.textContent=current()?.title||'新对话';sessionTitle.title='点击修改对话名称';}
  const preservedScroll=list.scrollTop,heights=new Map([...list.querySelectorAll(':scope > article')].map(c=>[c.dataset.messageId,c.getBoundingClientRect().height]));
  for(const view of messageViews.values())view.unmount();messageViews.clear();
  list.replaceChildren();
  const s = current();
  list.classList.toggle('ysa-empty',!s?.messages.length);
  if (!s?.messages.length) { el('h3', '和技能一起创作', list); el('p', '选择技能，引用章节、人物设定或之前的聊天，讨论满意后再写入章节。', list, 'ysa-muted'); }
  for (const m of s?.messages || []) {
    const card = el('article', null, list, 'ysa-message ysa-' + m.role);card.dataset.messageId=m.id;if(heights.get(m.id))card.style.minHeight=heights.get(m.id)+'px';
    const nativeHost=el('div',null,card,'ysa-native-message');
    let firstLayout=true;messageViews.set(m.id,mountNativeMessage(nativeHost,m,()=>send(m.replyTo,m.id),()=>{if(latestAnchor)positionLatest();else if(firstLayout)list.scrollTop=preservedScroll;firstLayout=false;card.style.minHeight='';}));
    if (m.role === 'assistant') {
      if (m.provenance) { const details = el('details', null, card); el('summary', '本轮技能与引用', details); el('pre', JSON.stringify(m.provenance, null, 2), details); }
      const actions = el('div', null, card, 'ysa-actions');
      button(actions, '复制', async () => { await navigator.clipboard.writeText(m.content); note('已复制'); });
      if (m.content) {button(actions, '保存到章节', () => showChapterSave({text:m.content,title:s.title,conversationId:s.id,messageId:m.id,provenance:m.provenance}));button(actions,'下载内容',()=>downloadOutput(m.content,s.title));}
      if (m.status !== 'running') button(actions, '重新生成', () => send(m.replyTo,m.id));

    }
  }
  renderSkills(); renderModels(); renderChips();
  panel.querySelector('[data-send]').disabled = busy; panel.querySelector('[data-stop]').disabled = !busy;
  panel.querySelector('[data-send]').hidden = busy;panel.querySelector('[data-stop]').hidden = !busy;
  input.disabled = busy; sessionPicker.disabled = busy; modelPicker.disabled = busy;
  composerBehavior?.refresh();
  if(latestAnchor)positionLatest();else list.scrollTop=preservedScroll;
}
async function createSession() {
  if (busy) throw Error('请先停止当前生成');
  const r = route(), s = newSession(scope, r.projectId, r.chapterId); sessions.push(s); currentId = s.id; await persist(); render(); note('新会话已保存');
}
function dialog(title) {
  if (modal) throw Error('请先关闭当前窗口');
  const d = el('dialog', null, workspaceRoot(), 'ysa-dialog'); modal = d;
  const head = el('header', null, d); el('strong', title, head); button(head, '关闭', () => close());
  const body = el('section', null, d, 'ysa-dialog-body'), footer = el('footer', null, d);
  const close = () => { if (writeBusy) return; d.close(); d.remove(); modal = null; };
  d.addEventListener('cancel', e => { e.preventDefault(); close(); }); d.showModal();
  return {body, footer, close};
}
async function reference(label, text, extra = {}) {
  if (busy) throw Error('生成中不能更改引用');
  if (!text.trim()) throw Error('引用内容为空');
  const s = current(); s.references.push({id: uid(), label, text, capturedAt: now(), ...extra}); await persist(); renderChips(); note('已加入引用：' + label);
}
async function openReferences() {
  if (busy) throw Error('请先停止生成');
  const d = dialog('添加参考内容');d.body.closest('dialog').classList.add('ysa-reference-dialog');el('p','选择需要带入本轮对话的内容，引用后可随时查看或移除。',d.body);const grid=el('div',null,d.body,'ysa-reference-grid');
  button(grid, '当前选中文字', async () => { if (!selection?.text || selection.route !== location.pathname) throw Error('请先在当前章节中选中文字'); await reference('章节选中文字', selection.text, {projectId: route().projectId, chapterId: route().chapterId}); d.close(); });
  button(grid, '当前章节', async () => { const snap = snapshot(); await reference('当前章节 · ' + snap.title, snap.field === 'sourceText' ? plain(snap.content) : snap.content, {projectId:snap.projectId, chapterId:snap.chapterId}); d.close(); });
  button(grid, '指定前后章节', async () => { const data = await projectData(); const units = data.units || []; const box = el('div', null, grid,'ysa-reference-chapters'); el('h4', '选择需要引用的章节', box); for (const u of units.filter(u => u.kind === 'chapter')) button(box, u.title, async () => { const r = await api.get('/projects/'+enc(route().projectId)+'/units/'+enc(u.id)); const unit = r.unit || r; await reference('章节 · ' + unit.title, plain(unit.sourceText) + (unit.screenplayText ? '\n【画面剧本】\n' + unit.screenplayText : ''), {projectId: route().projectId, chapterId:u.id}); d.close(); }); });
  button(grid, '人物、场景、道具设定', async () => { const data = await projectData(); const assets = data.assets || []; await reference('人物、场景、道具设定', JSON.stringify(assets.map(a => ({name:a.name || a.title,category:a.category,description:a.description,character:a.character,extraInfo:a.extraInfo})), null, 2)); d.close(); });
  button(grid, '项目大纲与设定', async () => { const data = await projectData(); const p = data.project || data; await reference('项目大纲与设定', JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => /name|description|outline|synopsis|setting|style|summary/i.test(k))), null, 2)); d.close(); });
  button(grid, '历史聊天记录', () => { d.close(); return openHistory(); });
  for(const card of grid.querySelectorAll(':scope > button')){const title=card.textContent;card.classList.add('ysa-reference-card');card.replaceChildren();el('span',({'当前选中文字':'⌁','当前章节':'▤','指定前后章节':'▥','人物、场景、道具设定':'♧','项目大纲与设定':'◇','历史聊天记录':'↶'})[title]||'▤',card,'ysa-reference-icon');const copy=el('span',null,card);el('strong',title,copy);el('small',({'当前选中文字':'使用编辑器中选中的片段','当前章节':'引用正在编辑的章节全文','指定前后章节':'选择章节，补充连续剧情','人物、场景、道具设定':'统一角色与场景信息','项目大纲与设定':'参考故事结构与创作方向','历史聊天记录':'从之前的讨论中选择消息'})[title],copy);}
  const label = el('label', null, d.body,'ysa-reference-upload');el('strong','＋ 添加本地资料',label);el('small','选择 TXT、Markdown、JSON 或 CSV 文件 · 最大 1 MB',label); const file = el('input', null, label); file.type = 'file'; file.accept = '.txt,.md,.json,.csv';
  file.onchange = async () => { try { const f = file.files[0]; if (!f) return; if (f.size > 1024 * 1024) throw Error('参考资料最大 1 MB'); await reference('资料 · ' + f.name, await f.text()); d.close(); } catch (e) { showError(e); } };
}
async function openHistory() {
  if (busy) throw Error('请先停止生成');
  const nativeRaw = await storageFor(scope).getItem('creation-conversations-v1');
  const creation = filterDeletedConversations(scope,nativeRaw ? (typeof nativeRaw === 'string' ? JSON.parse(nativeRaw) : nativeRaw) : []);
  const canvas = (canvasStore.getState().projects || []).flatMap(p => (p.chatSessions || []).map(s => ({...s,canvasId:p.id,title:'画布 · '+p.name+' · '+(s.title || '对话')})));
  const native = [...creation,...canvas];
  const d = dialog('历史会话');
  const historyDialog=d.body.closest('dialog');historyDialog.classList.add('ysa-history-dropdown');
  const anchor=panel?.querySelector('.ysa-header-actions [aria-label="历史会话"]')||sessionTitle;
  if(anchor){const r=anchor.getBoundingClientRect(),frame=panel.getBoundingClientRect(),width=Math.min(500,frame.width,window.innerWidth-32),top=Math.min(r.bottom+10,Math.max(16,window.innerHeight-320));historyDialog.style.setProperty('left',Math.max(16,Math.min(frame.right-width,window.innerWidth-width-16))+'px');historyDialog.style.setProperty('top',top+'px');historyDialog.style.setProperty('width',width+'px');historyDialog.style.setProperty('max-height',Math.max(220,window.innerHeight-top-20)+'px');}
  el('p','点击会话继续聊天 · 右侧图标选择引用消息',d.body,'ysa-history-hint');
  const search = el('input', null, d.body); search.placeholder = '搜索会话标题或内容'; search.setAttribute('aria-label', '搜索历史会话');
  const rows = el('div', null, d.body);
  const fill = () => {
    rows.replaceChildren();
    for (const entry of [...sessions.map(s => ({s, own:true})), ...native.map(s => ({s, own:false}))].filter(({s}) => (s.title + (s.messages || []).map(m => m.content).join(' ')).toLowerCase().includes(search.value.toLowerCase()))) {
      const {s, own} = entry, row = el('section', null, rows, 'ysa-history ysa-conversation-row');
      let opening=false;
      const resume=async()=>{if(opening)return;opening=true;try{if(own)currentId=s.id;else{const copy=importedSession(s,scope);copy.projectId=route().projectId;copy.chapterId=route().chapterId;sessions.push(copy);currentId=copy.id;await persist();}latestAnchor=current()?.messages.at(-1)?.id;render();d.close();}finally{opening=false;}};
      const line=el('div',null,row,'ysa-history-line');
      const title=button(line,(own?'Agent · ':'创作 · ')+(s.title||'未命名会话'),resume,'ysa-history-open');title.title=own?'点击继续会话':'点击导入并继续会话';
      const remove=button(line,'',async()=>{const store=storageFor(scope),trash=JSON.parse(await store.getItem('yingce-deleted-history-v1')||'[]');trash.push({entry:s,deletedAt:now(),own});await store.setItem('yingce-deleted-history-v1',JSON.stringify(trash));if(own){sessions=sessions.filter(v=>v.id!==s.id);if(currentId===s.id)currentId=sessions[0]?.id||'';await persist();if(!currentId)await createSession();else render();}else if(s.canvasId){canvasStore.setState(state=>({projects:state.projects.map(p=>p.id===s.canvasId?{...p,chatSessions:p.chatSessions.filter(v=>v.id!==s.id)}:p)}));const sync=await import('./user-data-sync-B6hrlYAn.js');sync.s();await sync.g(s.canvasId);}else await deleteCreationConversation(store,scope,s.id,creation.filter(v=>v.id!==s.id));const i=native.indexOf(s);if(i>=0)native.splice(i,1);fill();},'ysa-history-delete');remove.setAttribute('aria-label','删除会话');remove.dataset.ysaTip='删除会话';remove.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/></svg>';
      row.onclick=event=>{if(event.target.closest('button,input,label,.ysa-history-selection'))return;resume().catch(showError);};
      const quote=button(line,'',()=>{
        const previous=row.querySelector('.ysa-history-selection');if(previous){previous.remove();quote.setAttribute('aria-expanded','false');return;}
        quote.setAttribute('aria-expanded','true');
        const messages = usableMessages(s.messages || []), box = el('div', null, row, 'ysa-history-selection'), selected = new Set();
        if (!messages.length) { el('p', '此会话暂无可引用的完整文字消息', box); return; }
        const all = button(box, '全选', () => { for (const c of box.querySelectorAll('input')) { c.checked = true; selected.add(Number(c.value)); } });
        for (const [index, m] of messages.entries()) { const label = el('label', null, box, 'ysa-history-message'); const check = el('input', null, label); check.type = 'checkbox'; check.value = index; check.onchange = () => check.checked ? selected.add(index) : selected.delete(index); el('span', (m.role === 'user' ? '我：' : 'AI：') + m.content, label); }
        button(box, '加入当前对话', async () => { if (!selected.size) throw Error('请选择至少一条消息'); const chosen = [...selected].sort((a,b)=>a-b).map(i => messages[i]); await reference('历史会话 · ' + s.title + ' · ' + chosen.length + ' 条消息', chosen.map(m => (m.role === 'user' ? '用户：' : '助手：') + m.content).join('\n\n'), {originSessionId: s.id, messageIds: chosen.map(m => m.id)}); d.close(); });
      },'ysa-history-quote');
      quote.title='引用选定消息';quote.setAttribute('aria-label','引用选定消息');quote.setAttribute('aria-expanded','false');
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','17');svg.setAttribute('height','17');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('aria-hidden','true');
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M9 7H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-3M13 4h7v7M20 4 10 14');svg.append(path);quote.append(svg);
    }
    if (!rows.children.length) el('p', '没有匹配的聊天记录', rows);
  }; search.oninput = fill; fill();
}
async function send(replyTo,retryMessageId) {
  if (busy) return;
  const s = current(), original = replyTo && s.messages.find(m => m.id === replyTo);
  const prompt = original ? original.content : input.value.trim(); if (!prompt) return;
  const selectedModel = s.model || modelPicker.value; if (!selectedModel) throw Error('请选择一个已配置协议的文字模型');
  const selected = s.skillIds || []; if (selected.some(id => !skills.some(x => x.skillId === id))) throw Error('已选技能不可用，请重新选择技能');
  const past = original ? s.messages.slice(0, s.messages.indexOf(original)) : s.messages;
  const context = buildContext(s.references || [], past, prompt);
  // Load skill files before creating a model task. Missing dependencies must stop here.
  busy = true; render(); note('正在加载本轮技能…');
  let prepared;
  try { prepared = await skillRuntime.prepare({profile:'creation', prompt:context.prompt, skills, selectedSkillIds:selected}); }
  catch (e) { busy = false; render(); throw e; }
  const config = {...configStore.getState().config, model:selectedModel, textModel:selectedModel, taskWorkflowProvider:'model'};
  latestAnchor=null;
  const user = {id:uid(),role:'user',content:prompt,status:'succeeded',createdAt:now()};
  if (!original) s.messages.push(user);
  const answer = {id:uid(),role:'assistant',content:'',replyTo:original?.id || user.id,status:'running',createdAt:now(),model:selectedModel,provenance:{...prepared.metadata,references:(s.references || []).map(r => ({id:r.id,label:r.label,capturedAt:r.capturedAt}))}};
  if(retryMessageId)s.messages=s.messages.filter(m=>m.id!==retryMessageId||m.role!=='assistant');
  s.messages.push(answer); s.model = selectedModel; if (s.title === '新对话') s.title = prompt.slice(0, 28); s.updatedAt = now();
  busy = true; controller = new AbortController(); lastTask = null; let checkpoint;
  try {
    await persist(); input.value = ''; input.blur(); render(); note('已保存对话，正在调用模型…');
    const result = await generate({projectId:s.projectId || undefined,mode:'text',prompt:prepared.prompt,config,textHistory:context.history,signal:controller.signal,streamText:true,enableThinking:false,clientOperationId:answer.id,metadata:{source:'skill-agent',conversationId:s.id,messageId:answer.id,...prepared.metadata},onTaskUpdate: task => { lastTask = task; answer.taskId = task.id; },onTextDelta: text => { answer.content = text; messageViews.get(answer.id)?.update(answer); if (!checkpoint) checkpoint = setTimeout(()=>{checkpoint=null;persist().catch(showError);},1000); }});
    if (!result.text?.trim()) throw Error('模型没有返回正文'); answer.content = result.text; answer.status = 'succeeded'; note('生成完成，已保存到当前会话');
  } catch (e) { answer.status = controller.signal.aborted ? 'stopped' : 'failed'; answer.error = e.message; note(answer.status === 'stopped' ? '已停止，已收到的内容保留' : e.message); }
  finally { clearTimeout(checkpoint); s.updatedAt = now(); busy = false; controller = null; await persist(); render(); }
}
async function stop() {
  controller?.abort();
  if (lastTask?.id) { try { await api.post('/tasks/' + enc(lastTask.id) + '/cancel'); } catch { note('已停止接收；后台任务状态请在任务中心查看'); } }
}
async function openWrite(message, session) {
  if (busy) throw Error('请先等待生成完成');
  const d = dialog('预览写入章节');
  const mode = el('select', null, d.body); mode.setAttribute('aria-label','写入方式');
  for (const [v,t] of [['append','追加到章节末尾'],['insert','插入到光标位置'],['replace','替换选中文字'],['new','保存为新章节']]) option(mode,v,t);
  const targets = el('select', null, d.body); targets.setAttribute('aria-label','目标项目'); option(targets,'','选择目标项目');
  const projectList = await api.get('/projects', {params:{pageSize:100}});
  for (const p of projectList.projects || []) option(targets,p.id,p.name);
  targets.value = route().projectId || session.projectId || '';
  const title = el('input', null, d.body); title.placeholder = '新章节标题'; title.value = 'Agent 创作'; title.hidden = true;
  el('p','可删去讨论说明，只保留需要写入的正文。插入或替换使用打开预览时的章节选区。',d.body,'ysa-muted');
  const content = el('textarea', null, d.body); content.value = message.content; content.setAttribute('aria-label','待写入正文'); content.rows = 9;
  const preview = el('pre', '点击“生成预览”检查目标与最终正文', d.body); let plan;
  const invalidate = () => { plan = null; commit.disabled = true; preview.textContent = '内容已变化，请重新生成预览'; title.hidden = mode.value !== 'new'; targets.hidden = mode.value !== 'new'; };
  mode.onchange = content.oninput = targets.onchange = title.oninput = invalidate;
  button(d.footer,'生成预览', async () => {
    if (mode.value === 'new') { if (!targets.value || !title.value.trim()) throw Error('请选择项目并输入章节标题'); if (!content.value.trim()) throw Error('正文为空'); plan = {mode:'new',projectId:targets.value,title:title.value.trim(),content:html(content.value)}; preview.textContent = '新章节 · ' + plan.title + '\n\n' + content.value; }
    else { const before = snapshot(); const result = planWrite(before,content.value,mode.value,html); plan = {mode:mode.value,before,content:result === null ? editorPlan(before,content.value,mode.value) : result}; preview.textContent = '目标：' + before.title + '\n\n' + (before.field === 'sourceText' ? plain(plan.content) : plan.content); }
    commit.disabled = false;
  });
  const commit = button(d.footer,'确认写入', async () => {
    if (!plan || writeBusy) return; writeBusy = true; commit.disabled = true;
    try {
      const record = {id:uid(),messageId:message.id,at:now(),mode:plan.mode,projectId:plan.projectId || plan.before.projectId,status:'pending',provenance:message.provenance};
      if (plan.mode === 'new') { const res = await api.post('/projects/'+enc(plan.projectId)+'/units',{kind:'chapter',title:plan.title,sourceText:plan.content}); record.chapterId = (res.unit || res).id; record.after = plan.content; }
      else {
        assertUnchanged(plan.before,snapshot()); const b = plan.before, path = '/projects/'+enc(b.projectId)+'/units/'+enc(b.chapterId), res = await api.get(path), unit = res.unit || res;
        if ((unit[b.field] || '') !== b.persistedContent) throw Error('已保存的章节已变化，请重新预览');
        Object.assign(record,{chapterId:b.chapterId,field:b.field,before:b.persistedContent,after:plan.content});
        session.writes.push(record); await persist();
        await api.patch(path,{[b.field]:plan.content,...b.field === 'screenplayText' ? {expectedScreenplayText:b.persistedContent} : {}});
        const check = await api.get(path); if (((check.unit || check)[b.field] || '') !== plan.content) throw Error('保存回读不一致，请查看章节和写入记录');
        window.dispatchEvent(new CustomEvent('yingce-agent-editor-saved',{detail:{...b,content:plan.content}}));
      }
      record.status = 'succeeded'; if (!session.writes.includes(record)) session.writes.push(record); await persist(); note('已写入章节，可在“写入记录”中撤销'); writeBusy = false; d.close();
    } finally { writeBusy = false; if (commit.isConnected) commit.disabled = false; }
  },'ysa-primary'); commit.disabled = true; targets.hidden = true;
}
async function openWrites() {
  const d = dialog('章节写入记录');
  const outputKey='yingce-chapter-outputs-v1',outputs=JSON.parse(await storageFor(scope).getItem(outputKey)||'[]');
  const groups=[...sessions.map(s=>({writes:s.writes,save:persist})),{writes:outputs,save:()=>storageFor(scope).setItem(outputKey,JSON.stringify(outputs))}];
  for (const group of groups) for (const w of [...group.writes].reverse()) {
    const row = el('section',null,d.body,'ysa-history'); el('p',new Date(w.at||w.createdAt).toLocaleString('zh-CN')+' · '+w.mode+' · '+w.status,row);
    if (w.mode === 'new') { el('p','新章节已创建，可在项目章节列表中编辑。',row); continue; }
    if (w.status !== 'succeeded' || w.undone) continue;
    button(row,'预览撤销', async () => {
      const path = '/projects/'+enc(w.projectId)+'/units/'+enc(w.chapterId), res = await api.get(path), unit = res.unit || res;
      if ((unit[w.field] || '') !== w.after) throw Error('章节之后又有修改，无法覆盖撤销；原文可从本记录复制');
      el('pre', w.field === 'sourceText' ? plain(w.before) : w.before,row);
      button(row,'确认恢复原文',async () => {
        if (writeBusy) return; writeBusy = true;
        try { const check = await api.get(path); if (((check.unit || check)[w.field] || '') !== w.after) throw Error('正文已变化，无法撤销');
          if (route().projectId === w.projectId && route().chapterId === w.chapterId && snapshot().dirty) throw Error('请先保存当前手动修改');
          await api.patch(path,{[w.field]:w.before,...w.field === 'screenplayText' ? {expectedScreenplayText:w.after} : {}}); w.undone = now(); await group.save(); window.dispatchEvent(new CustomEvent('yingce-agent-editor-saved',{detail:{...w,content:w.before}})); note('已恢复写入前正文'); writeBusy = false; d.close();
        } finally { writeBusy = false; }
      });
    });
    button(row,'查看原文',() => el('pre',w.before,row));
  }
  if (!d.body.children.length) el('p','还没有章节写入记录',d.body);
}
async function uploadSkill() {
  if (busy) throw Error('请先停止生成');
  const picker = document.createElement('input'); picker.type = 'file'; picker.accept = '.zip';
  picker.onchange = async () => { try { const file = picker.files[0]; if (!file) return; note('正在上传技能包…'); const result = await installSkill({file,isPrivate:true}); const id = result.skill?.skillId || result.skillId || result.skill?.id; await refreshSkills(); if (id && !skills.some(s => s.skillId === id)) { await addSkill(id); await refreshSkills(); } if (id && skills.some(s => s.skillId === id)) { const ids = [...new Set([...current().skillIds,id])]; if (ids.length <= 4) current().skillIds = ids; await persist(); } render(); note('技能已上传。请在技能列表中选择后开始对话。'); } catch (e) { showError(e); } }; picker.click();
}
async function openAgent() {
  if (panel) { minimized=false;panel.hidden = !panel.hidden; if(!panel.hidden){panel.focus();latestAnchor=current()?.messages.at(-1)?.id;requestAnimationFrame(positionLatest);} syncAgentLauncher(); return; }
  if (userScope() !== scope) { scope = userScope(); await load(); }
  const r = route(); currentId = sessions.filter(s => s.projectId === r.projectId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]?.id || '';
  panel = el('aside',null,workspaceRoot(),'ysa-panel'); panel.tabIndex = -1; panel.setAttribute('aria-label','Agent 助手');
  const head = el('header',null,panel); const heading=el('div',null,head,'ysa-heading');el('strong','Agent 助手',heading);el('small','章节创作',heading);
  sessionPicker = el('select',null,head);sessionPicker.hidden=true;sessionPicker.setAttribute('aria-label','当前会话');sessionPicker.onchange = () => { currentId = sessionPicker.value; render(); };
  sessionTitle=button(head,'新对话',renameInline,'ysa-session-title');sessionTitle.setAttribute('aria-label','修改对话名称');
  const headerActions=el('div',null,head,'ysa-header-actions');
  iconButton(button(headerActions,'',()=>showChapterSave({text:conversationText(current()),title:current().title,conversationId:currentId})),'save','保存聊天');
  iconButton(button(headerActions,'',createSession),'new','新对话');iconButton(button(headerActions,'',openHistory),'history','历史会话');iconButton(button(headerActions,'',openMore),'more','更多');
  expandButton=button(headerActions,'',toggleExpanded);iconButton(expandButton,'expand','放大 Agent 助手');
  fullscreenButton=button(headerActions,'',toggleFullscreen);iconButton(fullscreenButton,'fullscreen','全屏');
  iconButton(button(headerActions,'',()=>{minimized=true;panel.hidden=true;syncAgentLauncher();}),'minimize','最小化');
  iconButton(button(headerActions,'',()=>{minimized=false;panel.hidden=true;syncAgentLauncher();}),'close','关闭 Agent 助手');
  floating=floatingAgent(panel,head,'yingce:agent-window:'+scope);

  list = el('div',null,panel,'ysa-messages'); list.setAttribute('aria-live','polite');list.addEventListener('wheel',()=>{latestAnchor=null;},{passive:true});list.addEventListener('pointerdown',()=>{latestAnchor=null;});
  const compose = el('div',null,panel,'ysa-compose'); chips = el('div',null,compose,'ysa-chips');
  input = el('textarea',null,compose); input.placeholder = '描述故事、修改要求，或接着之前的讨论…'; input.setAttribute('aria-label','Agent 对话输入'); input.rows = 3;
  input.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send().catch(showError); } };
  const tools = el('div',null,compose,'ysa-tools');
  modelPicker = el('select',null,tools); modelPicker.setAttribute('aria-label','Agent 文字模型'); modelPicker.onchange = async () => { current().model = modelPicker.value; await persist(); };
  const pickerHost=el('div',null,tools,'ysa-picker-host');composeButton(button(tools,'',openReferences,'ysa-reference-trigger'),'reference','参考内容');
  const details = el('details',null,compose); el('summary','选择技能',details); skillPicker = el('div',null,details,'ysa-skills');
  const actions = el('div',null,tools,'ysa-send-actions'); composeButton(button(actions,'',() => send(), 'ysa-primary'),'send','发送').dataset.send = ''; composeButton(button(actions,'',stop),'stop','停止').dataset.stop = '';
  status = el('div','',compose,'ysa-status'); status.setAttribute('role','status');status.hidden=true;
  if (!currentId) await createSession(); await refreshSkills();
  nativeControls=mountAgentControls(pickerHost,()=>({config:configStore.getState().config,model:current()?.model || modelPicker.value,skillIds:current()?.skillIds||[],sessionId:currentId,disabled:busy,onModelChange:value=>{if(busy)return;current().model=value;renderModels();persist().catch(showError);},onSkillsChange:ids=>{if(busy)return;current().skillIds=ids;persist().catch(showError);renderChips();}}));
  if(nativeControls){modelPicker.hidden=true;details.hidden=true;}
  composerBehavior=adaptiveComposer({panel,compose,input,list,isBusy:()=>busy});
  latestAnchor=current()?.messages.at(-1)?.id;render();toggleExpanded();
}
function openMore(){
  const d=dialog('会话操作');const menu=d.body.closest('dialog');menu.classList.add('ysa-more-dropdown');const anchor=panel.querySelector('[aria-label="更多"]');if(anchor){const r=anchor.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(r.right-240,innerWidth-248))+'px';menu.style.top=Math.min(r.bottom+8,Math.max(8,innerHeight-300))+'px';}
  button(d.body,'重命名',()=>{d.close();renameInline();});
  button(d.body,'写入记录',()=>{d.close();return openWrites();});
  button(d.body,'把最近回复写入当前选区',()=>{const message=[...current().messages].reverse().find(m=>m.role==='assistant'&&m.content);if(!message)throw Error('当前会话还没有可写入的回复');d.close();return openWrite(message,current());});
  button(d.body,'上传技能包',()=>{d.close();return uploadSkill();});
  button(d.body,'关联当前项目',async()=>{if(busy)throw Error('请先停止生成');Object.assign(current(),route());await persist();render();d.close();});
  button(d.body,'导出记录',()=>{const blob=new Blob([JSON.stringify(current(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=current().title+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
}
function renameInline(){
  if(editingTitle||!current())return;editingTitle=true;const session=current(),old=session.title,field=document.createElement('input');field.value=old;field.className='ysa-session-title-input';field.setAttribute('aria-label','对话名称');field.maxLength=120;sessionTitle.hidden=true;sessionTitle.after(field);
  let done=false;const finish=async(save)=>{if(done)return;done=true;try{if(save&&field.value.trim()){session.title=field.value.trim();session.updatedAt=now();await persist();}}catch(e){session.title=old;showError(e);}finally{field.remove();sessionTitle.hidden=false;editingTitle=false;render();}};
  field.onblur=()=>finish(true);field.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();finish(true);}else if(e.key==='Escape'){e.preventDefault();finish(false);}};field.focus();field.select();
}
function syncAgentLauncher(){const large=false;if(panel&&!backdrop){backdrop=el('div',null,workspaceRoot(),'ysa-agent-backdrop');backdrop.setAttribute('aria-hidden','true');}if(backdrop&&backdrop.hidden===large)backdrop.hidden=!large;const launch=document.getElementById('yingce-skill-agent-launch');if(!launch)return;const hide=!/^\/projects\/[^/]+\/chapters(?:\/|$)/.test(location.pathname)||!!(panel&&!panel.hidden&&(panel.classList.contains('ysa-expanded')||panel.classList.contains('ysa-fullscreen')));launch.hidden=hide;
  launch.classList.toggle('ysa-launch-minimized',minimized);if(launch.dataset.mode!==(minimized?'minimized':'normal')){if(minimized)iconButton(launch,'agent','恢复 Agent 助手');else{launch.replaceChildren();launch.textContent='✧ Agent 助手';launch.dataset.ysaTip='打开或关闭 Agent 助手';launch.setAttribute('aria-label','Agent 助手');}launch.dataset.mode=minimized?'minimized':'normal';}}
function toggleFullscreen(){if(!floating)return;const full=floating.setFullscreen(!floating.isFullscreen());iconButton(fullscreenButton,full?'restore':'fullscreen',full?'退出全屏':'全屏');fullscreenButton.setAttribute('aria-pressed',String(full));syncAgentLauncher();}

function toggleExpanded() {
  if(!panel)return;
  if(floating?.isFullscreen()){floating.setFullscreen(false);iconButton(fullscreenButton,'fullscreen','全屏');fullscreenButton.setAttribute('aria-pressed','false');}
  const expanded=panel.classList.toggle('ysa-expanded');
  floating?.setMode(expanded);
  iconButton(expandButton,expanded?'restore':'expand',(expanded?'还原':'放大')+' Agent 助手');expandButton.setAttribute('aria-pressed',String(expanded));syncAgentLauncher();
}
function navigate(path) { history.pushState({...history.state},'',path); window.dispatchEvent(new PopStateEvent('popstate',{state:history.state})); }
function mount() {
  if (!document.body) return;
  updateProjectSidebar();
  const applicable = /^\/projects\/[^/]+\/chapters(?:\/|$)/.test(location.pathname);
  document.body.classList.toggle('ysa-agent-chapter-route',applicable);
  if (!applicable && panel) panel.hidden = true;
  let launch = document.getElementById('yingce-skill-agent-launch');
  if (!launch && applicable) { launch = button(workspaceRoot(),'✧ Agent 助手',openAgent,'ysa-launch'); launch.id = 'yingce-skill-agent-launch'; }
  if(launch)syncAgentLauncher();
  document.getElementById('yingce-chapter-agent-button')?.remove();
  if (panel && openRoute !== location.pathname) { openRoute = location.pathname; if (!busy) { render(); note('当前目标：' + (route().chapterId ? '打开的章节' : route().projectId ? '当前项目' : '创作工作区') + '；聊天记录保留'); } }
}
document.addEventListener('click',event=>{const b=event.target.closest?.('.ysa-actions button');if(b){b.classList.add('ysa-clicked');setTimeout(()=>b.classList.remove('ysa-clicked'),500);}});
document.addEventListener('selectionchange',() => { const sel=window.getSelection(); const editor=document.querySelector('.project-chapter-editor'); if (sel?.rangeCount && editor?.contains(sel.anchorNode)) { try { selection={...snapshot(),text:sel.toString(),route:location.pathname}; } catch {} } });
document.addEventListener('select',event => { const area=event.target;if(!area.matches?.('.project-chapter-editor-scroll textarea'))return;try{selection={...snapshot(),text:area.value.slice(area.selectionStart,area.selectionEnd),route:location.pathname};}catch{} },true);
window.addEventListener('yingce-before-project-export',event=>event.detail.promises.push(saving));
window.addEventListener('yingce-project-history-imported',()=>{load().then(()=>{render();refreshSkills().catch(showError);}).catch(showError);});
window.addEventListener('canvas-skills-changed',() => refreshSkills().catch(showError));
configStore.subscribe(renderModels);
window.addEventListener('storage',event => { if (event.key === 'yingce:active-user-scope') location.reload(); });
const css = document.createElement('link'); css.rel='stylesheet';css.href=new URL('./skill-agent.css',import.meta.url).href;document.head.append(css);
await load();
startThemedSelects();agentTooltips();
new MutationObserver(() => { if (userScope() !== scope) { controller?.abort();composerBehavior?.destroy();composerBehavior=null; panel?.remove();panel=null;backdrop?.remove();backdrop=null;scope=userScope();load().catch(showError); } mount(); }).observe(document.body,{childList:true,subtree:true});
mount();
