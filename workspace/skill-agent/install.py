"""Install the reviewable Agent module into this customized desktop distribution."""
from pathlib import Path
from datetime import datetime
import shutil, json, hashlib
from chapter_state_patch import repair_chapter_code

ROOT = Path(__file__).resolve().parent
# workspace/skill-agent -> workspace -> yingce-desktop-releases -> install root
DESKTOP_ROOT = ROOT.parent.parent.parent
INSTALLED_VERSION = (DESKTOP_ROOT / 'current.txt').read_text(encoding='utf-8-sig').strip()
assert __import__('re').fullmatch(r'\d+\.\d+\.\d+', INSTALLED_VERSION), 'Invalid installed version'
INSTALL = DESKTOP_ROOT / 'versions' / INSTALLED_VERSION
ASSETS = INSTALL / 'web' / 'dist' / 'assets'
CHAPTER = ASSETS / 'chapters-CeKTBaiU.js'
CREATE = ASSETS / 'create-CmZBSZ8T.js'
INDEX = ASSETS.parent / 'index.html'
stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
backup = ROOT / 'backups' / stamp
backup.mkdir(parents=True, exist_ok=True)
files = [INDEX, CHAPTER, CREATE] + [ASSETS / p.name for p in (ROOT / 'src').iterdir()]
manifest = []
for file in files:
    if file.exists():
        target = backup / file.name
        shutil.copy2(file, target)
        manifest.append({'file':str(file),'backup':str(target),'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})

s = repair_chapter_code(CHAPTER.read_text(encoding='utf-8'))
if 'connectChapterAgent as YSAConnect' not in s:
    marker = 'window.addEventListener(`yingce-video-chapter-saved`,saved);return()=>window.removeEventListener(`yingce-video-chapter-saved`,saved)},[J,V?.id,e.project.id,O,u])'
    assert s.count(marker) == 1, 'Chapter bridge anchor changed; no files installed'
    replacement = 'const agentCleanup=YSAConnect({editor:J,unit:V,projectId:e.project.id,dirty:O,screenplay:E,setSource:T,setScreenplay:D,clean:()=>k(!1),invalidate:()=>{u.invalidateQueries({queryKey:[`project`,e.project.id]});u.invalidateQueries({queryKey:[`project-unit`,e.project.id,V.id]});u.invalidateQueries({queryKey:[`project`,e.project.id,`units`]})}});window.addEventListener(`yingce-video-chapter-saved`,saved);return()=>{agentCleanup();window.removeEventListener(`yingce-video-chapter-saved`,saved)}},[J,V?.id,e.project.id,O,u,E,V?.screenplayText])'
    s = 'import{connectChapterAgent as YSAConnect}from"./chapter-agent-bridge.js";' + s.replace(marker,replacement)

creation = CREATE.read_text(encoding='utf-8')
if 'CreationSkillPicker as YSACreationSkillPicker' not in creation:
    model_anchor = 'e.mode===`text`?(0,Y.jsxs)(Y.Fragment,{children:['
    assert creation.count(model_anchor) == 1, 'Creation toolbar anchor changed'
    assert creation.count('textStreaming:Ie,setTextStreaming:Le') == 1, 'Creation conversation anchor changed'
    assert creation.count('h=await La()}catch(e)') == 1, 'Creation generation anchor changed'
    creation = 'import{CreationSkillPicker as YSACreationSkillPicker,mergeCreationSkills as YSAMergeCreationSkills}from"./creation-skill-picker.js";' + creation
    creation = creation.replace(model_anchor,model_anchor+'(0,Y.jsx)(YSACreationSkillPicker,{conversationId:e.skillConversationId,disabled:b}),')
    creation = creation.replace('textStreaming:Ie,setTextStreaming:Le','skillConversationId:z?.id,textStreaming:Ie,setTextStreaming:Le')
    creation = creation.replace('h=await La()}catch(e)','h=await La();c=await YSAMergeCreationSkills(z.id,c);m=c.flatMap(e=>e.skill?[e.skill]:[])}catch(e)')

creation = creation.replace('spotlightRadius:280','spotlightRadius:76').replace('var(--user-ink) 12%, transparent)','var(--user-ink) 5%, transparent)')
if 'CreationHistoryMenu as YSACreationHistoryMenu' not in creation:
    start = creation.index('(0,q.jsx)(b,{trigger:[`click`],placement:`bottomRight`,open:p===e.id')
    end_marker = 'children:(0,q.jsx)(M,{})})})'
    end = creation.index(end_marker,start)+len(end_marker)
    creation = creation[:start]+'(0,q.jsx)(YSACreationHistoryMenu,{conversation:e,open:p===e.id,onOpenChange:t=>m(t?e.id:null),onRename:te,onExport:e=>{Ji(e,_,y?.displayName||`我`),ee.success(`对话已导出为 Markdown`)},onDelete:o})'+creation[end:]
    creation = 'import{CreationHistoryMenu as YSACreationHistoryMenu}from"./creation-history-menu.js";' + creation
if 'persistCreationConversations as YSAPersistNative' not in creation:
    save_anchor='async function Sr(e){await Be(R()).setItem(Cr,JSON.stringify(xr(e)))}'
    assert creation.count(save_anchor)==1,'Native history save anchor changed'
    creation=creation.replace(save_anchor,'async function Sr(e){await YSAPersistNative(Be(R()),R(),xr(e))}')
    assert creation.count('return t}function xr(e)')==1,'Native history read anchor changed'
    creation=creation.replace('return t}function xr(e)','return YSAFilterNative(R(),t)}function xr(e)')
    assert creation.count('await Sr(a),D.current=a,E(a)')==1,'Native history deletion anchor changed'
    creation=creation.replace('await Sr(a),D.current=a,E(a)','await YSADeleteNative(Be(R()),R(),e.id,xr(a)),D.current=a,E(a)')
    creation=creation.replace('bn=e=>{let t=e.title.trim()','bn=e=>{if(e.messages.some(m=>m.status===`pending`||m.status===`streaming`)){n.warning(`请先停止此对话的生成，再删除记录`);return}let t=e.title.trim()')
    creation='import{persistCreationConversations as YSAPersistNative,filterDeletedConversations as YSAFilterNative,deleteCreationConversation as YSADeleteNative}from"./creation-history-storage.js";'+creation
if 'CreationOutputActions as YSACreationOutputActions' not in creation:
    begin=creation.index('children:(0,$.jsx)(Pi,{item:e')+len('children:')
    end_marker='onEditUserMessage:e=>{j(e),window.requestAnimationFrame(()=>Qe.current?.focus())}})'
    end=creation.index(end_marker,begin)+len(end_marker)
    original=creation[begin:end]
    creation=creation[:begin]+'(0,$.jsx)(YSACreationOutputActions,{conversation:z,message:e,children:'+original+'})'+creation[end:]
    creation=creation.replace('function oa({shots:e,','function oa({conversation:ysConversation,shots:e,')
    assert creation.count('oa,{onNewConversation:_n')==1,'Conversation toolbar caller changed'
    creation=creation.replace('oa,{onNewConversation:_n','oa,{conversation:z,onNewConversation:_n')
    marker='className:`creation-toolbar-actions`,children:['
    assert creation.count(marker)==1,'Conversation toolbar changed'
    creation=creation.replace(marker,marker+'(0,Y.jsx)(YSASaveCreationConversation,{conversation:ysConversation}),')
    creation='import{CreationOutputActions as YSACreationOutputActions,SaveCreationConversation as YSASaveCreationConversation}from"./creation-output-actions.js";'+creation

if 'Pi as YingceConversationMessage' not in creation:
    creation += '\nexport{Pi as YingceConversationMessage};\n'
index = INDEX.read_text(encoding='utf-8')
if '/assets/project-bundles.js' not in index:
    index = index.replace('</body>','<script type="module" src="/assets/project-bundles.js"></script>\n</body>')
if '/assets/skill-agent.js' not in index:
    index = index.replace('</body>','<script type="module" src="/assets/skill-agent.js"></script>\n</body>')
if '/assets/creation-skill-picker.css' not in index:
    index = index.replace('</head>','<link rel="stylesheet" href="/assets/creation-skill-picker.css">\n</head>')
if '/assets/chapter-output.css' not in index:
    index = index.replace('</head>','<link rel="stylesheet" href="/assets/chapter-output.css">\n</head>')
if '/assets/floating-agent.css' not in index:
    index=index.replace('</head>','<link rel="stylesheet" href="/assets/floating-agent.css">\n</head>')
if '/assets/adaptive-composer.css' not in index:
    index=index.replace('</head>','<link rel="stylesheet" href="/assets/adaptive-composer.css">\n</head>')
if '/assets/agent-window-states.css' not in index:
    index=index.replace('</head>','<link rel="stylesheet" href="/assets/agent-window-states.css">\n</head>')
for file in (ROOT / 'src').iterdir():
    shutil.copy2(file, ASSETS / file.name)
CHAPTER.write_text(s, encoding='utf-8')
CREATE.write_text(creation, encoding='utf-8')
INDEX.write_text(index, encoding='utf-8')
(backup / 'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'installed':str(ASSETS),'backup':str(backup)},ensure_ascii=False))
