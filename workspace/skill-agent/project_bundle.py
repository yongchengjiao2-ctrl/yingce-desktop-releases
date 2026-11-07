"""Versioned project ZIP transfer. Only project records, never accounts or settings."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import sys
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone

TABLES = '''projects project_units canvas_projects canvas_snapshots canvas_snapshot_resources
canvas_unit_links project_asset_folders project_asset_links project_asset_candidates assets
asset_folders asset_versions asset_representations character_voice_bindings voice_profiles
shots shot_revisions shot_artifacts shot_asset_references production_task_links tasks results
workflow_instances workflow_step_instances workflow_step_tasks workflow_template_versions
agent_profiles cloud_agent_executions cloud_agent_event_records cloud_agent_message_records
cloud_agent_pi_sessions creation_runs yingce_extraction_observations resources style_profiles
skills skill_versions skill_files user_skill_states skill_library_categories'''.split()
OWNERS = {'user_id', 'owner_id', 'author_user_id', 'created_by'}
FRONT_KEYS = {'yingce-skill-agent-v1', 'creation-conversations-v1', 'yingce-chapter-outputs-v1', 'yingce-creation-skill-selections-v1', 'yingce-confirmed-materials-v1', 'yingce-drama-workshop-v1'}
SECRET = re.compile(r'(api[_-]?keys?|secret[_-]?key|authorization|password|credentials?|access[_-]?token|refresh[_-]?token|^token$|^headers$)', re.I)


def clean(value):
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items() if not SECRET.match(k)}
    if isinstance(value, list):
        return [clean(v) for v in value]
    return value


def safe_path(root, key):
    p = PurePosixPath(key)
    if not key or '\\' in key or p.is_absolute() or '..' in p.parts or ':' in key:
        raise ValueError('不安全的资源路径')
    result = (root / Path(*p.parts)).resolve()
    if not result.is_relative_to(root.resolve()):
        raise ValueError('资源路径越界')
    return result


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def connect(db):
    c = sqlite3.connect(db, timeout=30, uri=str(db).startswith('file:'))
    c.row_factory = sqlite3.Row
    return c


def schema(c):
    return {r[0]: [x[1] for x in c.execute('PRAGMA table_info("' + r[0] + '")')]
            for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def referenced_ids(value, field=''):
    # Storage paths preserve old IDs in file names after migration. They are not
    # record references and must never pull unrelated original assets/skills in.
    if field in {'object_key', 'playback_object_key', 'package_key', 'path', 'upload_key', 'public_url', 'endpoint', 'bucket'}:
        return set()
    if isinstance(value, dict):
        return set().union(*(referenced_ids(v, k) for k, v in value.items())) if value else set()
    if isinstance(value, list):
        return set().union(*(referenced_ids(v, field) for v in value)) if value else set()
    if isinstance(value, str):
        if field.endswith('_json') or field == 'payload':
            try:
                return referenced_ids(json.loads(value))
            except (ValueError, TypeError):
                pass
        if '/' in value or '\\' in value:
            return set(re.findall(r'/api/resources/([A-Za-z0-9_-]{12,})(?:[/?.]|$)', value))
        return set(re.findall(r'[A-Za-z0-9_-]{12,}', value))
    return set()


# These are project content dependencies. Historical task references may outlive
# their archived task rows and are intentionally handled separately on import.
RELATIONS = {
    'project_units': {'project_id': 'projects'},
    'canvas_projects': {'project_id': 'projects'},
    'canvas_unit_links': {'project_id': 'projects', 'canvas_id': 'canvas_projects', 'unit_id': 'project_units'},
    'canvas_snapshots': {'canvas_id': 'canvas_projects'},
    'canvas_snapshot_resources': {'snapshot_id': 'canvas_snapshots', 'resource_id': 'resources'},
    'project_asset_links': {'project_id': 'projects', 'asset_id': 'assets'},
    'asset_versions': {'asset_id': 'assets'},
    'asset_representations': {'asset_version_id': 'asset_versions', 'resource_id': 'resources'},
    'skill_versions': {'skill_id': 'skills'},
    'skill_files': {'skill_version_id': 'skill_versions'},
    'workflow_step_instances': {'workflow_instance_id': 'workflow_instances'},
}


def validate_records(tables):
    if not isinstance(tables, dict) or set(tables) - set(TABLES):
        raise ValueError('迁移包包含不支持的数据表')
    for table, rows in tables.items():
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise ValueError('迁移包记录格式异常：' + table)
        if any(r.get('id') and not isinstance(r['id'], str) for r in rows):
            raise ValueError('迁移包记录标识格式异常：' + table)
        ids = [r['id'] for r in rows if r.get('id')]
        if len(ids) != len(set(ids)):
            raise ValueError('迁移包包含重复记录：' + table)
    ids = {t: {r.get('id') for r in rows} for t, rows in tables.items()}
    for table, fields in RELATIONS.items():
        for row in tables.get(table, []):
            for field, parent in fields.items():
                if row.get(field) and row[field] not in ids.get(parent, set()):
                    raise ValueError('迁移包缺少关联数据：' + table + '.' + field + ' → ' + parent)


def validate_metadata(z):
    names = z.namelist()
    if len(names) != len({n.casefold() for n in names}) or len(names) > 100000:
        raise ValueError('迁移包目录异常或存在大小写冲突')
    for name in names:
        safe_path(Path(tempfile.gettempdir()) / 'yingce-archive-validation', name)
    if sum(i.file_size for i in z.infolist()) > 100 * 1024**3:
        raise ValueError('迁移包超过 100 GB 限制')
    if z.getinfo('manifest.json').file_size > 20 * 1024**2 or z.getinfo('project-data.json').file_size > 512 * 1024**2:
        raise ValueError('迁移包清单过大')
    m = json.loads(z.read('manifest.json'))
    if m.get('format') != 'yingce-project-bundle' or m.get('version') != 1:
        raise ValueError('不支持的迁移包版本')
    raw = z.read('project-data.json')
    if hashlib.sha256(raw).hexdigest() != m.get('dataSha256'):
        raise ValueError('项目内容校验失败')
    payload = json.loads(raw)
    validate_records(payload['tables'])
    counts = {t: len(rows) for t, rows in payload['tables'].items()}
    if counts != m.get('counts'):
        raise ValueError('迁移包记录数量与清单不一致')
    for name, info in m['files'].items():
        if not name.startswith(('resources/', 'skill-packages/')) or name not in names:
            raise ValueError('迁移包资源目录异常或缺少素材')
        if z.getinfo(name).file_size != info['size']:
            raise ValueError('素材大小校验失败：' + name)
    return m, payload


def export_bundle(local, user, frontend, output, project_id=None):
    local = Path(local).resolve()
    # SQLite backup API includes WAL and yields a consistent read snapshot.
    with tempfile.TemporaryDirectory() as tmp:
        source = connect((local / 'data/open_ai_canvas.db').resolve().as_uri() + '?mode=ro')
        snapshot = connect(str(Path(tmp) / 'snapshot.db'))
        source.backup(snapshot)
        source.close()
        sc = schema(snapshot)
        candidates = {t: [dict(r) for r in snapshot.execute('SELECT * FROM "' + t + '"')]
                      for t in TABLES if t in sc}
        snapshot.close()
        chosen = {t: [] for t in candidates}
        used = {t: set() for t in candidates}
        refs = referenced_ids(frontend)
        ids = set()
        if project_id and not any(r['id'] == project_id and r.get('user_id') == user for r in candidates.get('projects', [])):
            raise ValueError('项目不存在或不属于当前账号')
        for t in ('projects', 'canvas_projects'):
            for i, row in enumerate(candidates.get(t, [])):
                matches = not project_id or (row.get('id') == project_id if t == 'projects' else row.get('project_id') == project_id)
                if row.get('user_id') == user and matches:
                    chosen[t].append(row); used[t].add(i)
        allowed_projects = {r['id'] for r in chosen.get('projects', [])}
        parent_fields = {'asset_versions': 'asset_id', 'asset_representations': 'asset_version_id',
                         'character_voice_bindings': 'asset_version_id', 'shot_revisions': 'shot_id',
                         'shot_asset_references': 'shot_id', 'canvas_snapshots': 'canvas_id',
                         'canvas_snapshot_resources': 'snapshot_id', 'workflow_step_instances': 'workflow_instance_id',
                         'workflow_step_tasks': 'workflow_step_id', 'cloud_agent_message_records': 'run_id',
                         'cloud_agent_event_records': 'run_id', 'cloud_agent_pi_sessions': 'run_id'}
        # Follow parent relationships and references embedded in canvas/chat JSON.
        # Ownership alone never pulls unrelated resources into the archive.
        changed = True
        while changed:
            changed = False
            for rows in chosen.values():
                for row in rows:
                    if row.get('id'):
                        ids.add(row['id'])
                    refs.update(referenced_ids(row))
            for t, rows in candidates.items():
                for i, row in enumerate(rows):
                    if i in used[t]:
                        continue
                    if project_id and t == 'projects' and row.get('id') != project_id:
                        continue
                    if row.get('project_id') and row['project_id'] not in allowed_projects:
                        continue
                    if row.get('user_id') and row['user_id'] != user:
                        continue
                    parent = any(v in ids for k, v in row.items()
                                 if k.endswith('_id') and k not in OWNERS and k != 'id' and isinstance(v, str) and v)
                    if t in parent_fields:
                        parent = row.get(parent_fields[t]) in ids
                    if t in ('assets', 'voice_profiles', 'resources', 'style_profiles'):
                        parent = False
                    # Referenced IDs are safe for shared asset/template definitions too.
                    if parent or (row.get('id') and row['id'] in refs):
                        chosen[t].append(row); used[t].add(i); changed = True
        # Runtime scheduling fields are not project content. Canonical exports
        # omit the optional inert flag, preserving compatibility with older DBs.
        for row in chosen.get('tasks', []):
            row.pop('agent_execution_ready', None)
        validate_records(chosen)
        for rows in chosen.values():
            for row in rows:
                for k, value in list(row.items()):
                    if isinstance(value, str) and (k.endswith('_json') or k == 'payload'):
                        try:
                            row[k] = json.dumps(clean(json.loads(value)), ensure_ascii=False)
                        except (ValueError, TypeError):
                            pass
        files = {}
        missing = []
        for row in chosen.get('resources', []):
            if row.get('provider') != 'local':
                missing.append('非本地资源：' + row['id']); continue
            for field in ('object_key', 'playback_object_key'):
                key = row.get(field)
                if not key:
                    continue
                path = safe_path(local / 'data/resources', key)
                if not path.is_file():
                    missing.append('缺少资源：' + row['id']); continue
                files['resources/' + key] = path
            # Derived previews may live beside the original; include all variants.
            if row.get('object_key'):
                path = safe_path(local / 'data/resources', row['object_key'])
                for variant in path.parent.glob(path.name + '*'):
                    if variant.is_file():
                        files['resources/' + variant.resolve().relative_to((local / 'data/resources').resolve()).as_posix()] = variant
        for row in chosen.get('skill_versions', []):
            key = row.get('package_key')
            if not key:
                continue
            path = safe_path(local / 'data/skill-packages', key)
            paths = list(path.rglob('*')) if path.is_dir() else [path]
            if not path.exists():
                missing.append('缺少技能包：' + row['id'])
            for p in paths:
                if p.is_file():
                    files['skill-packages/' + p.resolve().relative_to((local / 'data/skill-packages').resolve()).as_posix()] = p
        if missing:
            raise ValueError('不能生成完整迁移包。' + '；'.join(missing[:8]) + '。请先补齐或下载这些资源。')
        payload = {'tables': chosen, 'frontend': {k: clean(v) for k, v in frontend.items() if k in FRONT_KEYS}}
        data = json_bytes(payload)
        version_file = local / 'current.txt'
        app_version = version_file.read_text(encoding='utf-8-sig').strip() if version_file.is_file() else '1.3.20'
        manifest = {'format': 'yingce-project-bundle', 'version': 1, 'appVersion': app_version,
                    'createdAt': datetime.now(timezone.utc).isoformat(), 'projectId': project_id,
                    'counts': {t: len(v) for t, v in chosen.items()}, 'files': {},
                    'sourceUser': user, 'dataSha256': hashlib.sha256(data).hexdigest()}
        dest = Path(output); dest.parent.mkdir(parents=True, exist_ok=True)
        partial = dest.with_suffix('.partial')
        try:
            with zipfile.ZipFile(partial, 'w', zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as z:
                z.writestr('project-data.json', data)
                for name, path in files.items():
                    digest = hashlib.sha256()
                    with path.open('rb') as src, z.open(name, 'w', force_zip64=True) as dst:
                        while chunk := src.read(1024 * 1024):
                            digest.update(chunk); dst.write(chunk)
                    manifest['files'][name] = {'sha256': digest.hexdigest(), 'size': path.stat().st_size}
                z.writestr('manifest.json', json_bytes(manifest))
                z.writestr('使用说明.txt', '在另一台电脑的影策中打开「项目打包与迁移」，选择「导入 ZIP」。\n需要安装支持项目迁移功能的影策版本。导入会创建副本，不覆盖原项目。\n章节格式、画布、素材、聊天记录均随包迁移。模型渠道和账号密码不随包迁移。\n')
            # Verify the completed archive before replacing any previous export.
            with zipfile.ZipFile(partial) as z:
                verified, _ = validate_metadata(z)
                for name, info in verified['files'].items():
                    with z.open(name) as stream:
                        if hashlib.file_digest(stream, 'sha256').hexdigest() != info['sha256']:
                            raise ValueError('导出素材校验失败：' + name)
            os.replace(partial, dest)
        finally:
            partial.unlink(missing_ok=True)
        return {'path': str(dest), 'counts': manifest['counts'], 'bytes': dest.stat().st_size}


def import_bundle(local, user, archive):
    local = Path(local).resolve()
    # Validate archive and every checksum before changing the live database.
    with zipfile.ZipFile(archive) as z, tempfile.TemporaryDirectory(dir=local / 'data') as tmp:
        m, payload = validate_metadata(z)
        tables = payload['tables']
        for name, info in m['files'].items():
            if not name.startswith(('resources/', 'skill-packages/')):
                raise ValueError('迁移包资源目录异常')
            out = safe_path(Path(tmp), name); out.parent.mkdir(parents=True, exist_ok=True)
            digest = hashlib.sha256()
            with z.open(name) as src, out.open('wb') as dst:
                while chunk := src.read(1024 * 1024):
                    digest.update(chunk); dst.write(chunk)
            if out.stat().st_size != info['size'] or digest.hexdigest() != info['sha256']:
                raise ValueError('素材校验失败：' + name)
        c = connect(str(local / 'data/open_ai_canvas.db')); sc = schema(c)
        for table, rows in tables.items():
            # Older desktop schemas do not have this inert execution flag.
            # Never silently discard unknown fields or a ready-to-run task.
            if table == 'tasks' and table in sc and 'agent_execution_ready' not in sc[table]:
                for row in rows:
                    if row.get('agent_execution_ready') in (0, None):
                        row.pop('agent_execution_ready', None)
            if rows and (table not in sc or any(set(r) - set(sc[table]) for r in rows)):
                c.close()
                raise ValueError('目标影策版本与迁移包数据结构不兼容：' + table)
        mapping = {r['id']: uuid.uuid4().hex for rows in tables.values() for r in rows if r.get('id')}
        # Some older exports carry media references to archived tasks without
        # the task rows. Namespace those historical references too, so a second
        # import cannot collide with the first or link to an unrelated task.
        for rows in tables.values():
            for row in rows:
                if isinstance(row.get('task_id'), str) and row['task_id']:
                    mapping.setdefault(row['task_id'], uuid.uuid4().hex)
        def frontend_ids(value):
            if isinstance(value, dict):
                if isinstance(value.get('id'), str) and value['id']:
                    mapping.setdefault(value['id'], uuid.uuid4().hex)
                for v in value.values():
                    frontend_ids(v)
            elif isinstance(value, list):
                for v in value:
                    frontend_ids(v)
        frontend_ids(payload.get('frontend', {}))
        mapping[m['sourceUser']] = user
        # New file namespace keeps originals and repeated imports isolated.
        batch = uuid.uuid4().hex
        pathmap = {}
        for name in m['files']:
            kind, key = name.split('/', 1)
            pathmap[key] = 'imports/' + batch + '/' + key
        for row in tables.get('skill_versions', []):
            if row.get('package_key'):
                pathmap[row['package_key']] = 'imports/' + batch + '/' + row['package_key']
        pattern = re.compile('|'.join(re.escape(k) for k in sorted({**mapping, **pathmap}, key=len, reverse=True))) if mapping or pathmap else None
        repl = {**mapping, **pathmap}
        def remap(value):
            if isinstance(value, str):
                value = pattern.sub(lambda match: repl[match[0]], value) if pattern else value
                return re.sub(r'https?://(?:127\.0\.0\.1|localhost):\d+(?=/api/resources/)', '', value)
            if isinstance(value, dict):
                return {k: remap(v) for k, v in value.items()}
            if isinstance(value, list):
                return [remap(v) for v in value]
            return value
        backup = local / 'data/backups' / ('before-project-import-' + batch + '.db')
        backup.parent.mkdir(parents=True, exist_ok=True)
        b = sqlite3.connect(backup); c.backup(b); b.close()
        copied = []
        frontend = remap({k: v for k, v in payload.get('frontend', {}).items() if k in FRONT_KEYS})
        receipt = {'id': batch, 'frontend': frontend, 'counts': m['counts'], 'backup': str(backup)}
        pending = local / 'data/project-bundle-receipts' / (user + '-' + batch + '.json')
        try:
            c.execute('PRAGMA foreign_keys=OFF')
            c.execute('BEGIN IMMEDIATE')
            baseline_faults = set(c.execute('PRAGMA foreign_key_check').fetchall())
            # The bundle already carries the materialized assets/versions.
            # Provenance triggers would create them again when candidates are
            # restored. DDL is transactional: rollback restores these triggers.
            provenance_triggers = c.execute("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN ('yingce_provenance_after_insert','yingce_provenance_observe','yingce_provenance_rollup','yingce_provenance_sync')").fetchall()
            for trigger in provenance_triggers:
                c.execute('DROP TRIGGER "' + trigger['name'].replace('"', '""') + '"')
            for kind in ('resources', 'skill-packages'):
                for name in m['files']:
                    if not name.startswith(kind + '/'):
                        continue
                    key = name.split('/', 1)[1]
                    target = safe_path(local / 'data' / kind, pathmap[key])
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(safe_path(Path(tmp), name), target); copied.append(target)
            for table in TABLES:
                for original in tables.get(table, []):
                    row = remap(original)
                    for k in OWNERS:
                        if k in row and row[k]:
                            row[k] = user
                    if table == 'projects':
                        base = row['name'] + '（导入）'; row['name'] = base; n = 2
                        while c.execute('SELECT 1 FROM projects WHERE user_id=? AND name=?', (user, row['name'])).fetchone():
                            row['name'] = base + ' ' + str(n); n += 1
                    if table == 'asset_folders':
                        row['name'] += '（导入）'; row['name_key'] += '-' + batch
                    if table == 'skill_library_categories':
                        row['name'] += '（导入）'; row['normalized_name'] += '-' + batch
                    if table == 'workflow_template_versions':
                        row['template_key'] += '-import-' + batch
                    if table == 'tasks':
                        if row.get('status') not in ('succeeded', 'failed', 'cancelled', 'completed'):
                            row['status'] = 'cancelled'; row['error'] = '从迁移包恢复，未自动重启生成任务'
                        for k in ('lease_owner', 'lease_expires_at', 'next_poll_at', 'billing_order_id', 'route_id', 'channel_model_id', 'logical_model_revision_id'):
                            if k in row:
                                row[k] = None if original[k] is None else ''
                        if 'creation_submission_id' in row:
                            row['creation_submission_id'] = None
                    if table in ('cloud_agent_executions', 'creation_runs') and row.get('status') in ('running', 'pending', 'queued', 'streaming'):
                        row['status'] = 'failed'
                    if table == 'resources':
                        row.update(storage_setting_id='', public_url='', endpoint='', bucket='')
                        if row.get('upload_key'):
                            row['upload_key'] = 'import-' + batch + '-' + row['upload_key']
                    cols = list(row)
                    c.execute('INSERT INTO "' + table + '" (' + ','.join('"' + k + '"' for k in cols) + ') VALUES (' + ','.join('?' for _ in cols) + ')', [row[k] for k in cols])
            for trigger in provenance_triggers:
                c.execute(trigger['sql'])
            if set(c.execute('PRAGMA foreign_key_check').fetchall()) - baseline_faults:
                raise ValueError('迁移包缺少关联数据，已撤销本次导入')
            pending.parent.mkdir(parents=True, exist_ok=True); pending.write_bytes(json_bytes(receipt))
            c.commit()
        except Exception:
            c.rollback()
            for p in copied:
                p.unlink(missing_ok=True)
            pending.unlink(missing_ok=True)
            raise
        finally:
            c.close()
        return receipt


if __name__ == '__main__':
    try:
        command, local, user, arg = sys.argv[1:5]
        if command == 'export':
            request = json.loads(Path(arg).read_text(encoding='utf-8'))
            result = export_bundle(local, user, request.get('frontend', {}), request['output'], request.get('projectId'))
        elif command == 'import':
            result = import_bundle(local, user, arg)
        else:
            raise ValueError('未知操作')
        print(json.dumps(result, ensure_ascii=True))
    except Exception as exc:
        print(json.dumps({'error': str(exc)}, ensure_ascii=True)); sys.exit(1)
