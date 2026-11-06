import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/agent-native-message.js',import.meta.url),'utf8');
const begin=source.indexOf('export function nativeMessageItem');
const end=source.indexOf('export function mountNativeMessage');
const item=new Function(source.slice(begin,end).replace('export ','')+';return nativeMessageItem;')();
test('terminal empty replies have terminal text, active replies keep the loading placeholder',()=>{
  for(const status of ['stopped','interrupted','cancelled']){
    assert.equal(item({status,content:''}).status,'cancelled');
    assert.equal(item({status,content:''}).content,'已停止，尚未收到正文');
  }
  assert.equal(item({status:'failed',content:''}).content,'生成失败，未返回正文');
  assert.equal(item({status:'succeeded',content:''}).content,'未返回正文');
  assert.equal(item({status:'running',content:''}).content,'');
  assert.equal(item({status:'stopped',content:'已收到的文字'}).content,'已收到的文字');
});
