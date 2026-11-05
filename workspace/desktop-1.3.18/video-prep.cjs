const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const {pipeline} = require('node:stream/promises');
const {Transform} = require('node:stream');
const {spawn} = require('node:child_process');

function createHandler({local, runtime, resources}) {
  const directory = path.join(local, 'data', 'video-analysis');
  const config = JSON.parse(fs.readFileSync(path.join(resources, 'video-prep-config.json'), 'utf8'));
  for(const field of ['python','model','speakerModel'])if(config[field]&&!path.isAbsolute(config[field]))config[field]=path.join(runtime,config[field]);
  let sequence = Promise.resolve();
  const jobs = new Map();
  const respond = (res, status, value) => {
    res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
    res.end(JSON.stringify(value));
  };
  const ready=filename=>{if(!fs.existsSync(filename))return false;const data=JSON.parse(fs.readFileSync(filename,'utf8'));return data.evidence_version===2&&Array.isArray(data.voice_pitch);};
  async function run(id, folder, filename) {
    jobs.set(id, {stage:'等待原音处理', progress:0});
    sequence = sequence.catch(()=>{}).then(async () => {
      if(ready(path.join(folder,'result.json'))) {jobs.set(id,{stage:'已准备',progress:100});return;}
      await new Promise(resolve => {
        const child = spawn(config.python, [
          path.join(resources, 'prepare-video.py'), '--video', filename, '--out', folder,
          '--ffmpeg', path.join(runtime,'ffmpeg','ffmpeg.exe'), '--model', config.model
        ], {windowsHide:true, stdio:['ignore','ignore','pipe']});
        let diagnostic = '';
        child.stderr.on('data', chunk => {diagnostic=(diagnostic+chunk).slice(-4000);});
        child.on('error', error => {
          jobs.set(id,{stage:'失败',error:error.message,progress:0});resolve();
        });
        child.on('exit', code => {
          if(code)jobs.set(id,{stage:'失败',error:'本地转写未完成。'+diagnostic.slice(-600),progress:0});
          else jobs.set(id,{stage:'已准备',progress:100});
          resolve();
        });
      });
    });
  }
  return async function handle(req,res) {
    try {
      await fsp.mkdir(directory,{recursive:true});
      const url = new URL(req.url,'http://desktop');
      if(url.pathname==='/desktop/video-prep' && req.method==='POST') {
        const upload = path.join(directory,crypto.randomUUID()+'.upload');
        const hash=crypto.createHash('sha256');
        let size=0;
        const meter = new Transform({transform(chunk,encoding,done){
          size+=chunk.length;
          if(size>2*1024**3)return done(Error('单集文件超过 2 GB'));
          hash.update(chunk);done(null,chunk);
        }});
        try {await pipeline(req,meter,fs.createWriteStream(upload,{flags:'wx'}));}
        catch(error){await fsp.unlink(upload).catch(()=>{});throw error;}
        const id=hash.digest('hex'), folder=path.join(directory,id);
        await fsp.mkdir(folder,{recursive:true});
        const filename=path.join(folder,'source.video');
        if(fs.existsSync(filename))await fsp.unlink(upload);
        else await fsp.rename(upload,filename);
        if(!jobs.has(id)||jobs.get(id)?.error)run(id,folder,filename);
        respond(res,202,{id});return;
      }
      const voicesRoute=/^\/desktop\/video-prep\/([a-f0-9]{64})\/voices$/.exec(url.pathname);
      if(voicesRoute && req.method==='POST') {
        const chunks=[];let bytes=0;
        for await(const chunk of req){bytes+=chunk.length;if(bytes>1024*1024)throw Error('原音核对请求过大');chunks.push(chunk);}
        const {utterances}=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const folder=path.join(directory,voicesRoute[1]),prepared=path.join(folder,'result.json');
        const prep=JSON.parse(await fsp.readFile(prepared,'utf8'));
        if(!Array.isArray(utterances)||!utterances.length||utterances.length>300||utterances.some(row=>!Number.isInteger(row.id)||!Number.isInteger(row.start_ms)||!Number.isInteger(row.end_ms)||row.start_ms<0||row.end_ms>prep.duration_ms||row.end_ms<=row.start_ms||typeof row.en!=='string'||row.en.length>8000))throw Error('原音核对片段无效');
        if(!config.speakerModel||!fs.existsSync(config.speakerModel))throw Error('本地说话人模型缺失，请安装完整更新包');
        const key=crypto.createHash('sha256').update(JSON.stringify({version:1,utterances,regions:prep.speech_regions,model:path.basename(config.speakerModel)})).digest('hex');
        const requestFile=path.join(folder,'voices-'+key+'.json'),resultFile=requestFile.replace(/\.json$/,'.result.json');
        if(!fs.existsSync(resultFile)){
          await fsp.writeFile(requestFile,JSON.stringify({utterances}));
          await new Promise((resolve,reject)=>{
            const child=spawn(config.python,[path.join(resources,'voice-embedding.py'),'--audio',path.join(folder,'audio.wav'),'--model',config.speakerModel,'--prepared',prepared,'--request',requestFile],{windowsHide:true,stdio:['ignore','ignore','pipe']});
            let diagnostic='';child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk).slice(-1000);});
            child.on('error',reject);child.on('exit',code=>code?reject(Error('原音说话人核对失败 '+diagnostic)):resolve());
          });
        }
        respond(res,200,JSON.parse(await fsp.readFile(resultFile,'utf8')));return;
      }
      const framesRoute=/^\/desktop\/video-prep\/([a-f0-9]{64})\/frames$/.exec(url.pathname);
      if(framesRoute && req.method==='POST') {
        const chunks=[];
        let bytes=0;
        for await(const chunk of req){bytes+=chunk.length;if(bytes>65536)throw Error('逐句时间码过多');chunks.push(chunk);}
        const {times}=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const folder=path.join(directory,framesRoute[1]);
        const prep=JSON.parse(await fsp.readFile(path.join(folder,'result.json'),'utf8'));
        if(!Array.isArray(times)||times.length>300||times.some(t=>!Number.isInteger(t)||t<0||t>=prep.duration_ms))
          throw Error('逐句时间码无效');
        const requestFile=path.join(folder,'frames-'+crypto.createHash('sha256').update(JSON.stringify(times)).digest('hex')+'.json');
        const resultFile=requestFile.replace(/\.json$/,'.result.json');
        if(!fs.existsSync(resultFile)){
          await fsp.writeFile(requestFile,JSON.stringify({times}));
          await new Promise((resolve,reject)=>{
            const child=spawn(config.python,[path.join(resources,'video-evidence.py'),'--video',path.join(folder,'source.video'),
              '--out',folder,'--ffmpeg',path.join(runtime,'ffmpeg','ffmpeg.exe'),'--frame-request',requestFile],{windowsHide:true,stdio:['ignore','ignore','pipe']});
            let error='';child.stderr.on('data',chunk=>{error=(error+chunk).slice(-800);});
            child.on('error',reject);child.on('exit',code=>code?reject(Error('逐句画面处理失败 '+error)):resolve());
          });
        }
        const value=JSON.parse(await fsp.readFile(resultFile,'utf8'));
        respond(res,200,value);return;
      }
      const match=/^\/desktop\/video-prep\/([a-f0-9]{64})$/.exec(url.pathname);
      if(match && req.method==='GET') {
        const folder=path.join(directory,match[1]), result=path.join(folder,'result.json');
        if(ready(result)){
          res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
          fs.createReadStream(result).pipe(res);return;
        }
        const state=path.join(folder,'progress.json');
        let progress=jobs.get(match[1]);
        if(progress?.error){respond(res,422,progress);return;}
        if(fs.existsSync(state))progress=JSON.parse(await fsp.readFile(state,'utf8'));
        if(!progress){respond(res,404,{error:'未找到原音处理任务，请重试'});return;}
        respond(res,progress.error?422:202,progress);return;
      }
      respond(res,404,{error:'未找到视频处理接口'});
    } catch(error) {if(!res.headersSent)respond(res,400,{error:error.message});else res.destroy();}
  };
}
module.exports={createHandler};
