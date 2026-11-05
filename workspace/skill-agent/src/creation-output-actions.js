import {Z as reactModule} from './vendor-react-DaNkUq-_.js';
import {showChapterSave,conversationText,downloadOutput} from './chapter-output.js';
const React=reactModule(),h=React.createElement;
export function CreationOutputActions({conversation,message,children}){
  const ready=message.role==='assistant'&&(message.mode||'text')==='text'&&['done','succeeded'].includes(message.status)&&message.content?.trim();
  const[error,setError]=React.useState('');
  return h(React.Fragment,null,children,ready?h('div',{className:'creation-output-actions'},h('button',{type:'button',onClick:()=>showChapterSave({text:message.content,title:conversation.title||'Skill 输出',conversationId:conversation.id,messageId:message.id,provenance:{references:message.references,model:message.model}}).catch(e=>setError(e.message))},'保存到章节'),h('button',{type:'button',onClick:()=>downloadOutput(message.content,conversation.title||'Skill 输出')},'下载内容'),error?h('small',{role:'alert'},error):null):null);
}
export function SaveCreationConversation({conversation}){const[error,setError]=React.useState('');return h(React.Fragment,null,h('button',{type:'button',className:'creation-save-conversation',disabled:!conversation?.messages?.length,onClick:()=>showChapterSave({text:conversationText(conversation),title:conversation.title||'聊天记录',conversationId:conversation.id}).catch(e=>setError(e.message))},'保存聊天到章节'),error?h('small',{role:'alert'},error):null);}
