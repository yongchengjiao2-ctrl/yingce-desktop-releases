"""Build an audited portable release from the installed runtime plus readable patches."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import struct
import zipfile

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
INSTALL=REPO.parent
VERSION='1.3.19'
OUTPUT=INSTALL/'cache'/'release-1.3.19'
STAGE=OUTPUT/'stage'

def atomic_write(path,data):
    path=Path(path);tmp=path.with_name(path.name+'.writing');tmp.write_bytes(data);tmp.replace(path)

def modify_asar(data):
    h=struct.unpack('<4I',data[:16]);header=json.loads(data[16:16+h[3]]);contents={}
    def read(entries,prefix=''):
        for name,e in entries.items():
            key=prefix+name
            if 'files' in e:read(e['files'],key+'/')
            elif 'offset' in e:contents[key]=data[8+h[1]+int(e['offset']):8+h[1]+int(e['offset'])+e['size']]
    read(header['files'])
    main=contents['main.cjs'].decode('utf8')
    anchor="    if (req.url.startsWith('/api/')) {"
    if "'/desktop/project-bundles/'" not in main:
        assert main.count(anchor)==1
        main=main.replace(anchor,"    if (req.url.startsWith('/desktop/project-bundles/')) { require(path.join(process.resourcesPath,'project-bundles.cjs')).handle(req,res,{local,runtime,resources:process.resourcesPath,backendPort,token}); return; }\n"+anchor)
    main=main.replace('1.3.18',VERSION)
    contents['main.cjs']=main.encode('utf8')
    package=json.loads(contents['package.json']);package['version']=VERSION;contents['package.json']=json.dumps(package,ensure_ascii=False).encode('utf8')
    if 'loading.html' in contents:contents['loading.html']=contents['loading.html'].replace(b'1.3.18',VERSION.encode())
    offset=0
    def update(entries,prefix=''):
        nonlocal offset
        for name,e in entries.items():
            key=prefix+name
            if 'files' in e:update(e['files'],key+'/')
            elif key in contents:e['size']=len(contents[key]);e['offset']=str(offset);offset+=len(contents[key]);e.pop('integrity',None)
    update(header['files']);encoded=json.dumps(header,separators=(',',':'),ensure_ascii=False).encode('utf8');padded=(len(encoded)+3)//4*4
    return struct.pack('<4I',4,8+padded,4+padded,len(encoded))+encoded+b'\0'*(padded-len(encoded))+b''.join(contents.values())

def stage():
    base=INSTALL/'versions'/'1.3.18';STAGE.mkdir(parents=True,exist_ok=True)
    count=0
    for name in ('app','runtime','web','backend','plugin-packages'):
        for src in (base/name).rglob('*'):
            if not src.is_file() or '__pycache__' in src.parts or src.suffix in ('.log','.pending','.writing') or src.name.startswith('.env'):continue
            dest=STAGE/src.relative_to(base);dest.parent.mkdir(parents=True,exist_ok=True)
            if dest.exists():dest.unlink()
            try:os.link(src,dest)
            except OSError:shutil.copy2(src,dest)
            count+=1
    for src in (HERE/'src').iterdir():
        if src.is_file():atomic_write(STAGE/'web/dist/assets'/src.name,src.read_bytes())
    for name in ('project-bundles.cjs','project_bundle.py'):atomic_write(STAGE/'app/resources'/name,(HERE/name).read_bytes())
    atomic_write(STAGE/'backend/desktop-state/portable-install.py',(HERE/'portable-install.py').read_bytes())
    atomic_write(STAGE/'app/resources/app.asar',modify_asar((base/'app/resources/app.asar').read_bytes()))
    atomic_write(STAGE/'release.json',json.dumps({'version':VERSION,'portable':True,'capturedFrom':'1.3.18'},indent=2).encode())
    atomic_write(STAGE/'install.ps1',(REPO/'install.ps1').read_bytes())
    atomic_write(STAGE/'安装或更新.cmd',b'@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -FeedRoot "%~dp0"\r\nif errorlevel 1 pause\r\n')
    atomic_write(STAGE/'使用说明.md',(REPO/'使用说明.md').read_bytes())
    index=STAGE/'web/dist/index.html';s=index.read_text(encoding='utf8')
    for module in ('skill-agent.js','project-bundles.js'):
        if '/assets/'+module not in s:s=s.replace('</body>','<script type="module" src="/assets/'+module+'"></script>\n</body>')
    atomic_write(index,s.encode('utf8'))
    print(json.dumps({'stage':str(STAGE),'files':count}),flush=True)

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        while chunk:=f.read(4*1024*1024):h.update(chunk)
    return h.hexdigest()

def archive():
    files=[]
    previous=STAGE/'latest.json';cached={};cached_at=0
    if previous.exists():
        try:
            cached={r['path']:r for r in json.loads(previous.read_text(encoding='utf8'))['files']};cached_at=previous.stat().st_mtime_ns
        except (ValueError,KeyError):pass
    for p in sorted(STAGE.rglob('*')):
        if not p.is_file() or p.name=='latest.json' or '__pycache__' in p.parts:continue
        relative=p.relative_to(STAGE).as_posix()
        assert relative.startswith(('app/','runtime/','web/','backend/','plugin-packages/')) or relative in ('install.ps1','release.json','安装或更新.cmd','使用说明.md'),relative
        assert Path(relative).parts[0] not in ('data','desktop-profile','exports'),relative
        assert 'qa-fixture' not in relative,relative
        stat=p.stat();old=cached.get(relative)
        sha=old['sha256'] if old and old['size']==stat.st_size and stat.st_mtime_ns<=cached_at else digest(p)
        files.append({'path':relative,'size':stat.st_size,'sha256':sha})
        if len(files)%5000==0:print('Hashing release:',len(files),flush=True)
    manifest={'version':VERSION,'files':files}
    atomic_write(STAGE/'latest.json',json.dumps(manifest,ensure_ascii=False,separators=(',',':')).encode('utf8'))
    path=OUTPUT/('Yingce-'+VERSION+'-win-x64.zip')
    with zipfile.ZipFile(path.with_suffix('.partial'),'w',zipfile.ZIP_DEFLATED,compresslevel=1,allowZip64=True) as z:
        for i,item in enumerate(files):
            z.write(STAGE/item['path'],item['path'])
            if i%5000==0:print('Compressing release:',i,flush=True)
        z.write(STAGE/'latest.json','latest.json')
    path.with_suffix('.partial').replace(path)
    manifest.update(archive=path.name,archiveSha256=digest(path))
    atomic_write(OUTPUT/'latest.json',json.dumps(manifest,ensure_ascii=False,separators=(',',':')).encode('utf8'))
    print(json.dumps({'archive':str(path),'bytes':path.stat().st_size,'sha256':manifest['archiveSha256'],'files':len(files)}),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--stage',action='store_true');p.add_argument('--archive',action='store_true');a=p.parse_args()
    if a.stage:stage()
    if a.archive:archive()
