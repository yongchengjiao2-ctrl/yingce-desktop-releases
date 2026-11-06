// Keep each card's archive scoped to that project and its linked discussions.
export function projectFrontend(records,projectId){
 if(!projectId)return records;
 const writes=(records['yingce-chapter-outputs-v1']||[]).filter(r=>r.projectId===projectId);
 const own=(records['yingce-skill-agent-v1']||[]).filter(r=>r.projectId===projectId);
 const ids=new Set(writes.map(r=>r.conversationId).filter(Boolean));
 for(const session of own)for(const ref of session.references||[])if(ref.conversationId||ref.sourceConversationId)ids.add(ref.conversationId||ref.sourceConversationId);
 return{...records,'yingce-confirmed-materials-v1':(records['yingce-confirmed-materials-v1']||[]).filter(r=>r.projectId===projectId),'yingce-skill-agent-v1':own,'yingce-chapter-outputs-v1':writes,
 'creation-conversations-v1':(records['creation-conversations-v1']||[]).filter(r=>r.projectId===projectId||ids.has(r.id))};
}
export function projectIdFromCard(card){const match=/^\/projects\/([^/]+)\/overview(?:[?#]|$)/.exec(new URL(card.getAttribute('href')||'',location.origin).pathname);return match?decodeURIComponent(match[1]):'';}
