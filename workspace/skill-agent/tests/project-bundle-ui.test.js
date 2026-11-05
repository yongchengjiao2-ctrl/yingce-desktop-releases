import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {readFile} from 'node:fs/promises';
import {projectFrontend,projectIdFromCard} from '../src/project-bundle-core.js';

test('project cards export only their own project; import is a matching card and global launchers are absent',async()=>{
 const w=new Window({url:'http://localhost/projects'});for(const k of ['window','document','location','MutationObserver','CustomEvent','localStorage'])Object.defineProperty(globalThis,k,{value:k==='window'?w:w[k],configurable:true});
 document.body.innerHTML='<main class="project-library-page"><div class="project-library-grid"><a class="project-library-card" href="/projects/p/overview"><span class="project-library-cover"></span></a><a class="project-library-card" href="/projects/q/overview"><span class="project-library-cover"></span></a></div></main><button id="yingce-project-bundle-launch">old</button>';
 const records={'yingce-skill-agent-v1':[{id:'a',projectId:'p'},{id:'b',projectId:'q'}],'yingce-chapter-outputs-v1':[{projectId:'p',conversationId:'native'}],'creation-conversations-v1':[{id:'native'},{id:'unrelated'}]};const selected=projectFrontend(records,'p');assert.equal(selected['yingce-skill-agent-v1'].length,1);assert.deepEqual(selected['creation-conversations-v1'],[{id:'native'}]);assert.equal(records['creation-conversations-v1'].length,2);
 const calls=[];const services={api:{raw:async req=>{calls.push(req);return{status:200,data:{path:'p.zip',bytes:1024}};}},initRequest:()=>{},storageFor:()=>({getItem:async k=>JSON.stringify(records[k]||[])}),initStorage:()=>{},userScope:()=> 'alice',initScope:()=>{},canvasStore:{getState:()=>({projects:[]})},initCanvas:()=>{},flushCreationConversations:async()=>{},filterDeletedConversations:(_,v)=>v,projectFrontend,projectIdFromCard,testSync:{s:()=>{},g:async()=>{}}};
 let code=await readFile(new URL('../src/project-bundles.js',import.meta.url),'utf8');code=code.replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify('http://localhost/assets/project-bundles.js')).replace("await import('./user-data-sync-B6hrlYAn.js')",'testSync');new Function(...Object.keys(services),code)(...Object.values(services));
 const cards=document.querySelectorAll('.ysa-project-import-card');assert.equal(cards.length,1);assert.match(cards[0].textContent,/一键上传项目/);assert.equal(document.querySelector('#yingce-project-bundle-launch'),null);assert.equal(document.querySelectorAll('.ysa-project-export').length,2);
 const stale=document.createElement('div');stale.className='project-library-grid ysa-bundle-empty-grid';stale.innerHTML='<button class="ysa-project-import-card">加载时的旧卡片</button>';document.querySelector('main').append(stale);await new Promise(r=>setTimeout(r,15));assert.equal(document.querySelectorAll('.ysa-project-import-card').length,1);assert.equal(document.querySelector('.ysa-bundle-empty-grid'),null);
 let navigated=false;document.querySelector('a').addEventListener('click',()=>navigated=true);document.querySelector('.ysa-project-export').click();await new Promise(r=>setTimeout(r,30));assert.equal(navigated,false);assert.equal(calls[0].data.projectId,'p');assert.equal(calls[0].data.frontend['yingce-skill-agent-v1'][0].id,'a');
 w.history.pushState({},'', '/projects/p/overview');document.body.append(document.createElement('span'));await new Promise(r=>setTimeout(r,10));assert.equal(document.querySelector('.ysa-project-import-card'),null);w.happyDOM.abort();
});

test('chapter-only Agent entry and dropdowns explicitly avoid background blur',async()=>{
 const source=await readFile(new URL('../src/skill-agent.js',import.meta.url),'utf8');assert.ok(source.includes('const large=false'));assert.match(source,/const applicable = \/\^\\\/projects\\\/\[\^\/\]\+\\\/chapters/);
 const css=await readFile(new URL('../src/agent-window-states.css',import.meta.url),'utf8');assert.match(css,/\.ysa-agent-backdrop\{display:none!important/);assert.match(css,/ysa-history-dropdown::backdrop\{background:transparent!important;backdrop-filter:none!important/);
});
