import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {persistCreationConversations,filterDeletedConversations,deleteCreationConversation} from '../src/creation-history-storage.js';
test('deleted conversation cannot return through a stale background save; failures restore visibility',async()=>{
  const w=new Window();globalThis.localStorage=w.localStorage;
  let saved;const storage={getItem:async()=>JSON.stringify(saved||[]),setItem:async(k,v)=>{await new Promise(r=>setTimeout(r,5));saved=JSON.parse(v);}};
  const old=[{id:'a'},{id:'b'}];
  await persistCreationConversations(storage,'alice',old);
  await deleteCreationConversation(storage,'alice','a',[{id:'b'}]);
  await persistCreationConversations(storage,'alice',old);assert.deepEqual(saved,[{id:'b'}]);
  assert.deepEqual(filterDeletedConversations('bob',old),old);
  await assert.rejects(()=>deleteCreationConversation({getItem:async()=>null,setItem:async()=>{throw Error('磁盘写入失败');}},'alice','b',[]),/写入失败/);
  assert.deepEqual(filterDeletedConversations('alice',old),[{id:'b'}]);saved.push({id:'imported',importedFromBundle:'bundle'});await persistCreationConversations(storage,'alice',[{id:'b'}]);assert.equal(saved.some(v=>v.id==='imported'),true);await deleteCreationConversation(storage,'alice','imported',[{id:'b'}]);assert.equal(saved.some(v=>v.id==='imported'),false);w.happyDOM.abort();
});
