"""Fresh-directory, real-backend acceptance; no calls to paid providers."""
from pathlib import Path
import argparse
import base64
import importlib.util
import json
import os
import socket
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request
import uuid

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
OUTPUT=ROOT/'cache/release-1.3.19'
STAGE=OUTPUT/'stage'
spec=importlib.util.spec_from_file_location('bundle',HERE/'project_bundle.py');bundle=importlib.util.module_from_spec(spec);spec.loader.exec_module(bundle)

class Backend:
    def __init__(self,data):self.data=data
    def __enter__(self):
        s=socket.socket();s.bind(('127.0.0.1',0));self.port=s.getsockname()[1];s.close();self.token=uuid.uuid4().hex*2
        self.data.mkdir(parents=True,exist_ok=True)
        env={**os.environ,'GIN_MODE':'release','CANVAS_DESKTOP_MODE':'1','CANVAS_DESKTOP_TOKEN':self.token,'CANVAS_BACKEND_ADDR':'127.0.0.1:'+str(self.port),'CANVAS_BACKEND_DATA_DIR':str(self.data),'CANVAS_OFFICIAL_PLUGIN_DIR':str(STAGE/'plugin-packages'),'CANVAS_REGISTRATION_ENABLED':'false'}
        self.log=(self.data.parent/'backend-test.log').open('wb')
        self.proc=subprocess.Popen([str(STAGE/'runtime/canvas-backend.exe')],env=env,cwd=STAGE,stdout=self.log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
        self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for _ in range(100):
            if self.proc.poll() is not None:raise RuntimeError('Test backend exited; see test log')
            try:self.user=self.request('/auth/session')['user']['id'];return self
            except (OSError,ValueError):time.sleep(.1)
        raise RuntimeError('Test backend did not start')
    def request(self,path,method='GET',data=None):
        req=urllib.request.Request('http://127.0.0.1:'+str(self.port)+'/api'+path,method=method,data=json.dumps(data).encode() if data is not None else None,headers={'x-canvas-desktop-token':self.token,'Content-Type':'application/json'})
        try:
            with self.opener.open(req,timeout=5) as r:res=json.load(r)
        except urllib.error.HTTPError as exc:res=json.load(exc)
        if res.get('code')!=0:raise ValueError('API rejected '+path+': '+str(res.get('msg')))
        return res['data']
    def __exit__(self,*args):
        self.proc.terminate();self.proc.wait(timeout=15);self.log.close()

def run(round_no):
    folder=OUTPUT/'qa'/('round-'+str(round_no));folder.mkdir(parents=True,exist_ok=True)
    # A new round must never reuse a previous profile or database.
    source=folder/('source-'+uuid.uuid4().hex[:8]);target=folder/('target-'+uuid.uuid4().hex[:8]);checks=[]
    for command,label in [(['node','--test',*map(str,(HERE/'tests').glob('*.test.js'))],'frontend regression'),(['python','-m','unittest','discover','-s',str(HERE/'tests'),'-p','test_*.py','-v'],'ZIP and installer safety')]:
        p=subprocess.run(command,cwd=HERE,capture_output=True)
        (folder/(label.replace(' ','-')+'.log')).write_bytes(p.stdout+p.stderr)
        assert p.returncode==0,label+' failed';checks.append(label)
    with Backend(source/'data') as src, Backend(target/'data') as dst:
        project=src.request('/projects','POST',{'name':'第 '+str(round_no)+' 轮验收项目','type':'short-drama','aspectRatio':'9:16','sourceType':'blank'})['project'];pid=project['id']
        rich='<h2>场景一 · 清晨</h2><p><strong>人物：林岚</strong>走进书店。</p><ol><li>推门</li><li>停步</li></ol><blockquote>保持对白自然。</blockquote>'
        first=src.request('/projects/'+pid+'/units','POST',{'kind':'chapter','title':'第 1 集','sourceText':rich,'position':0})['unit'];cid=first['id']
        read=src.request('/projects/'+pid+'/units/'+cid)['unit'];assert read['sourceText']==rich;checks.append('new chapter rich-text readback')
        second=src.request('/projects/'+pid+'/units','POST',{'kind':'chapter','title':'第 2 集','sourceText':'<p>第二章</p>','position':1})['unit']
        units=src.request('/projects/'+pid+'/units')['units'];assert [u['id'] for u in units]==[cid,second['id']];checks.append('chapter list and order')
        after=rich+'<p><em>追加段落</em></p>';src.request('/projects/'+pid+'/units/'+cid,'PATCH',{'sourceText':after});assert src.request('/projects/'+pid+'/units/'+cid)['unit']['sourceText']==after;checks.append('append preserves formatting')
        canvas=uuid.uuid4().hex
        c=sqlite3.connect(source/'data/open_ai_canvas.db');now='2026-11-06 00:00:00+08:00'
        resource=uuid.uuid4().hex;object_key='users/'+src.user+'/image/fixture.png'
        image=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7p8AAAAASUVORK5CYII=')
        image_path=source/'data/resources'/object_key;image_path.parent.mkdir(parents=True,exist_ok=True);image_path.write_bytes(image)
        c.execute('INSERT INTO resources(id,user_id,kind,status,provider,object_key,mime_type,size,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',(resource,src.user,'image','ready','local',object_key,'image/png',len(image),now,now))
        c.execute('UPDATE projects SET cover_resource_id=? WHERE id=?',(resource,pid))
        payload={'id':canvas,'name':'验收画布','nodes':[{'id':'fixture-text-node','type':'text','x':80,'y':80,'width':300,'height':200,'data':{'text':'画布内容'}}],'connections':[],'chatSessions':[{'id':'canvas-chat-fixture','title':'画布讨论','messages':[{'role':'assistant','content':'画布历史'}]}],'activeChatId':'canvas-chat-fixture'}
        c.execute('INSERT INTO canvas_projects(id,user_id,project_id,title,payload_json,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',(canvas,src.user,pid,'验收画布',json.dumps(payload),1,now,now));c.commit();c.close()
        front={'yingce-skill-agent-v1':[{'id':uuid.uuid4().hex,'scope':src.user,'projectId':pid,'chapterId':cid,'title':'编剧讨论','createdAt':now,'updatedAt':now,'skillIds':[],'references':[],'messages':[{'id':uuid.uuid4().hex,'role':'user','content':'写一场书店戏','status':'done'},{'id':uuid.uuid4().hex,'role':'assistant','content':'## 书店相遇\n\n**林岚**推开门。\n\n1. 推门\n2. 停步','status':'succeeded'}],'writes':[]}],'creation-conversations-v1':[],'yingce-chapter-outputs-v1':[]}
        archive=folder/'fixture-project.zip';result=bundle.export_bundle(source,src.user,front,archive,pid);assert result['counts']['projects']==1 and result['counts']['project_units']==2 and result['counts']['canvas_projects']==1;checks.append('single-project ZIP export')
        imported=bundle.import_bundle(target,dst.user,archive);projects=dst.request('/projects')['projects'];newpid=projects[0]['project']['id'];assert newpid!=pid
        restored=dst.request('/projects/'+newpid+'/units')['units'];assert len(restored)==2;assert dst.request('/projects/'+newpid+'/units/'+restored[0]['id'])['unit']['sourceText']==after;assert imported['frontend']['yingce-skill-agent-v1'][0]['projectId']==newpid
        canvases=dst.request('/canvas-projects?page=1&pageSize=50')['projects'];assert len(canvases)==1;canvasDetail=dst.request('/canvas-projects/'+canvases[0]['id'])['project'];assert canvasDetail['chatSessions'][0]['messages'][0]['content']=='画布历史';checks.append('fresh-account import chapters/canvas/chat associations')
        restored_resource=projects[0]['project']['coverResourceId'];req=urllib.request.Request('http://127.0.0.1:'+str(dst.port)+'/api/resources/'+restored_resource+'/file',headers={'x-canvas-desktop-token':dst.token})
        with dst.opener.open(req,timeout=5) as media:assert media.read()==image
        checks.append('imported image is served by the real target backend')
        bundle.import_bundle(target,dst.user,archive);assert len(dst.request('/projects')['projects'])==2;checks.append('repeated import keeps existing project')
    report={'round':round_no,'passed':True,'checks':checks,'runtimeRoot':str(STAGE),'source':str(source),'target':str(target),'projectId':pid,'chapterId':cid,'frontend':front,'archive':str(archive)}
    (folder/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps({'round':round_no,'passed':True,'checks':checks,'source':str(source)},ensure_ascii=True),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--round',type=int,required=True);p.add_argument('--runtime-root');args=p.parse_args();STAGE=Path(args.runtime_root).resolve() if args.runtime_root else STAGE;run(args.round)
