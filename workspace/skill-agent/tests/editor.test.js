import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {Transform} from 'prosemirror-transform';
import {readFile} from 'node:fs/promises';

test('real chapter schema: multi-line replacement previews valid HTML without dispatching a change',async()=>{
  const w=new Window({url:'http://localhost'});
  for(const key of ['window','document','navigator','DOMParser','Node','Element','HTMLElement','MutationObserver','getComputedStyle'])Object.defineProperty(globalThis,key,{value:key==='window'?w:w[key],configurable:true});
  const tiptap=await import('../../../../versions/1.3.18/web/dist/assets/dist-DFPNVekV.js');tiptap.r();
  const extensions=[tiptap.n],schema=tiptap._(extensions);
  const doc=schema.nodeFromJSON(tiptap.m('<p>原始正文</p>',extensions));
  let changed=false;
  const editor={state:{schema,selection:{from:1,to:3},get tr(){return new Transform(doc);}},extensionManager:{extensions},getHTML:()=>'<p>原始正文</p>',commands:{setContent:()=>changed=true}};
  let source=await readFile(new URL('../src/chapter-agent-bridge.js',import.meta.url),'utf8');source=source.replace(/^import .*;\r?\n/m,'').replace('export function','function');
  const connect=new Function('generateHTML','initTiptap',source+';return connectChapterAgent;')(tiptap.p,()=>{});
  const cleanup=connect({editor,unit:{id:'c',title:'章节',sourceText:'<p>原始正文</p>'},projectId:'p',dirty:false,screenplay:'',setSource:()=>changed=true,setScreenplay:()=>{},clean:()=>{},invalidate:()=>{}});
  let snap,result;w.dispatchEvent(new w.CustomEvent('yingce-agent-editor-request',{detail:{projectId:'p',chapterId:'c',action:'snapshot',done:x=>snap=x}}));
  w.dispatchEvent(new w.CustomEvent('yingce-agent-editor-request',{detail:{...snap,action:'plan',mode:'replace',text:'第一段\n第二段',done:x=>result=x}}));
  assert.equal(result.error,undefined);assert.match(result.content,/第一段/);assert.match(result.content,/第二段/);assert.match(result.content,/正文/);assert.equal(changed,false);
  assert.doesNotThrow(()=>schema.nodeFromJSON(tiptap.m(result.content,extensions)).check());
  cleanup();w.happyDOM.abort();
});
