const cosine=(a,b)=>a.reduce((sum,value,index)=>sum+value*b[index],0);
const normalize=vector=>{const norm=Math.sqrt(cosine(vector,vector));return norm>1e-9?vector.map(value=>value/norm):null;};
export function reconcileSpeakers(utterances,shots,voice,characters=[]){
 const names=new Map(characters.map(person=>[person.id,person.name]));
 const embeddings=new Map(voice.vectors.map(row=>[row.id,row]));
 const sceneOf=row=>{const middle=(row.start_ms+row.end_ms)/2;return shots.find(shot=>shot.start_ms<=middle&&middle<shot.end_ms)?.scene||'';};
 const groups=new Map();
 for(const row of utterances){
  const sample=embeddings.get(row.id);
  if(!sample||row.needs_review||sample.audio_end_ms-sample.audio_start_ms<1000)continue;
  const list=groups.get(row.speaker_id)||[];list.push(sample.embedding);groups.set(row.speaker_id,list);
 }
 const centers=new Map();
 for(const [speaker,vectors] of groups){
  if(vectors.length<3)continue;
  // Keep a stable majority of independently anchored long phrases.
  const medoid=vectors.map(vector=>vectors.reduce((sum,other)=>sum+cosine(vector,other),0)).reduce((best,value,index,values)=>value>values[best]?index:best,0);
  const similarities=vectors.filter((_,index)=>index!==medoid).map(vector=>cosine(vector,vectors[medoid])).sort((a,b)=>a-b),floor=similarities[Math.floor(similarities.length/2)]-.15;
  const retained=vectors.filter(vector=>cosine(vector,vectors[medoid])>=floor);
  if(retained.length<3)continue;
  centers.set(speaker,{vector:normalize(retained[0].map((_,index)=>retained.reduce((sum,vector)=>sum+vector[index],0)/retained.length)),anchors:retained.length});
 }
 const original=utterances.map(row=>({...row})),corrections=[],conflicts=[];let reviewed=0;
 for(const row of utterances){
  const sample=embeddings.get(row.id),own=centers.get(row.speaker_id);if(!sample||!own)continue;
  const active=new Set(original.filter(other=>sceneOf(other)===sceneOf(row)).map(other=>other.speaker_id));
  const scores=[...centers].filter(([speaker])=>active.has(speaker)).map(([speaker,center])=>({speaker,score:cosine(sample.embedding,center.vector),anchors:center.anchors})).sort((a,b)=>b.score-a.score);
  if(scores.length<2)continue;reviewed++;
  const self=cosine(sample.embedding,own.vector),best=scores[0];
  if(best.speaker===row.speaker_id)continue;
  const evidence='原音跨句身份核对：当前角色相似度 '+self.toFixed(3)+'，同场角色 '+(names.get(best.speaker)||best.speaker)+' 相似度 '+best.score.toFixed(3)+'，来自 '+best.anchors+' 条独立长句锚点；原音区间 '+sample.audio_start_ms+'–'+sample.audio_end_ms+'ms。';
  if(best.score>=.74&&best.score-self>=.10){
   const before=row.speaker_id;row.speaker_id=best.speaker;row.evidence+='；'+evidence+' 已纠正视觉初判的角色错配。';
   corrections.push({id:row.id,before,after:best.speaker,selfScore:self,bestScore:best.score,anchors:best.anchors});
  }else if(best.score-self>=.06){
   row.needs_review=true;row.evidence+='；'+evidence+' 差异不足以自动更改，需回听核对。';conflicts.push({id:row.id,selfScore:self,bestScore:best.score});
  }
 }
 return {model:voice.model,algorithmVersion:1,reviewedRows:reviewed,anchorSpeakers:[...centers].map(([id,row])=>({id,phrases:row.anchors})),corrections,conflicts};
}

export async function auditVideoSpeakers(prepared,utterances,shots,onUpdate,characters=[]){
 onUpdate?.({stage:'正在以原音交叉核对人物身份',progress:84});
 const response=await fetch('/desktop/video-prep/'+prepared.id+'/voices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({utterances:utterances.map(({id,start_ms,end_ms,en})=>({id,start_ms,end_ms,en}))})});
 const voice=await response.json();if(!response.ok)throw Error(voice.error||'原音人物核对未完成');
 if(!Array.isArray(voice.vectors)||voice.vectors.length!==utterances.length)throw Error('原音人物核对缺少片段');
 return reconcileSpeakers(utterances,shots,voice,characters);
}
