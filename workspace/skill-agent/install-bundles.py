"""Idempotently install the desktop ZIP endpoint without discarding existing patches."""
import json
import shutil
import struct
from pathlib import Path
from datetime import datetime

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
VERSION=(ROOT/'current.txt').read_text(encoding='utf-8-sig').strip()
RES=ROOT/'versions'/VERSION/'app/resources'
ASAR=RES/'app.asar'
raw=ASAR.read_bytes();h=struct.unpack('<4I',raw[:16]);header=json.loads(raw[16:16+h[3]])
content={}
def read(entries,prefix=''):
 for name,e in entries.items():
  key=prefix+name
  if 'files' in e:read(e['files'],key+'/')
  elif 'offset' in e:content[key]=raw[8+h[1]+int(e['offset']):8+h[1]+int(e['offset'])+e['size']]
read(header['files'])
main=content['main.cjs'].decode('utf8')
if "'/desktop/project-bundles/'" not in main:
 anchor="    if (req.url.startsWith('/api/')) {"
 assert main.count(anchor)==1,'Desktop route anchor changed'
 main=main.replace(anchor,"    if (req.url.startsWith('/desktop/project-bundles/')) { require(path.join(process.resourcesPath,'project-bundles.cjs')).handle(req,res,{local,runtime,resources:process.resourcesPath,backendPort,token}); return; }\n"+anchor)
 content['main.cjs']=main.encode('utf8')
 offset=0
 def update(entries,prefix=''):
  global offset
  for name,e in entries.items():
   key=prefix+name
   if 'files' in e:update(e['files'],key+'/')
   elif key in content:
    e['size']=len(content[key]);e['offset']=str(offset);e.pop('integrity',None);offset+=len(content[key])
 update(header['files'])
 encoded=json.dumps(header,separators=(',',':'),ensure_ascii=False).encode('utf8')
 padded=(len(encoded)+3)//4*4
 new=struct.pack('<4I',4,8+padded,4+padded,len(encoded))+encoded+b'\0'*(padded-len(encoded))+b''.join(content.values())
 backup=HERE/'backups'/datetime.now().strftime('%Y%m%d-%H%M%S-bundles');backup.mkdir(parents=True,exist_ok=True);shutil.copy2(ASAR,backup/'app.asar')
 temp=ASAR.with_suffix('.pending');temp.write_bytes(new)
 try:temp.replace(ASAR)
 except PermissionError:print('Desktop is running: staged app.pending for the next launch.')
for name in ['project-bundles.cjs','project_bundle.py']:
 shutil.copy2(HERE/name,RES/name)
print('Project ZIP endpoint installed; restart Yingce to load it.')
