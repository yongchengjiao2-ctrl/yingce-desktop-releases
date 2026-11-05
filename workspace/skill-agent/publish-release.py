"""Publish validated release artifacts using the user's existing Git credential."""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
OUT=REPO.parent/'cache/release-1.3.19'
NAME='yongchengjiao2-ctrl/yingce-desktop-releases'
TAG='desktop-v1.3.19'

def credentials():
    p=subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',capture_output=True,text=True,check=True)
    values=dict(s.split('=',1) for s in p.stdout.splitlines() if '=' in s)
    if not values.get('password'):raise RuntimeError('GitHub credential unavailable')
    return values['password']

def api(token,path,method='GET',data=None):
    req=urllib.request.Request('https://api.github.com/repos/'+NAME+path,method=method,data=json.dumps(data).encode() if data is not None else None,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','User-Agent':'Yingce-Release','Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=90) as r:return None if r.status==204 else json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError('GitHub API '+method+' '+path+' returned '+str(e.code)) from None

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        while chunk:=f.read(4*1024*1024):h.update(chunk)
    return h.hexdigest()

def validate():
    reports=[]
    for n in (1,2,3):
        d=json.loads((OUT/'qa'/('round-'+str(n))/'report.json').read_text(encoding='utf8'));assert d['passed'];reports.append({'round':n,'passed':True,'checks':d['checks']})
        if n==3:
            fresh=OUT/'新电脑 安装验收';assert Path(d['runtimeRoot']).resolve()==(fresh/'versions/1.3.19').resolve();assert (fresh/'current.txt').read_text().strip()=='1.3.19'
    ui=json.loads((OUT/'qa/desktop-ui.json').read_text(encoding='utf8'));assert ui['passed']
    manifest=json.loads((OUT/'latest.json').read_text(encoding='utf8'));assert manifest['version']=='1.3.19';archive=OUT/manifest['archive'];assert sha(archive)==manifest['archiveSha256']
    assert archive.stat().st_size<2*1024**3,'Release asset exceeds GitHub limit'
    public={'version':'1.3.19','passed':True,'automatedTestsPerRound':24,'rounds':reports,'desktop':ui,'freshInstallation':{'passed':True,'unicodeAndSpacePath':True,'bundledRuntime':True},'archiveSha256':manifest['archiveSha256'],'limitations':['External model providers require the user’s own configured credentials. No paid model calls were made.','Clean Windows directories were tested on the current host; all possible hardware and service combinations were not tested.']}
    report=OUT/'acceptance-v1.3.19.json';report.write_text(json.dumps(public,ensure_ascii=False,indent=2),encoding='utf8')
    return [archive,OUT/'latest.json',REPO/'install.cmd',REPO/'install.ps1',REPO/'instructions.md',REPO/'release-notes-v1.3.19.md',report]

def upload(token,release,path):
    url=release['upload_url'].split('{',1)[0]+'?'+urllib.parse.urlencode({'name':path.name})
    size=path.stat().st_size
    def chunks(f):
        total=0;last=0
        while chunk:=f.read(4*1024*1024):
            total+=len(chunk)
            if total-last>=64*1024*1024:print('Uploading',path.name,total,'/',size,flush=True);last=total
            yield chunk
    with path.open('rb') as f:
        req=urllib.request.Request(url,data=chunks(f),method='POST',headers={'Authorization':'Bearer '+token,'User-Agent':'Yingce-Release','Content-Type':'application/zip' if path.suffix=='.zip' else 'application/octet-stream','Content-Length':str(size)})
        with urllib.request.urlopen(req,timeout=1800) as r:result=json.load(r)
    assert result['size']==size
    if result.get('digest'):assert result['digest']=='sha256:'+sha(path),'Remote asset digest mismatch'
    print('Uploaded',path.name,size,flush=True);return result

def main(commit):
    paths=validate();token=credentials()
    releases=api(token,'/releases?per_page=100');existing=next((r for r in releases if r['tag_name']==TAG),None)
    if existing and not existing['draft']:raise RuntimeError('This version is already public; refusing to replace it')
    release=existing or api(token,'/releases','POST',{'tag_name':TAG,'target_commitish':commit,'name':'影策 v1.3.19 · Skill 对话与项目迁移','body':(REPO/'release-notes-v1.3.19.md').read_text(encoding='utf8'),'draft':True,'prerelease':False})
    release=api(token,'/releases/'+str(release['id']),'PATCH',{'target_commitish':commit,'body':(REPO/'release-notes-v1.3.19.md').read_text(encoding='utf8')})
    (OUT/'draft-release.json').write_text(json.dumps({'id':release['id'],'url':release['html_url']}),encoding='utf8')
    assets=api(token,'/releases/'+str(release['id'])+'/assets')
    for path in paths:
        asset=next((a for a in assets if a['name']==path.name),None)
        if asset:
            if asset['size']==path.stat().st_size and asset.get('digest')=='sha256:'+sha(path):continue
            # Only this still-private draft is ours to repair; never change public assets.
            api(token,'/releases/assets/'+str(asset['id']),'DELETE')
        upload(token,release,path)
    assets=api(token,'/releases/'+str(release['id'])+'/assets');assert {p.name for p in paths}.issubset({a['name'] for a in assets})
    release=api(token,'/releases/'+str(release['id']),'PATCH',{'draft':False,'make_latest':'true'})
    latest=api(token,'/releases/latest');assert latest['tag_name']==TAG
    result={'id':release['id'],'url':release['html_url'],'tag':TAG,'assets':[{'name':a['name'],'size':a['size'],'digest':a.get('digest')} for a in assets]}
    (OUT/'published-release.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(result,ensure_ascii=True),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--commit',required=True);p.add_argument('--upload-archive-only',action='store_true');a=p.parse_args()
    if a.upload_archive_only:
        token=credentials();manifest=json.loads((OUT/'latest.json').read_text(encoding='utf8'));archive=OUT/manifest['archive'];assert sha(archive)==manifest['archiveSha256']
        releases=api(token,'/releases?per_page=100');release=next((r for r in releases if r['tag_name']==TAG),None)
        if release and not release['draft']:raise RuntimeError('Refusing to alter public release')
        release=release or api(token,'/releases','POST',{'tag_name':TAG,'target_commitish':a.commit,'name':'影策 v1.3.19 · Skill 对话与项目迁移','body':(REPO/'release-notes-v1.3.19.md').read_text(encoding='utf8'),'draft':True,'prerelease':False})
        (OUT/'draft-release.json').write_text(json.dumps({'id':release['id'],'url':release['html_url']}),encoding='utf8')
        upload(token,release,archive)
        print('Archive uploaded to private draft; publication remains gated on round 3.',flush=True)
    else:main(a.commit)
