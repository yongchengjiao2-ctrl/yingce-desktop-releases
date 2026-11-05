export function projectSidebar(){
  let entered='';
  return function update(){
    const match=/^\/projects\/([^/]+)/.exec(location.pathname),id=match?.[1]||'';
    if(!id){entered='';return;}if(entered===id)return;
    const sidebar=document.querySelector('.app-workspace-sidebar');if(!sidebar)return;
    if(sidebar.classList.contains('is-collapsed')){entered=id;return;}
    const collapse=sidebar.querySelector('.app-workspace-sidebar-collapse-toggle:not(.is-collapsed)');
    if(collapse){entered=id;collapse.click();}
  };
}
