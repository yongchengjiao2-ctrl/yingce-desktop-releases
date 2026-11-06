"""Apply the source chapter null guard and empty-list recovery to the desktop baseline."""
def repair_chapter_code(source):
    for kind in ('characters', 'storyboard'):
        old = f't?.chapterId===V?.id&&t.kind===`{kind}`'
        new = f'!!(t&&V&&t.chapterId===V.id&&t.kind===`{kind}`)'
        if new not in source:
            assert source.count(old) == 1, 'Chapter task identity anchor changed'
            source = source.replace(old, new)
    if 'ysaEmptyChapterAttempt' not in source:
        anchor = 'q=l({mutationFn:t=>_t(e.project.id,t.map('
        assert source.count(anchor) == 1, 'Chapter creation anchor changed'
        effect = 'ysaEmptyChapterAttempt=(0,Q.useRef)(null),ysaEmptyChapterEffect=(0,Q.useEffect)(()=>{if(z.length){ysaEmptyChapterAttempt.current=null;return}if(ysaEmptyChapterAttempt.current===e.project.id)return;ysaEmptyChapterAttempt.current=e.project.id;K.mutate({title:`1`})},[e.project.id,z.length,K.mutate]),'
        source = source.replace(anchor, effect + anchor)
    return source

if __name__ == '__main__':
    import argparse, datetime, pathlib, shutil
    parser = argparse.ArgumentParser()
    parser.add_argument('--install-root', type=pathlib.Path, required=True)
    args = parser.parse_args()
    root = args.install_root.resolve()
    version = (root / 'current.txt').read_text(encoding='utf-8-sig').strip()
    import re
    assert re.fullmatch(r'\d+\.\d+\.\d+', version)
    assets = root / 'versions' / version / 'web/dist/assets'
    chapter = assets / 'chapters-CeKTBaiU.js'
    code = repair_chapter_code(chapter.read_text(encoding='utf-8'))
    backup = root / 'backups' / ('chapter-state-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
    backup.mkdir(parents=True)
    for file in (chapter, assets / 'agent-native-message.js'):
        shutil.copy2(file, backup / file.name)
    chapter.write_text(code, encoding='utf-8')
    shutil.copy2(pathlib.Path(__file__).parent / 'src/agent-native-message.js', assets / 'agent-native-message.js')
    assert repair_chapter_code(chapter.read_text(encoding='utf-8')) == code
    print('Applied chapter recovery and terminal message display; backup:', backup)
