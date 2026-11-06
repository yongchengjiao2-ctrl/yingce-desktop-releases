// Expands upward without resizing the conversation's scroll viewport.
export function adaptiveComposer({panel,compose,input,list,isBusy}){
  let hovered=false,timer,disposed=false;
  compose.classList.add('ysa-adaptive-composer');panel.classList.add('ysa-has-adaptive-composer');
  const popupOpen=()=>!!document.querySelector('.creation-skill-popup,.ysa-select-popup,.ant-popover:not(.ant-popover-hidden),dialog[open]');
  const reserveSpace=()=>{const top=list.scrollTop;list.style.setProperty('--ysa-composer-clearance',Math.max(76,compose.getBoundingClientRect().height+32)+'px');list.scrollTop=top;};
  const refresh=()=>{if(disposed)return;const busy=isBusy(),focused=!busy&&compose.contains(document.activeElement),expanded=hovered||focused||!!input.value.trim()||popupOpen();compose.classList.toggle('ysa-composer-expanded',expanded);compose.dataset.busy=String(busy);compose.dataset.expanded=String(expanded);input.setAttribute('aria-expanded',String(expanded));input.placeholder=expanded?'描述故事、修改要求，或者接着之前的讨论…':busy?'正在回复，可随时停止…':'继续讨论你的故事…';reserveSpace();};
  const later=()=>{clearTimeout(timer);timer=setTimeout(refresh,180);};
  const enter=()=>{hovered=true;clearTimeout(timer);refresh();};const leave=()=>{hovered=false;later();};
  compose.addEventListener('pointerenter',enter);compose.addEventListener('pointerleave',leave);compose.addEventListener('focusin',refresh);compose.addEventListener('focusout',later);input.addEventListener('input',refresh);
  const focusOutside=()=>{if(!compose.contains(document.activeElement))later();};document.addEventListener('focusin',focusOutside);
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(reserveSpace):null;observer?.observe(compose);
  let hadPopup=popupOpen();const popups=new MutationObserver(()=>{const present=popupOpen();if(present!==hadPopup){hadPopup=present;later();}});popups.observe(document.body,{childList:true,subtree:true});
  refresh();return{refresh,destroy(){disposed=true;clearTimeout(timer);observer?.disconnect();popups.disconnect();compose.removeEventListener('pointerenter',enter);compose.removeEventListener('pointerleave',leave);compose.removeEventListener('focusin',refresh);compose.removeEventListener('focusout',later);input.removeEventListener('input',refresh);document.removeEventListener('focusin',focusOutside);}};
}
