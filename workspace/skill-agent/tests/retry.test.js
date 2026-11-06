import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/skill-agent.js',import.meta.url),'utf8');
const sendSource=source.slice(source.indexOf('async function send('),source.indexOf('async function stop('));
function fixture(failPrepare=false){
  const session={id:'s',title:'test',messages:[{id:'u',role:'user',content:'原提问'},{id:'failed',role:'assistant',replyTo:'u',status:'failed',content:''},{id:'other',role:'assistant',replyTo:'u',status:'succeeded',content:'保留的回复'}],model:'model',references:[]};
  let saved=[];
  const env={busy:false,current:()=>session,input:{value:'',blur(){}},modelPicker:{value:'model'},skills:[],buildContext:()=>({prompt:'原提问',history:[]}),render(){},note(){},skillRuntime:{prepare:async()=>{if(failPrepare)throw Error('技能不可用');return{prompt:'原提问',metadata:{}};}},configStore:{getState:()=>({config:{}})},latestAnchor:null,uid:()=> 'new',now:()=> 'now',controller:null,lastTask:null,persist:async()=>{saved.push(JSON.parse(JSON.stringify(session)));},messageViews:new Map(),generate:async()=>({text:'新回复'})};
  const send=new Function('env','with(env){return ('+sendSource+')}')(env);
  return {send,session,saved};
}
test('retry replaces only the selected assistant record and persists the replacement',async()=>{
  const f=fixture();await f.send('u','failed');
  assert.deepEqual(f.session.messages.map(m=>m.id),['u','other','new']);
  assert.equal(f.session.messages.at(-1).replyTo,'u');
  assert.equal(f.session.messages.at(-1).content,'新回复');
  assert.equal(f.saved.at(-1).messages.some(m=>m.id==='failed'),false);
});
test('preparation failure preserves the original failed record',async()=>{
  const f=fixture(true);await assert.rejects(f.send('u','failed'),/技能不可用/);
  assert.deepEqual(f.session.messages.map(m=>m.id),['u','failed','other']);
});
