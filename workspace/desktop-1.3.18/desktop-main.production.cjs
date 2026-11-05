const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const portableRoot = app.isPackaged ? path.resolve(path.dirname(app.getPath('exe')), '..') : '';
const portable = Boolean(portableRoot && fs.existsSync(path.join(portableRoot, 'release.json')));
const root = portable ? portableRoot : (app.isPackaged ? path.resolve(process.resourcesPath, '../../../..') : path.resolve(__dirname, '..'));
const local = portable ? (process.env.YINGCE_DESKTOP_DATA_DIR || path.join(app.getPath('appData'), '..', 'Local', 'YingceCanvas')) : path.join(root, '.local');
const runtime = portable ? path.join(root,'runtime') : local;
if (portable) process.env.PATH = path.join(runtime,'node')+path.delimiter+process.env.PATH;
// Install the captured prompt/protocol state once before the backend opens its DB.
if (portable) require('child_process').execFileSync(path.join(runtime,'node','node.exe'), [path.join(root,'backend','desktop-state','apply-state.mjs'), '--install-root', local], {cwd:root, windowsHide:true, stdio:'pipe'});
app.setName('影策');
app.setPath('userData', path.join(local, 'desktop-profile'));
app.setAppUserModelId('local.yingce.desktop');
const children = [];
let window, server, origin, stopping = false;
const token = crypto.randomBytes(32).toString('hex');
const cookie = crypto.randomBytes(32).toString('hex');
const icon = path.join(__dirname, 'assets/icon.png');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function launch(name, executable, args, env) {
  const out = fs.openSync(path.join(local, 'logs', `desktop-${name}.log`), 'a');
  const child = spawn(executable, args, {cwd:root, env:{...process.env, ...env}, windowsHide:true, stdio:['ignore',out,out]});
  fs.closeSync(out);
  children.push(child);
  child.on('error', error => fail(`${name}: ${error.message}`));
  child.on('exit', code => { if (!stopping) fail(`${name} 意外停止 (${code})。请查看 .local/logs。`); });
  return child;
}

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve,reject) => {socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function waitReady(url, headers = {}) {
  for(let n=0;n<120;n++) {
    if(stopping) throw new Error('启动已取消');
    try {const response=await fetch(url,{headers,signal:AbortSignal.timeout(1500)}); if(response.ok) return;} catch {}
    await delay(500);
  }
  throw new Error('本地服务启动超时。请查看 .local/logs。');
}

function createServer(backendPort) {
  const webRoot = path.join(root,'web','dist');
  const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2','.wasm':'application/wasm','.json':'application/json','.mp4':'video/mp4'};
  const videoPrep = require(path.join(process.resourcesPath,'video-prep.cjs')).createHandler({local,runtime,resources:process.resourcesPath});
  return http.createServer((req,res) => {
    if (!req.headers.cookie?.split(';').some(part => part.trim() === `yingce_desktop=${cookie}`)) {res.writeHead(403);res.end('Desktop access only');return;}
    if (req.headers.origin && req.headers.origin !== origin) {res.writeHead(403);res.end();return;}
    if (req.url.startsWith('/desktop/video-prep')) { videoPrep(req,res); return; }
    if (req.url === '/desktop/clipboard-images') { require(path.join(process.resourcesPath,'native-image-clipboard.cjs')).handle(req,res); return; }
    if (req.url.startsWith('/desktop/breeze')) { require(path.join(process.resourcesPath,'breeze-proxy.cjs')).handle(req,res,local); return; }
    if (req.url.startsWith('/api/')) {
      const headers={...req.headers,host:`127.0.0.1:${backendPort}`,'x-canvas-desktop-token':token};
      delete headers.cookie;
      const upstream=http.request({hostname:'127.0.0.1',port:backendPort,path:req.url,method:req.method,headers},response=>{
        if(req.method==='POST' && req.url==='/api/tasks' && response.statusCode===400) {
          const chunks=[];let length=0;
          response.on('data',chunk=>{length+=chunk.length;if(length<16384) chunks.push(chunk);});
          response.on('end',()=>{
            try {
              const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
              const message=String(result.msg || result.message || '');
              if(/图片|参数|模型|分辨率|尺寸|参考|parameter|capability/i.test(message) && !/https?:|Bearer|sk-|api.?key|token/i.test(message))
                fs.writeFileSync(path.join(local,'task-validation.json'),JSON.stringify({code:result.code,reason:result.reason,message}));
            } catch {}
          });
        }
        res.writeHead(response.statusCode,response.headers);response.pipe(res);
      });
      upstream.on('error',()=>{if(!res.headersSent) res.writeHead(502);res.end();});
      res.on('close',()=>upstream.destroy());req.pipe(upstream);return;
    }
    if(req.method !== 'GET' && req.method !== 'HEAD') {res.writeHead(405);res.end();return;}
    let pathname;
    try {pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);} catch {res.writeHead(400);res.end();return;}
    let file=path.resolve(webRoot,'.'+pathname);
    if(!file.startsWith(webRoot+path.sep) && file!==webRoot) {res.writeHead(403);res.end();return;}
    try {if(!fs.statSync(file).isFile()) file=path.join(webRoot,'index.html');} catch {file=path.join(webRoot,'index.html');}
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control','no-cache');
    if(req.method==='HEAD') {res.end();return;}
    fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  });
}

function fail(message) {
  if(stopping) return;
  dialog.showErrorBox('影策启动失败',message);
  app.quit();
}

async function start() {
  fs.mkdirSync(path.join(local,'logs'),{recursive:true});
  const backendPort=await freePort(), whisperPort=await freePort();
  server=createServer(backendPort);
  // Keep a stable origin: browser-stored model keys and preferences survive restarts.
  const port=require(path.join(process.resourcesPath,'desktop-port.cjs')).resolveDesktopPort(local,process.env.YINGCE_DESKTOP_PORT);
  if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('桌面端口无效');
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${port}`;
  const env={GIN_MODE:'release',CANVAS_DESKTOP_MODE:'1',CANVAS_DESKTOP_TOKEN:token,CANVAS_BACKEND_ADDR:`127.0.0.1:${backendPort}`,CANVAS_BACKEND_DATA_DIR:path.join(local,'project-workbench-debug'),CANVAS_PI_RUNTIME_DIR:path.join(root,'backend','agent-runtime','pi'),CANVAS_CORS_ORIGINS:origin,CANVAS_REGISTRATION_ENABLED:'false',CANVAS_WHISPER_BASE_URL:`http://127.0.0.1:${whisperPort}`,CANVAS_FFMPEG_PATH:'D:\\ffmpeg\\bin\\ffmpeg.exe',NO_PROXY:'localhost,127.0.0.1,::1'};
  if(portable) {env.CANVAS_BACKEND_DATA_DIR=path.join(local,'data');env.CANVAS_FFMPEG_PATH=path.join(runtime,'ffmpeg','ffmpeg.exe');}
  launch('backend',path.join(runtime,'canvas-backend.exe'),[],env);
  launch('whisper',portable?path.join(runtime,'whisper','whisper-server.exe'):path.join(local,'tools','whisper','Release','whisper-server.exe'),['-m',portable?'runtime/models/ggml-base.bin':'.local/whisper-models/ggml-base.bin','--host','127.0.0.1','--port',String(whisperPort),'-l','auto'],{});
  const ses=session.fromPartition('persist:yingce');
  const localPlayerPermission = (contents, permission, requestingOrigin) => {
    if (!['media','fullscreen','clipboard-read','clipboard-sanitized-write','fileSystem'].includes(permission)) return false;
    try { return new URL(requestingOrigin || contents?.getURL()).origin === origin; }
    catch { return false; }
  };
  ses.setPermissionCheckHandler((contents,permission,requestingOrigin)=>localPlayerPermission(contents,permission,requestingOrigin));
  ses.setPermissionRequestHandler((contents,permission,callback,details)=>callback(localPlayerPermission(contents,permission,details.requestingUrl)));
  await ses.cookies.set({url:origin,name:'yingce_desktop',value:cookie,httpOnly:true,sameSite:'strict',path:'/'});
  const boundsFile=path.join(local,'desktop-window.json');
  let bounds={width:1440,height:940};
  try {bounds={...bounds,...JSON.parse(fs.readFileSync(boundsFile,'utf8'))};} catch {}
  window=new BrowserWindow({...bounds,minWidth:1000,minHeight:700,show:false,title:`影策 ${app.getVersion()} · 个人桌面工作台`,icon,backgroundColor:'#101827',autoHideMenuBar:false,webPreferences:{partition:'persist:yingce',contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  window.once('ready-to-show',()=>window.show());
  window.on('close',()=>{if(!window.isMaximized()) fs.writeFileSync(boundsFile,JSON.stringify(window.getNormalBounds()));});
  window.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type:'question', buttons:['继续等待保存','退出软件'], defaultId:0, cancelId:0,
      title:'画布正在保存', message:'画布仍有保存操作未完成。',
      detail:'可以继续等待，或退出软件。退出时未完成的改动可能无法保存；已提交的模型任务将在下次启动后继续查询。'
    });
    if(choice === 1) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/.test(url)) shell.openExternal(url);return {action:'deny'};});
  window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin){event.preventDefault();if(/^https?:/.test(url))shell.openExternal(url);}});
  window.on('page-title-updated',event=>event.preventDefault());
  window.webContents.on('before-input-event', (event,input) => {
    if(input.type==='keyDown' && input.control && input.key===',') {event.preventDefault();window.loadURL(origin+'/settings?section=channels');}
  });
  await window.loadFile(path.join(__dirname,'loading.html'));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'影策',submenu:[{label:'模型与设置',accelerator:'Ctrl+,',click:()=>window.loadURL(origin+'/settings?section=channels')},{label:'打开数据目录',click:()=>shell.openPath(env.CANVAS_BACKEND_DATA_DIR)},{label:portable?'安装或更新影策':'打开源码目录',click:()=>shell.openPath(portable?(fs.existsSync(path.join(local,'update.cmd'))?path.join(local,'update.cmd'):path.join(root,'update.cmd')):root)},{type:'separator'},{role:'quit',label:'退出影策'}]},
    // Let renderer keydown handlers process canvas shortcuts; native accelerators
    // otherwise consume Ctrl+C/V before the selected nodes can be copied/pasted.
    {label:'编辑',submenu:[{role:'undo',label:'撤销',registerAccelerator:false},{role:'redo',label:'重做',registerAccelerator:false},{type:'separator'},{role:'cut',label:'剪切',registerAccelerator:false},{role:'copy',label:'复制',registerAccelerator:false},{role:'paste',label:'粘贴',registerAccelerator:false},{role:'selectAll',label:'全选',registerAccelerator:false}]},
    {label:'视图',submenu:[{role:'reload',label:'重新加载'},{role:'resetZoom',label:'实际大小'},{role:'zoomIn',label:'放大界面'},{role:'zoomOut',label:'缩小界面'},{role:'togglefullscreen',label:'全屏'},{role:'toggleDevTools',label:'开发者工具'}]},
    {label:'帮助',submenu:[{label:`关于影策 ${app.getVersion()}`,click:()=>dialog.showMessageBox(window,{type:'info',title:'关于影策',message:`影策 ${app.getVersion()}`,detail:'个人桌面工作台'})}]}
  ]));
  await Promise.all([waitReady(`http://127.0.0.1:${backendPort}/api/health`,{'X-Canvas-Desktop-Token':token}),waitReady(`http://127.0.0.1:${whisperPort}/`)]);
  const featureURL=`http://127.0.0.1:${backendPort}/api/admin/settings/features`;
  const headers={'X-Canvas-Desktop-Token':token,'Content-Type':'application/json'};
  const features=await (await fetch(featureURL,{headers})).json();
  if(features.code!==0) throw new Error('无法初始化桌面功能配置');
  if(features.data.features.creditsEnabled) {
    const result=await (await fetch(featureURL,{method:'PATCH',headers,body:JSON.stringify({...features.data.features,creditsEnabled:false})})).json();
    if(result.code!==0) throw new Error('无法保存桌面功能配置');
  }
  await window.loadURL(origin+'/canvas');
  if(process.argv.includes('--breeze-repair-smoke')) { await delay(7000); await window.webContents.executeJavaScript('globalThis.breezeRepairAndVerify()'); window.show(); }
  if(process.argv.includes('--breeze-native-smoke')) { await delay(7000); await window.webContents.executeJavaScript('globalThis.breezeNativeSmoke()'); window.show(); }
  if(process.argv.includes('--breeze-smoke')) { await delay(5000); await window.webContents.executeJavaScript('globalThis.breezeSmoke()'); }
  if(process.argv.includes('--smoke-test')) await smokeTest(headers,backendPort);
  if(process.argv.includes('--distribution-smoke')) {
    await delay(4000);
    const auth=await (await fetch(`http://127.0.0.1:${backendPort}/api/auth/session`,{headers})).json();
    const canvases=await (await fetch(`http://127.0.0.1:${backendPort}/api/canvas-projects`,{headers})).json();
    const text=await window.webContents.executeJavaScript('document.body.innerText');
    fs.writeFileSync(path.join(local,'distribution-smoke.json'),JSON.stringify({portable,appVersion:app.getVersion(),desktopPort:port,backgroundThrottling:window.webContents.getBackgroundThrottling(),authCode:auth.code,canvasesCode:canvases.code,canvasData:canvases.data,uiReady:text.includes('我的画布'),dataDir:env.CANVAS_BACKEND_DATA_DIR}));
    app.quit();
  }
}

// Acceptance runs only when explicitly launched with --smoke-test by the build workflow.
async function smokeTest(headers,backendPort) {
  await delay(3500);
  const base=`http://127.0.0.1:${backendPort}`;
  const auth=await (await fetch(base+'/api/auth/session',{headers})).json();
  const blocked=await fetch(base+'/api/auth/session');
  const canvas=await (await fetch(base+'/api/canvas-projects/local-welcome',{headers})).json();
  const form=new FormData();form.set('file',new Blob([fs.readFileSync(path.join(local,'smoke.wav'))],{type:'audio/wav'}),'smoke.wav');
  const uploaded=await (await fetch(base+'/api/resources',{method:'POST',headers:{'X-Canvas-Desktop-Token':token},body:form})).json();
  const resource=uploaded.data?.resource;
  const downloaded=resource ? await fetch(base+`/api/resources/${resource.id}/file`,{headers}) : null;
  const bytes=downloaded?.ok ? Buffer.from(await downloaded.arrayBuffer()) : Buffer.alloc(0);
  const page=await window.webContents.executeJavaScript('({title:document.title,text:document.body.innerText,scrollWidth:document.documentElement.scrollWidth,width:innerWidth})');
  const report={auth:auth.code,owner:auth.data?.user?.displayName,unauthenticated:blocked.status,canvas:canvas.code,upload:uploaded.code,download:downloaded?.status,hashMatch:bytes.equals(fs.readFileSync(path.join(local,'smoke.wav'))),page};
  fs.writeFileSync(path.join(local,'desktop-smoke.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(local,'desktop-screenshot.png'),(await window.webContents.capturePage()).toPNG());
  await window.loadURL(origin+'/settings?section=channels');
  await delay(2000);
  window.setSize(1024,768);
  await delay(500);
  report.settings=await window.webContents.executeJavaScript('({text:document.body.innerText,scrollWidth:document.documentElement.scrollWidth,width:innerWidth})');
  fs.writeFileSync(path.join(local,'desktop-settings.png'),(await window.webContents.capturePage()).toPNG());
  window.setSize(1440,940);
  fs.writeFileSync(path.join(local,'desktop-smoke.json'),JSON.stringify(report,null,2));
}

if(!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
  app.whenReady().then(start).catch(error=>fail(error.message));
}
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{
  stopping=true;
  for(const child of children) { if(child.pid) spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}); }
  server?.close();
});
