import{test}from'node:test';import assert from'node:assert/strict';import{Window}from'happy-dom';import{adaptiveComposer}from'../src/adaptive-composer.js';
test('composer collapses when idle and expands on hover, focus, draft, generation and open pickers without moving the reader',async()=>{
  const w=new Window({url:'http://localhost'});for(const k of ['window','document','MutationObserver'])Object.defineProperty(globalThis,k,{value:k==='window'?w:w[k],configurable:true});
  const panel=document.createElement('aside'),compose=document.createElement('div'),input=document.createElement('textarea'),list=document.createElement('div');compose.append(input);panel.append(list,compose);document.body.append(panel);list.scrollTop=140;let busy=false;
  const behavior=adaptiveComposer({panel,compose,input,list,isBusy:()=>busy}),expanded=()=>compose.dataset.expanded==='true';assert.equal(expanded(),false);assert.equal(list.scrollTop,140);
  compose.dispatchEvent(new w.Event('pointerenter'));assert.equal(expanded(),true);compose.dispatchEvent(new w.Event('pointerleave'));await new Promise(r=>setTimeout(r,210));assert.equal(expanded(),false);
  input.focus();assert.equal(expanded(),true);input.value='继续创作';input.blur();behavior.refresh();assert.equal(expanded(),true);input.value='';behavior.refresh();assert.equal(expanded(),false);
  busy=true;behavior.refresh();assert.equal(expanded(),true);busy=false;behavior.refresh();assert.equal(expanded(),false);
  const popup=document.createElement('div');popup.className='creation-skill-popup';document.body.append(popup);behavior.refresh();assert.equal(expanded(),true);popup.remove();behavior.refresh();assert.equal(expanded(),false);assert.equal(list.scrollTop,140);
  behavior.destroy();w.happyDOM.abort();
});
