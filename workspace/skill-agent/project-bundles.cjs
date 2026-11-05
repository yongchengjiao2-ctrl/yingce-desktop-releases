const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {dialog,shell,BrowserWindow}=require('electron');
let working=false;
const reply=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
function session(req,port,token){return new Promise((resolve,reject)=>{
  const headers={...req.headers,host:`127.0.0.1:${port}`,'x-canvas-desktop-token':token};delete headers.cookie;delete headers['content-length'];delete headers['content-type'];
  http.get({hostname:'127.0.0.1',port,path:'/api/auth/session',headers},r=>{let s='';r.on('data',b=>s+=b);r.on('end',()=>{try{const v=JSON.parse(s);const user=v.data?.user;if(r.statusCode!==200||!user?.id)throw Error('请先登录影策');resolve(user);}catch(e){reject(e);}});}).on('error',reject);
});}
function body(req){return new Promise((resolve,reject)=>{let size=0,chunks=[];req.on('data',b=>{size+=b.length;if(size>128*1024*1024){reject(Error('聊天记录超过 128 MB 限制'));req.destroy();}else chunks.push(b);});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'));}catch(e){reject(e);}});req.on('error',reject);});}
function run(runtime,resources,args){return new Promise((resolve,reject)=>{const proc=spawn(path.join(runtime,'python','python.exe'),[path.join(resources,'project_bundle.py'),...args],{windowsHide:true});let out='',err='';proc.stdout.on('data',b=>out+=b);proc.stderr.on('data',b=>err+=b);proc.on('error',reject);proc.on('close',code=>{try{const v=JSON.parse(out);if(code||v.error)throw Error(v.error||'项目迁移失败');resolve(v);}catch(e){reject(new Error(e.message+(err?'（请检查项目迁移日志）':'')));}});});}
exports.handle=async(req,res,{local,runtime,resources,backendPort,token})=>{
 try{
  const user=await session(req,backendPort,token),action=new URL(req.url,'http://localhost').pathname.split('/').pop();
  const folder=path.join(local,'exports','project-bundles');fs.mkdirSync(folder,{recursive:true});
  if(req.method==='GET'&&action==='info')return reply(res,200,{folder,source:path.join(resources,'project_bundle.py'),available:true});
  if(req.method==='POST'&&action==='open-folder'){await shell.openPath(folder);return reply(res,200,{ok:true});}
  if(req.method==='POST'&&action==='open-source'){shell.showItemInFolder(path.join(resources,'project_bundle.py'));return reply(res,200,{ok:true});}
  const receipts=path.join(local,'data','project-bundle-receipts');
  if(req.method==='GET'&&action==='pending'){const records=fs.existsSync(receipts)?fs.readdirSync(receipts).filter(n=>n.startsWith(user.id+'-')&&n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(receipts,n),'utf8'))):[];return reply(res,200,{records});}
  if(req.method==='POST'&&action==='ack'){const data=await body(req);if(!/^[a-f0-9]{32}$/.test(data.id||''))throw Error('迁移编号无效');fs.rmSync(path.join(receipts,user.id+'-'+data.id+'.json'),{force:true});return reply(res,200,{ok:true});}
  if(req.method!=='POST'||!['export','import'].includes(action))return reply(res,404,{error:'未知操作'});
  if(working)throw Error('已有打包或导入任务正在进行');working=true;
  try{
   const data=await body(req),win=BrowserWindow.getFocusedWindow();
   if(action==='export'){
    const stamp=new Date().toISOString().replace(/[:.]/g,'-'),output=path.join(folder,'影策项目-'+stamp+'.zip');
    const request=path.join(folder,'.export-'+stamp+'.json');
    fs.writeFileSync(request,JSON.stringify({output,frontend:data.frontend||{},projectId:data.projectId||null}));
    try{const result=await run(runtime,resources,['export',local,user.id,request]);shell.showItemInFolder(result.path);return reply(res,200,result);}finally{fs.rmSync(request,{force:true});}
   }
   const opts={title:'导入影策项目 ZIP',filters:[{name:'影策项目迁移包',extensions:['zip']}],properties:['openFile']};
   const selection=win?await dialog.showOpenDialog(win,opts):await dialog.showOpenDialog(opts);
   if(selection.canceled)return reply(res,200,{cancelled:true});
   const result=await run(runtime,resources,['import',local,user.id,selection.filePaths[0]]);return reply(res,200,result);
  }finally{working=false;}
 }catch(e){reply(res,400,{error:e.message});}
};
