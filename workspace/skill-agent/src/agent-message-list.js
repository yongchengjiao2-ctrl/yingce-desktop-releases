// Keep React roots and DOM nodes stable across streaming and terminal updates.
export function reconcileMessages(list,views,messages,create){
  const ids=new Set(messages.map(m=>m.id));
  for(const [id,view] of views)if(!ids.has(id)){view.unmount();view.card.remove();views.delete(id);}
  if(messages.length&&list.querySelector(':scope > h3'))list.replaceChildren();
  messages.forEach((message,index)=>{
    let view=views.get(message.id);
    if(!view){view=create(message);views.set(message.id,view);}else view.update(message);
    if(list.children[index]!==view.card)list.insertBefore(view.card,list.children[index]||null);
  });
}
