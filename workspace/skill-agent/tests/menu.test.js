import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {readFile} from 'node:fs/promises';
test('history actions stay attached to their row and act on the selected conversation',async()=>{
  const w=new Window({url:'http://localhost'});
  for(const key of ['window','document','navigator','HTMLElement','Event','MutationObserver'])Object.defineProperty(globalThis,key,{value:key==='window'?w:w[key],configurable:true});
  const vendor=await import('../../../../versions/1.3.18/web/dist/assets/vendor-react-DaNkUq-_.js'),React=vendor.Z();
  let source=await readFile(new URL('../src/creation-history-menu.js',import.meta.url),'utf8');source=source.replace(/^import .*;\r?\n/gm,'').replace('export function','function');
  const Menu=new Function('reactModule',source+';return CreationHistoryMenu;')(()=>React);
  const actions=[],host=document.body.appendChild(document.createElement('div')),root=vendor.W().createRoot(host);
  function Wrapper(){const[open,setOpen]=React.useState(false);return React.createElement(Menu,{conversation:{id:'correct',title:'当前对话'},open,onOpenChange:setOpen,onRename:c=>actions.push(['rename',c.id]),onExport:c=>actions.push(['export',c.id]),onDelete:c=>actions.push(['delete',c.id])});}
  const tick=()=>new Promise(r=>setTimeout(r,25));root.render(React.createElement(Wrapper));await tick();
  document.querySelector('[aria-haspopup="menu"]').click();await tick();
  assert.ok(document.querySelector('.creation-history-action-anchor>[role="menu"]'));
  [...document.querySelectorAll('[role="menuitem"]')].find(b=>b.textContent==='删除对话').click();await tick();
  assert.deepEqual(actions,[['delete','correct']]);assert.equal(document.querySelector('[role="menu"]'),null);
  root.unmount();w.happyDOM.abort();
});
