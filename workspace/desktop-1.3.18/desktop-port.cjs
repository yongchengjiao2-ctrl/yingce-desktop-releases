const fs=require('node:fs');
const path=require('node:path');
function resolveDesktopPort(local,override){
 const settings=path.join(local,'desktop-port.txt');
 let selected=override;
 if(!selected&&fs.existsSync(settings))selected=fs.readFileSync(settings,'utf8').trim();
 if(!selected){
  const launcher=path.join(local,'launch.ps1');
  if(fs.existsSync(launcher))selected=fs.readFileSync(launcher,'utf8').match(/YINGCE_DESKTOP_PORT\s*=\s*['"](\d+)['"]/i)?.[1];
 }
 if(!selected){
  // Preserve the origin of existing IndexedDB video and table records when an
  // older installer has already replaced the previous launch script.
  const directory=path.join(local,'desktop-profile','Partitions','yingce','IndexedDB');
  if(fs.existsSync(directory)){
   const candidates=fs.readdirSync(directory).flatMap(name=>{
    const match=/^http_127\.0\.0\.1_(\d+)\.indexeddb\.leveldb$/.exec(name);
    if(!match)return [];
    const folder=path.join(directory,name);
    const modified=Math.max(fs.statSync(folder).mtimeMs,...fs.readdirSync(folder).map(file=>fs.statSync(path.join(folder,file)).mtimeMs));
    return [{port:match[1],modified}];
   }).sort((a,b)=>b.modified-a.modified);
   selected=candidates[0]?.port;
  }
 }
 const port=Number(selected||31317);
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('桌面端口配置无效，请检查 desktop-port.txt');
 fs.mkdirSync(local,{recursive:true});
 fs.writeFileSync(settings,String(port));
 return port;
}
module.exports={resolveDesktopPort};
