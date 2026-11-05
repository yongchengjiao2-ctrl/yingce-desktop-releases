import {Z as reactModule,K as reactDOMModule} from './vendor-react-DaNkUq-_.js';
import {c as initSkills,f as listAddedSkills} from './skills-DHDdovXH.js';
import {n as initScope,t as userScope} from './user-scope-CMp2r8yk.js';
import {composerPaths} from './composer-icons.js';
const React=reactModule(), ReactDOM=reactDOMModule();
initSkills();initScope();
const h=React.createElement;
const skillIcon=()=>h('svg',{width:16,height:16,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:composerPaths.skill}));
const storageKey=id=>'yingce:creation-skills:'+userScope()+':'+(id||'draft');
export function selectedCreationSkills(id){try{const value=JSON.parse(localStorage.getItem(storageKey(id))||'[]');return Array.isArray(value)?value:[];}catch{return[];}}
function save(id,ids){localStorage.setItem(storageKey(id),JSON.stringify(ids));window.dispatchEvent(new Event('yingce:creation-skills-changed'));}
export async function mergeCreationSkills(id,references){
  const selected=selectedCreationSkills(id);if(!selected.length)return references;
  const all=(await listAddedSkills()).skills||[];
  if(selected.some(id=>!all.some(s=>s.skillId===id)))throw Error('已选技能已移除或不可用，请重新选择技能');
  const merged=[...references];
  for(const skillId of selected){const skill=all.find(s=>s.skillId===skillId);if(!merged.some(r=>r.skill?.skillId===skillId))merged.push({id:'skill:'+skillId,kind:'skill',label:skill.skillName,title:skill.skillName,text:skill.description,active:true,skill});}
  if(merged.filter(r=>r.skill).length>4)throw Error('本轮最多启用 4 个技能，请减少选择或 @ 引用');
  return merged;
}
export function CreationSkillPicker({conversationId,disabled=false,value,onChange}){
  const [open,setOpen]=React.useState(false),[skills,setSkills]=React.useState([]),[selected,setSelected]=React.useState(()=>selectedCreationSkills(conversationId)),[query,setQuery]=React.useState(''),[tab,setTab]=React.useState('all'),[error,setError]=React.useState(''),[position,setPosition]=React.useState(null),[hover,setHover]=React.useState(null);
  const trigger=React.useRef(null),popup=React.useRef(null);
  React.useEffect(()=>{setSelected(value || selectedCreationSkills(conversationId));setOpen(false);},[conversationId]);
  React.useEffect(()=>{if(value)setSelected(value);},[value]);
  React.useEffect(()=>{const update=()=>setSelected(selectedCreationSkills(conversationId));window.addEventListener('yingce:creation-skills-changed',update);return()=>window.removeEventListener('yingce:creation-skills-changed',update);},[conversationId]);
  React.useEffect(()=>{if(!open)return;let alive=true;const refresh=()=>listAddedSkills().then(data=>{if(alive)setSkills(data.skills||[]);}).catch(e=>{if(alive)setError(e.message);});refresh();window.addEventListener('canvas-skills-changed',refresh);return()=>{alive=false;window.removeEventListener('canvas-skills-changed',refresh);};},[open]);
  React.useEffect(()=>{if(!open)return;const close=e=>{if(!popup.current?.contains(e.target)&&!trigger.current?.contains(e.target)){setOpen(false);setHover(null);}};const key=e=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false);setHover(null);trigger.current?.focus();}};const reposition=()=>{setOpen(false);setHover(null);};document.addEventListener('pointerdown',close);document.addEventListener('keydown',key);window.addEventListener('resize',reposition);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',key);window.removeEventListener('resize',reposition);};},[open]);
  const toggle=()=>{if(open){setOpen(false);setHover(null);return;}const r=trigger.current.getBoundingClientRect(),width=Math.min(780,window.innerWidth-32);setPosition({left:Math.min(Math.max(16,r.left-260),window.innerWidth-width-16),bottom:window.innerHeight-r.top+10,width,maxHeight:Math.max(170,Math.min(430,r.top-24))});setError('');setOpen(true);};
  const choose=id=>{if(disabled)return;const ids=selected.includes(id)?selected.filter(s=>s!==id):[...selected,id];if(ids.length>4){setError('最多选择 4 个技能');return;}if(onChange)onChange(ids);else save(conversationId,ids);setSelected(ids);setError('');};
  const showIntro=(skill,target)=>{const r=target.getBoundingClientRect();setHover({skill,left:Math.min(Math.max(16,r.left),window.innerWidth-370),bottom:window.innerHeight-r.top+7});};
  const filtered=skills.filter(s=>(tab!=='selected'||selected.includes(s.skillId))&&((s.skillName||'')+' '+(s.description||'')).toLowerCase().includes(query.toLowerCase()));
  return h(React.Fragment,null,
    h('button',{ref:trigger,type:'button',className:'creation-chat-control creation-skill-trigger'+(selected.length?' is-active':''),disabled,onClick:toggle,'aria-haspopup':'dialog','aria-expanded':open,'aria-label':'选择技能','data-ysa-tip':selected.length?'已启用 '+selected.length+' 个技能':'选择技能'},skillIcon(),h('span',{className:'ysa-control-label'},selected.length?'技能 · '+selected.length:'选择技能')),
    open&&position?ReactDOM.createPortal(h('section',{ref:popup,role:'dialog','aria-label':'选择对话技能',className:'creation-skill-popup',style:position},
      h('nav',{'aria-label':'技能分类'},h('button',{type:'button',className:tab==='all'?'is-selected':'',onClick:()=>setTab('all')},h('strong',null,'已添加技能'),h('small',null,skills.length+' 个技能 · 我的技能库')),
        h('button',{type:'button',className:tab==='selected'?'is-selected':'',onClick:()=>setTab('selected')},h('strong',null,'本轮启用'),h('small',null,selected.length+' / 4 个技能')),
        h('a',{href:'/skills'},'管理 / 上传技能')),
      h('div',{className:'creation-skill-options'},h('input',{type:'search',placeholder:'搜索技能','aria-label':'搜索技能',value:query,onChange:e=>setQuery(e.target.value)}),
        h('div',{className:'creation-skill-rows'},...filtered.map(s=>h('button',{key:s.skillId,type:'button',role:'checkbox','aria-checked':selected.includes(s.skillId),disabled,className:'creation-skill-row'+(selected.includes(s.skillId)?' is-selected':''),onClick:()=>choose(s.skillId),onMouseEnter:e=>showIntro(s,e.currentTarget),onMouseLeave:()=>setHover(null),onFocus:e=>showIntro(s,e.currentTarget),onBlur:()=>setHover(null)},
          h('span',{className:'creation-skill-icon','aria-hidden':true},'▧'),h('span',{className:'creation-skill-label'},h('strong',null,s.skillName),h('small',null,s.version?'版本 '+s.version:'自定义技能')),h('span',{'aria-hidden':true},selected.includes(s.skillId)?'✓':''))),!filtered.length?h('p',{className:'creation-skill-empty'},'没有匹配的技能，可到技能库上传或添加。'):null),
        h('footer',null,error?h('span',{role:'alert'},error):h('span',null,'悬停查看简介 · 所选技能用于接下来的对话'),selected.length?h('button',{type:'button',onClick:()=>{if(onChange)onChange([]);else save(conversationId,[]);setSelected([]);}},'清除选择'):null)),
      hover?h('aside',{role:'tooltip',className:'creation-skill-intro',style:{left:hover.left,bottom:hover.bottom}},h('strong',null,hover.skill.skillName),h('p',null,hover.skill.description||'该技能暂未填写简介。')):null
    ),document.querySelector('.app-user-workspace')||document.body):null);
}
