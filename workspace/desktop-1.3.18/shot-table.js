const fields=['镜号','时间','时长（秒）','原片截图','景别','场景','画面描述','对白／文案（中英）','花字／字幕','声音／音效'];
const append=(parent,tag,text)=>{
 const child=document.createElement(tag);
 if(text!==undefined)child.textContent=text;
 parent.append(child);
 return child;
};

async function tableStorage(method,key,value){
 const db=await new Promise((resolve,reject)=>{
  const req=indexedDB.open('yingce-shot-tables',1);
  req.onupgradeneeded=()=>req.result.createObjectStore('chapters');
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 });
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction('chapters',method==='put'?'readwrite':'readonly');
  const store=tx.objectStore('chapters');
  const req=method==='put'?store.put(value,key):store.get(key);
  tx.oncomplete=()=>resolve(req.result);tx.onerror=tx.onabort=()=>reject(tx.error);
 });}finally{db.close();}
}

async function seedRows(record){
 if(record?.data?.shots?.length)return record.data.shots.map((shot,index)=>[
  String(index+1),shot.time,shot.duration,shot.image||'',shot.size,shot.scene,shot.visual,shot.dialogue,shot.subtitle,shot.audio
 ]);
 return record?.data?.shots?.map((shot,index)=>[
  String(index+1),shot.time,shot.duration,'',shot.size,shot.scene,shot.visual,shot.dialogue,shot.subtitle,shot.audio
 ])??[];
}

export async function openShotTable(route,record){
 const existing=document.querySelector('.yingce-shot-table');if(existing?.open)return;existing?.remove();
 const dialog=append(document.body,'dialog');
 dialog.className='yingce-video-dialog yingce-shot-table';
 dialog.setAttribute('aria-label','逐镜拆解表');
 const lifecycle=new AbortController();
 let videoUrl;
 dialog.onclose=()=>{lifecycle.abort();if(videoUrl)URL.revokeObjectURL(videoUrl);dialog.remove();};
 const header=append(dialog,'header');
 header.className='yingce-video-header';
 append(header,'h2','逐镜拆解表');
 const close=append(header,'button','×');
 close.setAttribute('aria-label','关闭');
 close.onclick=()=>dialog.close();
 const status=append(dialog,'p','正在读取本章镜头…');
 status.setAttribute('role','status');
 dialog.showModal();
 const key='yingce:shot-table:'+route;
 let rows,widths,saved,latestRows;const sourceVersion=record?.data?.completedAt||record?.updatedAt||'';let newerSource=false;
 try{
  saved=await tableStorage('get',key);
  latestRows=await seedRows(record);
  const legacy=localStorage.getItem(key);
  rows=Array.isArray(saved)?saved:saved?.rows??(legacy===null?latestRows:JSON.parse(legacy));
  if(saved&&latestRows.length&&saved.sourceVersion!==sourceVersion){
   if(saved.sourceRows&&JSON.stringify(rows)===JSON.stringify(saved.sourceRows))rows=latestRows;
   else newerSource=true;
  }
  widths=(!Array.isArray(saved)&&saved?.widths)||[56,140,75,120,80,140,280,300,220,220,64];
 }catch(error){status.textContent='读取失败：'+error.message;return;}
 if(!dialog.open)return;
 const scroll=append(dialog,'div');
 scroll.className='yingce-shot-scroll';
 const table=append(scroll,'table');
 const columns=append(table,'colgroup');
 const columnElements=widths.map(width=>{const col=append(columns,'col');col.style.width=width+'px';return col;});
 const resizeTable=()=>{table.style.width=widths.reduce((sum,width)=>sum+width,0)+'px';};
 resizeTable();
 const fit=input=>{input.style.height='auto';input.style.height=Math.max(30,input.scrollHeight)+'px';};
 const head=append(append(table,'thead'),'tr');
 for(const [index,name] of [...fields,'操作'].entries()){
  const th=append(head,'th',name);th.scope='col';
  const grip=append(th,'span');grip.className='yingce-shot-column-grip';
  grip.setAttribute('role','separator');grip.setAttribute('aria-orientation','vertical');
  grip.setAttribute('aria-label','调整'+name+'列宽');grip.tabIndex=0;
  const change=width=>{widths[index]=Math.round(Math.min(900,Math.max(44,width)));columnElements[index].style.width=widths[index]+'px';resizeTable();};
  const reflow=()=>{for(const row of editable){const input=row[index];if(index!==3&&input)fit(input);}status.textContent='列宽已修改，点击「保存表格」保留。';};
  grip.onkeydown=event=>{
   if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
   event.preventDefault();change(widths[index]+(event.key==='ArrowLeft'?-12:12));reflow();
  };
  grip.onpointerdown=event=>{
   event.preventDefault();const startX=event.clientX,startWidth=widths[index];
   const dragging=new AbortController();
   const end=()=>{dragging.abort();reflow();};
   document.addEventListener('pointermove',move=>change(startWidth+move.clientX-startX),{signal:dragging.signal});
   document.addEventListener('pointerup',end,{once:true,signal:dragging.signal});
   lifecycle.signal.addEventListener('abort',()=>dragging.abort(),{once:true});
  };
 }

 const body=append(table,'tbody');
 const footer=append(dialog,'footer');
 footer.className='yingce-video-footer';
 const add=append(footer,'button','新增一镜');
 const save=append(footer,'button','保存表格');
 if(newerSource){
  const latest=append(footer,'button','载入最新 AI 结果');latest.className='yingce-video-button';
  latest.onclick=async()=>{
   try{await tableStorage('put',key,{rows:latestRows,widths,sourceRows:latestRows,sourceVersion,previousRows:rows});dialog.close();setTimeout(()=>openShotTable(route,record),50);}
   catch(error){status.textContent='载入失败：'+error.message;}
  };
 }
 if(saved?.previousRows){
  const restore=append(footer,'button','恢复上次表格');restore.className='yingce-video-button';
  restore.onclick=async()=>{
   try{await tableStorage('put',key,{rows:saved.previousRows,widths,sourceRows:latestRows,sourceVersion,previousRows:rows});dialog.close();setTimeout(()=>openShotTable(route,record),50);}
   catch(error){status.textContent='恢复失败：'+error.message;}
  };
 }
 for(const button of [add,save])button.className='yingce-video-button';
 const images=rows.map(row=>row[3]);
 const editable=[];
 const render=(row,image)=>{
  const tr=append(body,'tr');
  const editors=row.map((value,index)=>{
   const cell=append(tr,'td');
   if(index===3){
    if(image?.startsWith('data:image/jpeg;base64,')){
     const img=append(cell,'img');
     img.src=image;img.alt='原片截图';
    }
    if(record?.video){
     const preview=append(cell,'button','定位原片');
     preview.onclick=()=>{
      const start=editors[1].value.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)/);
      if(!start){status.textContent='请先填写起始时间，例如 00:12.50。';return;}
      const player=dialog.querySelector('video');
      player.hidden=false;
      player.currentTime=Number(start[1]||0)*60+Number(start[2]);
      player.scrollIntoView({block:'nearest'});
     };
     const capture=append(cell,'button','截取当前帧');
     capture.onclick=()=>{
      const player=dialog.querySelector('video');
      if(player.hidden||player.readyState<2){status.textContent='请先定位原片并等待画面载入。';return;}
      const frame=document.createElement('canvas');
      frame.width=144;
      frame.height=Math.round(144*player.videoHeight/player.videoWidth);
      frame.getContext('2d').drawImage(player,0,0,frame.width,frame.height);
      const url=frame.toDataURL('image/jpeg',0.82);
      const img=cell.querySelector('img')||append(cell,'img');
      img.src=url;img.alt='原片截图';
      editors[3]=url;status.textContent='截图已更新，点击「保存表格」保留。';
     };
    }else if(!image)append(cell,'span','—');
    return image;
   }
   const input=append(cell,'textarea');
   input.rows=1;
   input.setAttribute('aria-label',fields[index]);
   input.value=value??'';
   input.oninput=()=>{fit(input);status.textContent='有修改待保存';};
   requestAnimationFrame(()=>{if(input.isConnected)fit(input);});
   return input;
  });
  const remove=append(append(tr,'td'),'button','删除');
  remove.onclick=()=>{
   editable.splice(editable.indexOf(editors),1);
   tr.remove();status.textContent='有修改待保存';
  };
  editable.push(editors);
 };
 if(record?.video){
  videoUrl=URL.createObjectURL(record.video);
  const player=document.createElement('video');
  player.src=videoUrl;player.controls=true;player.preload='metadata';player.hidden=true;
  dialog.insertBefore(player,scroll);
 }
 rows.forEach((row,index)=>render(row,images[index]));
 add.onclick=()=>{
  const next=editable.reduce((max,row)=>Math.max(max,Number(row[0].value)||0),0)+1;
  render([String(next),'','','','','','','','',''],'');
  editable.at(-1)[1].focus();status.textContent='有修改待保存';
 };
 save.onclick=async()=>{
  try{
   await tableStorage('put',key,{rows:editable.map(row=>row.map((input,index)=>index===3?input:input.value)),widths,sourceRows:latestRows,sourceVersion,...(saved?.previousRows?{previousRows:saved.previousRows}:{})});
   status.textContent='已保存本章逐镜拆解表';
  }catch(error){status.textContent='保存失败：'+error.message;}
 };
 status.textContent=rows.length?(record?.data?.method?'AI 根据原音转写与时间码画面核对生成，截图来自原视频。修改后点击「保存表格」。':'已载入本章拆解稿，修改后点击「保存表格」。'):'本章暂无镜头，可以手动新增，或在视频分析完成后查看模型返回的镜头。';
 if(newerSource)status.textContent+=' 当前保留已保存的表格；点击「载入最新 AI 结果」可同步新分析，旧表会备份。';
}
