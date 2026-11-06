import {Z as reactModule,W as reactClient} from './vendor-react-DaNkUq-_.js';
const React=reactModule();
let component;
export async function nativeMessageComponent(){
  if(!component) component=import('./create-CmZBSZ8T.js').then(m=>m.YingceConversationMessage);
  return component;
}
export function nativeMessageItem(message){
  const status=({running:'streaming',succeeded:'done',failed:'error',stopped:'cancelled',interrupted:'cancelled'})[message.status]||message.status;
  const active=status==='streaming'||status==='pending';
  const content=message.content || (active?'':status==='cancelled'?'已停止，尚未收到正文':status==='error'?'生成失败，未返回正文':'未返回正文');
  return {...message,mode:'text',status,content,references:[],attachments:[]};
}
export function mountNativeMessage(host,message,onRetry,onLayout){
  const root=reactClient().createRoot(host);let disposed=false,version=0,last;
  function Committed({Message,message:m}){React.useLayoutEffect(()=>{onLayout?.();},[m.content,m.status]);return React.createElement(Message,{item:nativeMessageItem(m),shotNumber:0,onRetryFailure:onRetry,onCreateVariant:()=>{},onEditUserMessage:()=>{},onContinueCanvas:()=>{},openingCanvas:false});}
  const update=async m=>{if(last&&last.content===m.content&&last.status===m.status&&last.error===m.error)return;const snapshot={...m};last=snapshot;const revision=++version;const Message=await nativeMessageComponent();if(disposed||revision!==version)return;root.render(React.createElement(Committed,{Message,message:snapshot}));};
  update(message);return{update,unmount:()=>{disposed=true;root.unmount();}};
}
