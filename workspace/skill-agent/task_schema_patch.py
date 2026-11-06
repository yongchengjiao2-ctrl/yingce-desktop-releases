"""Install task schema startup checks without replacing project data or settings."""
from pathlib import Path
import argparse
import datetime
import re
import shutil
import subprocess


def repair_apply_state(code):
    import_line = "import {ensureTaskSchema} from './task-schema.mjs';"
    if import_line not in code:
        anchor = "import {DatabaseSync, backup} from 'node:sqlite';"
        assert code.count(anchor) == 1, 'State migration import anchor changed'
        code = code.replace(anchor, anchor + '\n' + import_line)
    before = "await ensureTaskSchema(path.join(dataRoot,'open_ai_canvas.db'));"
    if before not in code:
        anchor = "const dataRoot = path.join(installRoot, 'data');"
        assert code.count(anchor) == 1, 'State migration data root anchor changed'
        code = code.replace(anchor, anchor + '\n' + before)
    after = 'await ensureTaskSchema(dbPath);'
    if after not in code:
        anchor = 'const nextRegistry = '
        assert code.count(anchor) == 1, 'State migration completion anchor changed'
        code = code.replace(anchor, after + '\n' + anchor)
    return code


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--install-root', type=Path, required=True)
    args = parser.parse_args()
    root = args.install_root.resolve()
    version = (root/'current.txt').read_text(encoding='utf-8-sig').strip()
    assert re.fullmatch(r'\d+\.\d+\.\d+', version)
    runtime = root/'versions'/version
    state = runtime/'backend/desktop-state'
    apply = state/'apply-state.mjs'
    updated = repair_apply_state(apply.read_text(encoding='utf8'))
    backup = root/'data/backups'/('task-startup-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
    backup.mkdir(parents=True, exist_ok=False)
    for file in (apply, state/'task-schema.mjs'):
        if file.is_file():
            shutil.copy2(file, backup/file.name)
    for file, data in ((apply, updated.encode()), (state/'task-schema.mjs', Path(__file__).with_name('task-schema.mjs').read_bytes())):
        pending = file.with_suffix(file.suffix+'.pending')
        pending.write_bytes(data)
        pending.replace(file)
    subprocess.run([str(runtime/'runtime/node/node.exe'), str(state/'task-schema.mjs'), '--db', str(root/'data/open_ai_canvas.db')], check=True)
    print('Task schema startup repair installed; backups preserved.')
