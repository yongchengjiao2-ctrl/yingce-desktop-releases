import {p as generateHTML, r as initTiptap} from './dist-DFPNVekV.js';
initTiptap();
// Installed into the chapter component's existing editor effect by install.py.
export function connectChapterAgent({editor, unit, projectId, dirty, screenplay, setSource, setScreenplay, clean, invalidate}) {
  const field = unit.screenplayText ? 'screenplayText' : 'sourceText';
  const content = () => field === 'screenplayText' ? screenplay : editor.getHTML();
  const request = event => {
    const d = event.detail;
    if (d?.projectId !== projectId || d.chapterId !== unit.id) return;
    try {
      const current = content();
      const textArea = document.querySelector('.project-chapter-editor-scroll textarea');
      const range = field === 'sourceText' ? {from:editor.state.selection.from,to:editor.state.selection.to} : textArea ? {from:textArea.selectionStart,to:textArea.selectionEnd} : null;
      if (d.action === 'snapshot') d.done({projectId,chapterId:unit.id,title:unit.title,field,content:current,persistedContent:unit[field] || '',dirty,selection:range});
      if (d.action === 'plan') {
        if (field !== 'sourceText') throw Error('画面剧本支持追加和新建；选区编辑请在章节正文中操作');
        if (dirty || d.content !== current) throw Error('章节已变化，请重新预览');
        const {from,to} = d.selection || {};
        if (!Number.isInteger(from) || !Number.isInteger(to)) throw Error('请先在章节中选择文字或光标位置');
        // Build with a transaction without dispatching: preview must never modify the editor.
        const {state} = editor;
        const text = d.text.split(/\r?\n/).map(line => state.schema.nodes.paragraph.create(null,line ? state.schema.text(line) : null));
        const tr = state.tr.replaceRange(from,d.mode === 'insert' ? from : to,state.schema.nodes.doc.create(null,text).slice(0));
        d.done({content:generateHTML(tr.doc.toJSON(),editor.extensionManager.extensions)});
      }
    } catch (error) { d.done({error:error.message}); }
  };
  const saved = event => {
    const d=event.detail;if(d?.projectId!==projectId)return;
    if(d.chapterId!==unit.id){invalidate();return;}
    if (dirty) { invalidate(); return; }
    if ((d.field || field) === 'screenplayText') setScreenplay(d.content);
    else { setSource(d.content);editor.commands.setContent(d.content,{emitUpdate:false}); }
    clean();invalidate();
  };
  window.addEventListener('yingce-agent-editor-request',request);
  window.addEventListener('yingce-agent-editor-saved',saved);
  return () => { window.removeEventListener('yingce-agent-editor-request',request); window.removeEventListener('yingce-agent-editor-saved',saved); };
}
