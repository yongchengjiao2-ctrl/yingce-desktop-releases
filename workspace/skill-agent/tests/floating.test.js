import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {constrainFrame,floatingAgent,iconButton} from '../src/floating-agent.js';
import {projectSidebar} from '../src/project-sidebar.js';
test('floating Agent moves in both modes, stays on screen and keeps header actions as icons',()=>{
  const w=new Window({url:'http://localhost/projects/p/chapters/c'});for(const k of ['window','document','localStorage','location'])Object.defineProperty(globalThis,k,{value:k==='window'?w:w[k],configurable:true});
  const panel=document.createElement('aside'),head=document.createElement('header');panel.append(head);document.body.append(panel);
  const frame=floatingAgent(panel,head,'test-window');frame.setMode(true);const left=Number.parseFloat(panel.style.left),top=Number.parseFloat(panel.style.top),width=Number.parseFloat(panel.style.width),height=Number.parseFloat(panel.style.height);
  panel.getBoundingClientRect=()=>({left,top,width,height});
  head.onpointerdown({button:0,target:head,pointerId:1,clientX:100,clientY:100,preventDefault(){}});head.onpointermove({pointerId:1,clientX:120,clientY:120});head.onpointerup({pointerId:1});assert.ok(Number.parseFloat(panel.style.top)>=top);assert.ok(JSON.parse(localStorage.getItem('test-window')).expanded);
  frame.setMode(false);assert.ok(Number.parseFloat(panel.style.width)<=480);const b=document.createElement('button');iconButton(b,'save','保存聊天');assert.equal(b.textContent,'');assert.equal(b.getAttribute('aria-label'),'保存聊天');assert.ok(b.querySelector('svg'));
  assert.deepEqual(constrainFrame({left:-100,top:10000,width:9000,height:9000},{width:800,height:600}),{left:8,top:8,width:784,height:584});w.happyDOM.abort();
});
test('invalid saved bounds recover and tiny viewport resizing cannot corrupt saved dimensions',()=>{
  const w=new Window({url:'http://localhost'});for(const k of ['window','document','localStorage'])Object.defineProperty(globalThis,k,{value:k==='window'?w:w[k],configurable:true});
  localStorage.setItem('bad-window',JSON.stringify({expanded:{left:8,top:8,width:144,height:1}}));
  const panel=document.createElement('aside'),head=document.createElement('header');panel.append(head);document.body.append(panel);
  const behavior=floatingAgent(panel,head,'bad-window');behavior.setMode(true);
  assert.ok(parseFloat(panel.style.width)>=360);assert.ok(parseFloat(panel.style.height)>=280);
  const good=localStorage.getItem('bad-window');
  Object.defineProperty(w,'innerWidth',{value:144,configurable:true});Object.defineProperty(w,'innerHeight',{value:1,configurable:true});
  w.dispatchEvent(new w.Event('resize'));assert.equal(localStorage.getItem('bad-window'),good);
  Object.defineProperty(w,'innerWidth',{value:1600,configurable:true});Object.defineProperty(w,'innerHeight',{value:1000,configurable:true});
  behavior.setMode(true);assert.ok(parseFloat(panel.style.height)>=280);
  assert.ok(Object.values(constrainFrame({width:null,height:NaN,left:NaN,top:undefined},{width:800,height:600})).every(Number.isFinite));
  w.happyDOM.abort();
});

test('project entry collapses the main sidebar once without overriding later manual expansion',()=>{
  const w=new Window({url:'http://localhost/projects/p/overview'});for(const k of ['window','document','location'])Object.defineProperty(globalThis,k,{value:k==='window'?w:w[k],configurable:true});
  const sidebar=document.createElement('aside');sidebar.className='app-workspace-sidebar';const b=document.createElement('button');b.className='app-workspace-sidebar-collapse-toggle';let clicks=0;b.onclick=()=>clicks++;sidebar.append(b);document.body.append(sidebar);
  const update=projectSidebar();update();update();assert.equal(clicks,1);w.history.pushState({},'','/');update();w.history.pushState({},'','/projects/p/chapters');update();assert.equal(clicks,2);w.happyDOM.abort();
});
