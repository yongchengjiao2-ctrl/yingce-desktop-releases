import {test} from 'node:test';import assert from 'node:assert/strict';import {Window} from 'happy-dom';
import {referencePicker} from '../src/reference-picker.js';
test('chapter references multi-select with pressed state and apply once; deselection survives reopening',async()=>{
  const w=new Window();globalThis.document=w.document;const jobs=[];
  const el=(tag,text,parent,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;parent?.append(n);return n;};
  const button=(parent,text,fn)=>{const b=el('button',text,parent);b.onclick=()=>{const job=Promise.resolve(fn());jobs.push(job);return job;};return b;};
  const dialog=()=>{const node=el('dialog',null,document.body),body=el('section',null,node),footer=el('footer',null,node);return{body,footer,close:()=>node.remove()};};
  let refs=[],applies=0;
  const options={dialog,el,button,projectData:async()=>({units:[{id:'1',kind:'chapter',title:'第一集'},{id:'2',kind:'chapter',title:'第二集'}]}),readChapter:async id=>({unit:{title:'第'+id+'集',sourceText:'正文'+id}}),snapshot:()=>({chapterId:'1',projectId:'p',title:'第一集',sourceText:'正文1'}),getSelection:()=>null,route:()=>({chapterId:'1',projectId:'p',pathname:'/projects/p'}),plain:text=>text,onApply:async next=>{refs=next;applies++;},openHistory:()=>{}};
  const click=async text=>{[...document.querySelectorAll('button')].find(b=>b.textContent===text).click();await Promise.all(jobs);};
  await referencePicker({...options,references:refs});await click('选择章节');await click('第一集');await click('第二集');
  assert.equal(applies,0);assert.equal(document.querySelectorAll('.ysa-reference-chapters [aria-pressed=true]').length,2);
  await click('确认引用 · 2');assert.equal(applies,1);assert.equal(refs.length,2);
  await referencePicker({...options,references:refs});await click('选择章节');assert.equal(document.querySelectorAll('.ysa-reference-chapters [aria-pressed=true]').length,2);await click('第一集');await click('确认引用 · 1');assert.equal(refs[0].chapterId,'2');
  w.happyDOM.abort();
});
