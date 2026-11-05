import {Z as reactModule} from './vendor-react-DaNkUq-_.js';
const React=reactModule(),h=React.createElement;
export function CreationHistoryMenu({conversation,open,onOpenChange,onRename,onExport,onDelete}){
  const host=React.useRef(null),trigger=React.useRef(null),[above,setAbove]=React.useState(false);
  React.useEffect(()=>{if(!open)return;const outside=e=>{if(!host.current?.contains(e.target))onOpenChange(false);};const key=e=>{if(e.key==='Escape'){e.stopPropagation();onOpenChange(false);trigger.current?.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);};},[open,onOpenChange]);
  const toggle=e=>{e.stopPropagation();const r=trigger.current.getBoundingClientRect(),boundary=host.current.closest('.creation-history-content')?.getBoundingClientRect();setAbove(r.bottom+145>Math.min(window.innerHeight-12,boundary?.bottom||window.innerHeight));onOpenChange(!open);};
  const action=(fn)=>e=>{e.preventDefault();e.stopPropagation();onOpenChange(false);fn(conversation);};
  return h('span',{ref:host,className:'creation-history-action-anchor'},
    h('button',{ref:trigger,type:'button',className:'creation-history-more'+(open?' is-open':''),'aria-label':'对话操作 '+(conversation.title||'新创作'),'aria-haspopup':'menu','aria-expanded':open,onClick:toggle},'···'),
    open?h('span',{role:'menu','aria-label':'对话操作',className:'creation-history-inline-menu'+(above?' is-above':'')},h('button',{type:'button',role:'menuitem',onClick:action(onRename)},'重命名'),h('button',{type:'button',role:'menuitem',onClick:action(onExport)},'导出对话'),h('button',{type:'button',role:'menuitem',className:'is-danger',onClick:action(onDelete)},'删除对话')):null);
}
