"""Trusted release installation using bundled Python and Windows long paths."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import zipfile

def native(path):
    path=os.path.abspath(path)
    if os.name=='nt' and not path.startswith('\\\\?\\'):
        return '\\\\?\\UNC\\'+path[2:] if path.startswith('\\\\') else '\\\\?\\'+path
    return path

def target(root,name):
    p=PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts or '\\' in name or ':' in name:
        raise ValueError('Invalid release path: '+name)
    return native(os.path.join(root,*p.parts))

def digest(path):
    h=hashlib.sha256()
    with open(native(path),'rb') as f:
        while chunk:=f.read(4*1024*1024):h.update(chunk)
    return h.hexdigest()

def extract(archive,destination):
    os.makedirs(native(destination),exist_ok=True)
    with zipfile.ZipFile(native(archive)) as z:
        if len(z.namelist())!=len(set(z.namelist())):raise ValueError('Duplicate release entries')
        for i,item in enumerate(z.infolist()):
            path=target(destination,item.filename)
            if item.is_dir():os.makedirs(path,exist_ok=True);continue
            os.makedirs(os.path.dirname(path),exist_ok=True)
            with z.open(item) as src,open(path,'wb') as dst:shutil.copyfileobj(src,dst,4*1024*1024)
            if i%5000==0:print('Extracting release:',i,flush=True)

def files(root):
    with open(target(root,'latest.json'),encoding='utf-8-sig') as f:manifest=json.load(f)
    if not manifest.get('files'):raise ValueError('Empty release manifest')
    for item in manifest['files']:
        name=item['path']
        if not name.startswith(('app/','runtime/','web/','backend/','plugin-packages/')) and name not in ('release.json','install.ps1','安装或更新.cmd','使用说明.md','update.cmd'):
            raise ValueError('Disallowed release path: '+name)
        target(root,name)
    return manifest['files']

def verify(root):
    entries=files(root)
    for i,item in enumerate(entries):
        if digest(target(root,item['path']))!=item['sha256']:raise ValueError('Release checksum mismatch: '+item['path'])
        if i%5000==0:print('Verifying release:',i,'/',len(entries),flush=True)

def install(root,destination):
    entries=files(root)
    for i,item in enumerate(entries):
        src=target(root,item['path']);dst=target(destination,item['path'])
        if os.path.isfile(dst) and digest(dst)==item['sha256']:continue
        os.makedirs(os.path.dirname(dst),exist_ok=True)
        temp=dst+'.installing';shutil.copyfile(src,temp)
        if digest(temp)!=item['sha256']:raise ValueError('Installed checksum mismatch: '+item['path'])
        os.replace(temp,dst)
        if i%5000==0:print('Installing release:',i,'/',len(entries),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['extract','verify','install']);p.add_argument('--archive');p.add_argument('--root',required=True);p.add_argument('--destination');a=p.parse_args()
    if a.action=='extract':extract(a.archive,a.root)
    elif a.action=='verify':verify(a.root)
    elif a.action=='install':install(a.root,a.destination)
