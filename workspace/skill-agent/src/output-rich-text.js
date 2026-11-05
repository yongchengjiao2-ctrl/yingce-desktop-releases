import {Z as reactModule,t as reactServer} from './vendor-react-DaNkUq-_.js';
import {n as initMarkdown,t as Markdown} from './ai-message-markdown-DMCN6WQ7.js';
initMarkdown();const React=reactModule();
export function outputRichText(text){
  const markup=reactServer().renderToStaticMarkup(React.createElement(Markdown,{isStreaming:false,streamingAnimation:'none'},text));
  const parsed=new DOMParser().parseFromString(markup,'text/html'),out=document.createElement('div');
  const allowed=new Set(['p','h1','h2','h3','strong','em','s','u','ul','ol','li','blockquote','pre','code','hr','br','table','thead','tbody','tr','th','td','a']);
  function copy(node,parent){if(node.nodeType===3){parent.append(document.createTextNode(node.textContent));return;}if(node.nodeType!==1)return;
    let tag=node.tagName.toLowerCase();if(['script','style','button','input','svg'].includes(tag))return;
    const kind=node.getAttribute('data-streamdown');if(kind==='strong'||node.classList.contains('font-semibold'))tag='strong';if(kind==='em')tag='em';if(tag==='h4'||tag==='h5'||tag==='h6')tag='h3';
    const target=allowed.has(tag)?document.createElement(tag):parent;
    if(target!==parent){if(tag==='a'){const href=node.getAttribute('href')||'';if(/^(https?:|mailto:|#)/i.test(href))target.setAttribute('href',href);}if(tag==='ol'&&node.hasAttribute('start'))target.setAttribute('start',node.getAttribute('start'));parent.append(target);}
    for(const child of node.childNodes)copy(child,target);
  }
  for(const child of parsed.body.childNodes)copy(child,out);
  return out.innerHTML;
}
