"""Install the in-place drama workshop, preserving an exact backup of changed files."""
from pathlib import Path
from datetime import datetime
import argparse, shutil, json

def install(root):
    root=Path(root).resolve()
    version=(root/'current.txt').read_text('utf-8-sig').strip()
    if not __import__('re').fullmatch(r'\d+\.\d+\.\d+',version):
        raise ValueError('Invalid installed version')
    target=root/'versions'/version
    assets=target/'web'/'dist'/'assets'
    here=Path(__file__).resolve().parent
    backup=root/'cache'/'workshop-backups'/datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    updates={assets/name:(here/'src'/name).read_bytes() for name in (
        'drama-workshop.js','drama-workshop-core.js','drama-workshop.css',
        'skill-agent.js','floating-agent.js','themed-select.js','project-bundles.js','project-bundle-core.js')}
    index=assets.parent/'index.html'
    html=index.read_text('utf8')
    if '/assets/drama-workshop.js' not in html:
        assert '</body>' in html
        html=html.replace('</body>','<script type="module" src="/assets/drama-workshop.js"></script>\n</body>')
    updates[index]=html.encode('utf8')
    updates[target/'app'/'resources'/'project_bundle.py']=(here/'project_bundle.py').read_bytes()
    manifest=[]
    for path,data in updates.items():
        if path.exists() and path.read_bytes()==data: continue
        saved=backup/path.relative_to(target)
        if path.exists():
            saved.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(path,saved)
        path.parent.mkdir(parents=True,exist_ok=True)
        tmp=path.with_name(path.name+'.workshop-writing')
        tmp.write_bytes(data);tmp.replace(path)
        manifest.append({'file':str(path),'backup':str(saved)})
    backup.mkdir(parents=True,exist_ok=True)
    (backup/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),'utf8')
    print(json.dumps({'version':version,'updated':len(manifest),'backup':str(backup)},ensure_ascii=False))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--install-root',required=True)
    install(parser.parse_args().install_root)
