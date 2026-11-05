const queues=new Map();
export function flushCreationConversations(scope){return queues.get(scope)||Promise.resolve();}
const deletedKey=scope=>'yingce:deleted-creation-conversations:'+scope;
function deleted(scope){try{return new Set(JSON.parse(localStorage.getItem(deletedKey(scope))||'[]'));}catch{return new Set();}}
export function filterDeletedConversations(scope,items){const ids=deleted(scope);return items.filter(s=>!ids.has(s.id));}
export function markConversationDeleted(scope,id){if(!id)throw Error('缺少对话 ID');const ids=deleted(scope);ids.add(id);localStorage.setItem(deletedKey(scope),JSON.stringify([...ids]));}
export function restoreConversationDeletion(scope,id){const ids=deleted(scope);ids.delete(id);localStorage.setItem(deletedKey(scope),JSON.stringify([...ids]));}
export function persistCreationConversations(storage,scope,items){
  const previous=queues.get(scope)||Promise.resolve();
  const job=previous.catch(()=>{}).then(async()=>{const existing=JSON.parse(await storage.getItem('creation-conversations-v1')||'[]'),ids=new Set(items.map(v=>v.id));const merged=[...items,...existing.filter(v=>v.importedFromBundle&&!ids.has(v.id))];return storage.setItem('creation-conversations-v1',JSON.stringify(filterDeletedConversations(scope,merged)));});
  queues.set(scope,job);return job.finally(()=>{if(queues.get(scope)===job)queues.delete(scope);});
}
export async function deleteCreationConversation(storage,scope,id,items){
  markConversationDeleted(scope,id);
  try{await persistCreationConversations(storage,scope,items);}
  catch(error){restoreConversationDeletion(scope,id);throw error;}
}
