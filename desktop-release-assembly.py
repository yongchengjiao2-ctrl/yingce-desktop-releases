"""GitHub runner: reconstruct only verified files, upload to the existing draft."""
import hashlib,http.client,json,os,pathlib,re,shutil,struct,subprocess,urllib.parse,zipfile
root=pathlib.Path.cwd()
tag=os.environ['TARGET_TAG'];expected=os.environ['PATCH_SHA256'].upper()
assert tag=='desktop-v1.3.17' and re.fullmatch('[A-F0-9]{64}',expected)
repo=os.environ['GITHUB_REPOSITORY']
def gh(*args):return subprocess.check_output(['gh',*args],text=True)
releases=json.loads(gh('api',f'repos/{repo}/releases?per_page=30'))
release=next(item for item in releases if item['tag_name']==tag)
assert release['draft'],'Assembly may not modify a public release'
incoming=root/'incoming';incoming.mkdir()
for version,name in [('desktop-v1.3.16','Yingce-1.3.16-win-x64.zip'),(tag,'assembly-input-1.3.17.zip')]:
    selected=next(item for item in releases if item['tag_name']==version)
    asset=next(item for item in selected['assets'] if item['name']==name)
    with (incoming/name).open('wb') as destination:
        subprocess.run(['gh','api',asset['url'],'-H','Accept: application/octet-stream'],stdout=destination,check=True)
def sha(file):
    with file.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest().upper()
base=incoming/'Yingce-1.3.16-win-x64.zip';patch=incoming/'assembly-input-1.3.17.zip'
assert sha(base)=='BA04F8F9E7C17AE56D72D1788F83FE7AA806620BC646B2ABBCE8996DDF1BB8E2'
assert sha(patch)==expected,'Assembly input checksum mismatch'
stage=root/'assembled';stage.mkdir()
def target(name):
    value=(stage/name).resolve()
    assert value.is_relative_to(stage.resolve()) and value!=stage.resolve(),'Invalid archive path'
    return value
def extract(bundle):
    for entry in bundle.infolist():
        destination=target(entry.filename)
        if entry.is_dir():destination.mkdir(parents=True,exist_ok=True);continue
        destination.parent.mkdir(parents=True,exist_ok=True)
        with bundle.open(entry) as src,destination.open('wb') as dst:shutil.copyfileobj(src,dst)
with zipfile.ZipFile(base) as bundle:extract(bundle)
with zipfile.ZipFile(patch) as bundle:
    config=json.loads(bundle.read('.assembly/input.json'))
    manifest=config['manifest']
    assert manifest['version']=='1.3.17'
    allowed={item['path'] for item in manifest['files']}
    for entry in bundle.infolist():
        if entry.filename.startswith('.assembly/'):continue
        assert entry.filename in allowed,'Unexpected patch entry'
        destination=target(entry.filename);destination.parent.mkdir(parents=True,exist_ok=True)
        with bundle.open(entry) as src,destination.open('wb') as dst:shutil.copyfileobj(src,dst)
    for item in config['sparse']:
        assert item['path'] in allowed
        file=target(item['path']);assert sha(file)==item['baseSha256']
        with bundle.open(item['entry']) as src,file.open('r+b') as dst:
            assert src.read(4)==b'YCS1';dst.truncate(struct.unpack('<Q',src.read(8))[0])
            while data:=src.read(12):
                offset,size=struct.unpack('<QI',data);chunk=src.read(size);assert len(chunk)==size
                dst.seek(offset);dst.write(chunk)
for item in manifest['files']:
    file=target(item['path']);assert file.stat().st_size==item['size'] and sha(file)==item['sha256'].upper(),'File verification failed: '+item['path']
output=root/'output';output.mkdir()
inner={k:v for k,v in manifest.items() if k not in ('archive','archiveSha256')}
archive=output/'Yingce-1.3.17-win-x64.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=1) as bundle:
    for item in manifest['files']:bundle.write(target(item['path']),item['path'])
    bundle.writestr('latest.json',json.dumps(inner,ensure_ascii=False))
with zipfile.ZipFile(archive) as bundle:assert bundle.testzip() is None
manifest.update(archive=archive.name,archiveSha256=sha(archive))
(output/'latest.json').write_text(json.dumps(manifest,ensure_ascii=False),encoding='utf-8')
(output/(archive.name+'.sha256')).write_text(manifest['archiveSha256']+'  '+archive.name+'\n')
for old,new in [('install.ps1','install.ps1'),('安装或更新.cmd','install.cmd'),('使用说明.md','instructions.md')]:shutil.copy2(target(old),output/new)
for file in output.iterdir():
    current=json.loads(gh('api',f'repos/{repo}/releases/{release["id"]}'))
    assert current['draft'],'Release changed while assembly was running'
    for asset in current['assets']:
        if asset['name']==file.name:gh('api','--method','DELETE',asset['url'])
    url=urllib.parse.urlsplit(current['upload_url'].split('{')[0]+'?name='+urllib.parse.quote(file.name))
    assert url.hostname=='uploads.github.com'
    connection=http.client.HTTPSConnection(url.hostname,timeout=1800)
    connection.putrequest('POST',url.path+'?'+url.query)
    for key,value in {'Authorization':'Bearer '+os.environ['GH_TOKEN'],'User-Agent':'Yingce-Release-Assembler','Content-Type':'application/octet-stream','Content-Length':str(file.stat().st_size)}.items():connection.putheader(key,value)
    connection.endheaders()
    with file.open('rb') as stream:
        while chunk:=stream.read(1<<20):connection.send(chunk)
    response=connection.getresponse();body=response.read();assert response.status==201,'Release upload failed: '+str(response.status)
    uploaded=json.loads(body);assert uploaded['size']==file.stat().st_size and uploaded.get('digest')=='sha256:'+sha(file).lower()
    connection.close()
print(json.dumps({'files':len(manifest['files']),'sha256':manifest['archiveSha256'],'bytes':archive.stat().st_size,'draft':True}))