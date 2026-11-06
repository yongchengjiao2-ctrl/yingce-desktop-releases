import {test} from 'node:test';import assert from 'node:assert/strict';import {Window} from 'happy-dom';
import {reconcileMessages} from '../src/agent-message-list.js';
test('streaming, completion and unrelated rendering keep existing message DOM mounted',()=>{
  const w=new Window(),list=w.document.createElement('div'),views=new Map();let mounts=0,unmounts=0;
  const create=m=>{mounts++;const card=w.document.createElement('article');return{card,update:v=>card.textContent=v.content,unmount:()=>unmounts++};};
  let messages=[{id:'u',content:'问题'},{id:'a',content:'',status:'running'}];
  reconcileMessages(list,views,messages,create);const original=list.children[1];list.scrollTop=80;
  for(const content of ['第一','第一段','第一段正文']){messages[1]={...messages[1],content};reconcileMessages(list,views,messages,create);}
  messages[1].status='succeeded';reconcileMessages(list,views,messages,create);
  assert.equal(list.children[1],original);assert.equal(mounts,2);assert.equal(unmounts,0);assert.equal(list.scrollTop,80);
  reconcileMessages(list,views,[messages[0],{id:'retry',content:'重试'}],create);assert.equal(unmounts,1);assert.equal(views.has('a'),false);assert.equal(views.size,2);
  w.happyDOM.abort();
});
