export function constrainFrame(frame,viewport){
  const margin=8,width=Math.max(1,Math.min(frame.width,viewport.width-margin*2)),height=Math.max(1,Math.min(frame.height,viewport.height-margin*2));
  return {left:Math.max(margin,Math.min(frame.left,viewport.width-width-margin)),top:Math.max(margin,Math.min(frame.top,viewport.height-height-margin)),width,height};
}
export function floatingAgent(panel,header,key){
  let frames={},mode='compact',drag,fullscreen=false;
  try{frames=JSON.parse(localStorage.getItem(key)||'{}');}catch{}
  const viewport=()=>({width:window.innerWidth,height:window.innerHeight});
  const read=()=>{const r=panel.getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height};};
  const apply=value=>{const f=constrainFrame(value,viewport());for(const [k,v] of Object.entries(f))panel.style.setProperty(k,v+'px','important');panel.style.setProperty('right','auto','important');panel.style.setProperty('bottom','auto','important');frames[mode]=f;return f;};
  const save=()=>{try{localStorage.setItem(key,JSON.stringify(frames));}catch{}};
  const setMode=expanded=>{mode=expanded?'expanded':'compact';const v=viewport(),width=expanded?Math.min(1320,v.width-64):Math.min(480,v.width-32),height=expanded?Math.min(880,v.height-64):Math.min(740,v.height-128);apply(frames[mode]||{left:(v.width-width)/2,top:(v.height-height)/2,width,height});save();};
  const fillScreen=()=>{for(const [k,v]of Object.entries({left:0,top:0,width:window.innerWidth,height:window.innerHeight}))panel.style.setProperty(k,v+'px','important');panel.style.setProperty('right','auto','important');panel.style.setProperty('bottom','auto','important');};
  const setFullscreen=value=>{fullscreen=!!value;panel.classList.toggle('ysa-fullscreen',fullscreen);if(fullscreen)fillScreen();else setMode(mode==='expanded');return fullscreen;};
  header.removeAttribute('title');header.dataset.ysaTip='拖动顶部空白处移动窗口';
  header.onpointerdown=e=>{if(fullscreen||e.button!==0||e.target.closest('button,input,select,a'))return;const f=read();drag={id:e.pointerId,x:e.clientX,y:e.clientY,frame:f};header.setPointerCapture?.(e.pointerId);panel.classList.add('ysa-dragging');e.preventDefault();};
  header.onpointermove=e=>{if(!drag||drag.id!==e.pointerId)return;apply({...drag.frame,left:drag.frame.left+e.clientX-drag.x,top:drag.frame.top+e.clientY-drag.y});};
  const end=e=>{if(!drag||drag.id!==e.pointerId)return;drag=null;header.releasePointerCapture?.(e.pointerId);panel.classList.remove('ysa-dragging');save();};header.onpointerup=end;header.onpointercancel=end;header.onlostpointercapture=()=>{drag=null;panel.classList.remove('ysa-dragging');};
  window.addEventListener('resize',()=>{if(panel.isConnected){if(fullscreen)fillScreen();else{apply(frames[mode]||read());save();}}});
  return{setMode,setFullscreen,isFullscreen:()=>fullscreen};
}
const paths={save:'M4 3h13l3 3v15H4z M8 3v6h8V3 M8 21v-8h8v8',new:'M12 5v14 M5 12h14',history:'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2',more:'M5 12h.01 M12 12h.01 M19 12h.01',expand:'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5',restore:'M8 8V3h13v13h-5 M3 8h13v13H3z',close:'M6 6l12 12 M18 6 6 18'};
export function iconButton(button,kind,label){
  button.replaceChildren();button.classList.add('ysa-icon-button');button.dataset.iconKind=kind;button.removeAttribute('title');button.dataset.ysaTip=label;button.setAttribute('aria-label',label);
  const extra={fullscreen:'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5 M8 8h8v8H8z',minimize:'M5 12h14',agent:'M8 5h8l3 3v10H5V8z M9 11h.01 M15 11h.01 M9 15h6 M12 2v3'};
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','17');svg.setAttribute('height','17');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',paths[kind]||extra[kind]||paths.more);svg.append(p);button.append(svg);
}
