const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
function numberWords(value){if(value<20)return small[value];if(value<100)return tens[Math.floor(value/10)]+(value%10?' '+small[value%10]:'');if(value<1000)return small[Math.floor(value/100)]+' hundred'+(value%100?' '+numberWords(value%100):'');if(value<10000)return small[Math.floor(value/1000)]+' thousand'+(value%1000?' '+numberWords(value%1000):'');return String(value);}
const tokens=text=>String(text||'').toLowerCase().replace(/’/g,"'").replace(/\$(\d+)/g,'$1 dollars').replace(/\b\d{1,4}\b/g,match=>numberWords(Number(match))).match(/[a-z]+(?:'[a-z]+)?|[\u4e00-\u9fff]/g)||[];
export function selectSupportedUtterances(rows,prepared){
 const confirmed=[],unverified=[];
 for(const row of rows){
  const nearby=(prepared.segments||[]).filter(segment=>segment.end_ms>row.start_ms-500&&segment.start_ms<row.end_ms+500);
  const spoken=new Set(tokens(nearby.map(segment=>segment.text).join(' '))),expected=tokens(prepared.language==='zh'?row.zh_hans:row.en);
  const audioCoverage=expected.length?expected.filter(word=>spoken.has(word)).length/expected.length:0;
  const visible=(prepared.caption_tracks||[]).filter(track=>track.end_ms>row.start_ms-500&&track.start_ms<row.end_ms+500).map(track=>track.text).join('');
  const characters=[...String(row.zh_hans||'')].filter(char=>/[\u4e00-\u9fff]/.test(char));
  const captionCoverage=characters.length?characters.filter(char=>visible.includes(char)).length/characters.length:0;
  if(audioCoverage>=.6||captionCoverage>=.6){confirmed.push(row);continue;}
  unverified.push({...row,needs_review:true,evidence:row.evidence+'；整集原音与硬字幕未形成足够交叉证据，作为候选保留，不写入正式对白。'});
 }
 return {confirmed,unverified};
}
