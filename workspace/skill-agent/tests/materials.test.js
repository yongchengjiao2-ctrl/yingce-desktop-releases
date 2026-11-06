import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviseMaterial,materialStore,projectContext,MATERIAL_KEY} from '../src/confirmed-materials.js';
import {projectFrontend} from '../src/project-bundle-core.js';
test('confirmed materials are project scoped, versioned and reject stale edits',()=>{
  const first=reviseMaterial([],{type:'character',title:'女主',content:'已确认的人物基础'},'p');
  const second=reviseMaterial(first.records,{...first.item,content:'修改后的人物基础'},'p');
  assert.equal(second.item.revision,2);assert.equal(second.item.revisions[0].content,'已确认的人物基础');
  assert.throws(()=>reviseMaterial(second.records,{...first.item,content:'过期修改'},'p'),/已被修改/);
  assert.throws(()=>reviseMaterial(second.records,{...second.item},'other'),/不存在/);
  assert.throws(()=>reviseMaterial([],{type:'setting',title:'',content:'abc'},'p'),/请填写/);
});
test('requests contain confirmed records, explicit references and only the latest optional working draft',()=>{
  const records=[{id:'a',projectId:'p',type:'setting',title:'正式设定',content:'正式内容',enabled:true,revision:1},{id:'b',projectId:'other',title:'外部',content:'其他项目资料',enabled:true},{id:'c',projectId:'p',title:'关闭',content:'禁用资料',enabled:false}];
  const messages=[{role:'assistant',status:'succeeded',content:'旧的废弃方案'},{id:'latest',role:'assistant',status:'succeeded',content:'最近工作稿'},{role:'assistant',status:'failed',content:'失败半段'}];
  const result=projectContext(records,'p',[{label:'关联章节',text:'关联原文'}],messages,'修改镜头');
  assert.equal(result.history.length,0);assert.equal(result.workingDraftId,'latest');
  for(const text of ['正式内容','关联原文','最近工作稿','修改镜头'])assert.ok(result.prompt.includes(text));
  for(const text of ['其他项目资料','禁用资料','旧的废弃方案','失败半段'])assert.ok(!result.prompt.includes(text));
  assert.equal(result.materials.length,1);
  assert.ok(!projectContext(records,'p',[],messages,'写下一集',false).prompt.includes('最近工作稿'));
  assert.equal(projectFrontend({[MATERIAL_KEY]:records},'p')[MATERIAL_KEY].length,2);
});
test('storage errors propagate and concurrent local writes preserve records',async()=>{
  let saved='[]';const store=materialStore({getItem:async()=>saved,setItem:async(k,v)=>{saved=v;}},'u');
  await Promise.all(['A','B'].map(title=>store.save({type:'outline',title,content:'纲要'},'p')));
  assert.equal((await store.list()).length,2);
  const broken=materialStore({getItem:async()=>'{broken'},'u');await assert.rejects(broken.list());
  const failing=materialStore({getItem:async()=>'[]',setItem:async()=>{throw Error('磁盘写入失败');}},'u');
  await assert.rejects(failing.save({type:'rule',title:'规则',content:'规则内容'},'p'),/磁盘写入失败/);
});
