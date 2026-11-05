import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildContext,planWrite,assertUnchanged,importedSession} from '../src/skill-agent-core.js';
test('only complete messages go into model history; partial failures remain outside it',()=>{
  const result=buildContext([{label:'会话1',text:'已确定的角色设定'}],[{role:'user',content:'要求'},{role:'assistant',content:'失败的半句话',status:'failed'},{role:'assistant',content:'已完成回复',status:'succeeded'}],'继续');
  assert.equal(result.history.length,2);assert.match(result.prompt,/已确定的角色设定/);assert.equal(result.history[1].content,'已完成回复');
});
test('oversized context is rejected rather than silently dropping old messages',()=>assert.throws(()=>buildContext([], [{role:'user',content:'0123456789'}],'继续',5),/上下文过长/));
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
