import {Z as reactModule,W as reactClient} from './vendor-react-DaNkUq-_.js';
const React=reactModule();
let component;
export async function nativeMessageComponent(){
  if(!component) component=import('./create-CmZBSZ8T.js').then(m=>m.YingceConversationMessage);
  return component;
}
export function mountNativeMessage(host,message,onRetry,onLayout){
  const root=reactClient().createRoot(host);let disposed=false;
  function Committed({Message,message:m}){React.useLayoutEffect(()=>{onLayout?.();},[m.content,m.status]);return React.createElement(Message,{item:{...m,mode:'text',status:({running:'streaming',succeeded:'done',failed:'error',stopped:'cancelled',interrupted:'cancelled'})[m.status]||m.status,references:[],attachments:[]},shotNumber:0,onRetryFailure:onRetry,onCreateVariant:()=>{},onEditUserMessage:()=>{},onContinueCanvas:()=>{},openingCanvas:false});}
  const update=async m=>{const Message=await nativeMessageComponent();if(disposed)return;root.render(React.createElement(Committed,{Message,message:{...m}}));};
  update(message);return{update,unmount:()=>{disposed=true;root.unmount();}};
}
