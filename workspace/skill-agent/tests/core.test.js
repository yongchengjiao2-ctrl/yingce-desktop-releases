import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildContext,planWrite,assertUnchanged,importedSession} from '../src/skill-agent-core.js';
test('only complete messages go into model history; partial failures remain outside it',()=>{
  const result=buildContext([{label:'会话1',text:'已确定的角色设定'}],[{role:'user',content:'要求'},{role:'assistant',content:'失败的半句话',status:'failed'},{role:'assistant',content:'已完成回复',status:'succeeded'}],'继续');
  assert.equal(result.history.length,2);assert.match(result.prompt,/已确定的角色设定/);assert.equal(result.history[1].content,'已完成回复');
});
test('oversized current input is rejected without silently truncating it',()=>assert.throws(()=>buildContext([], [{role:'user',content:'0123456789'}],'继续',5),/本轮要求与引用资料/));

test('long accumulated conversations keep recent complete turns and disclose omitted turns without changing stored history',()=>{
  const messages=Array.from({length:3},(_,i)=>[{id:'u'+i,role:'user',content:'问题'+i},{id:'a'+i,role:'assistant',content:String(i).repeat(40000),status:'succeeded'}]).flat();
  const before=JSON.stringify(messages);
  const result=buildContext([{label:'原稿',text:'必须保留的设定'}],messages,'修改最后一段');
  assert.equal(result.omittedTurns,1);assert.equal(result.includedTurns,2);
  assert.equal(result.history[0].role,'system');assert.match(result.history[0].content,/不是历史摘要/);
  assert.deepEqual(result.history.slice(1).map(m=>m.role),['user','assistant','user','assistant']);
  assert.equal(result.history.at(-1).content,messages.at(-1).content);
  assert.match(result.prompt,/必须保留的设定/);assert.match(result.prompt,/修改最后一段/);
  assert.ok(result.prompt.length+result.history.reduce((n,m)=>n+m.content.length,0)<=90000);
  assert.equal(JSON.stringify(messages),before);
});

test('an oversized most recent turn is not silently omitted',()=>{
  assert.throws(()=>buildContext([],[{role:'user',content:'修改'},{role:'assistant',content:'正文'.repeat(3000),status:'succeeded'}],'继续',3000),/最近一轮对话/);
});
test('write previews preserve original content and enforce dirty and selection guards',()=>{
  const s={projectId:'p',chapterId:'c',field:'screenplayText',content:'第一场\n第二场',dirty:false,selection:{from:4,to:7}};
  assert.equal(planWrite(s,'新段落','append',x=>x),'第一场\n第二场\n\n新段落');
  assert.equal(planWrite(s,'替换','replace',x=>x),'第一场\n替换');
  assert.throws(()=>planWrite({...s,dirty:true},'替换','append',x=>x),/先保存/);
  assert.throws(()=>planWrite({...s,selection:null},'替换','replace',x=>x),/选择位置/);
});
test('switching chapter and editing after preview both block writing',()=>{
  const s={projectId:'p',chapterId:'c',field:'sourceText',content:'原文',dirty:false};
  assert.doesNotThrow(()=>assertUnchanged(s,{...s}));
  assert.throws(()=>assertUnchanged(s,{...s,chapterId:'other'}),/已变化/);
  assert.throws(()=>assertUnchanged(s,{...s,content:'修改后的正文'}),/已变化/);
});
test('importing native conversations does not mutate their history',()=>{
  const original={id:'native',title:'旧聊天',messages:[{role:'user',content:'你好'},{role:'assistant',content:'原回复',status:'done'}]};
  const copy=importedSession(original,'test'); copy.messages[0].content='变更';
  assert.equal(original.messages[0].content,'你好');assert.equal(copy.originId,'native');assert.equal(copy.messages.length,2);
});
