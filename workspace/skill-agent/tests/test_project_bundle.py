import importlib.util
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import zipfile

spec=importlib.util.spec_from_file_location('bundle',Path(__file__).resolve().parents[1]/'project_bundle.py')
bundle=importlib.util.module_from_spec(spec);spec.loader.exec_module(bundle)

class BundleTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.local=self.root/'source';self.target=self.root/'target'
  for folder in [self.local,self.target]:
   (folder/'data').mkdir(parents=True)
   c=sqlite3.connect(folder/'data/open_ai_canvas.db')
   c.executescript('''CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,UNIQUE(user_id,name));
   CREATE TABLE project_units(id TEXT PRIMARY KEY,project_id TEXT,title TEXT,source_text TEXT,position INT);
   CREATE TABLE canvas_projects(id TEXT PRIMARY KEY,user_id TEXT,project_id TEXT,title TEXT,payload_json TEXT);
   CREATE TABLE resources(id TEXT PRIMARY KEY,user_id TEXT,provider TEXT,object_key TEXT,playback_object_key TEXT,storage_setting_id TEXT,public_url TEXT,endpoint TEXT,bucket TEXT);
   CREATE TABLE users(id TEXT PRIMARY KEY,password_hash TEXT);
   CREATE TABLE model_channels(id TEXT PRIMARY KEY,api_key TEXT);''');c.close()
  c=sqlite3.connect(self.local/'data/open_ai_canvas.db')
  c.execute('INSERT INTO projects VALUES(?,?,?)',('project-123456789','user-source-12345','短剧'))
  c.execute('INSERT INTO projects VALUES(?,?,?)',('project-other-12345','other-user-12345','别人的项目'))
  c.execute('INSERT INTO project_units VALUES(?,?,?,?,?)',('chapter-123456789','project-123456789','第一章','<h2>标题</h2><p><strong>加粗</strong></p>',0))
  c.execute('INSERT INTO canvas_projects VALUES(?,?,?,?,?)',('canvas-123456789','user-source-12345','project-123456789','画布',json.dumps({'resourceId':'resource-123456789','chatSessions':[{'content':'画布聊天'}]})))
  c.execute('INSERT INTO resources VALUES(?,?,?,?,?,?,?,?,?)',('resource-123456789','user-source-12345','local','users/a/test.txt','','','','',''))
  c.execute("INSERT INTO users VALUES('secret-user','password-secret')");c.execute("INSERT INTO model_channels VALUES('channel','key-secret')");c.commit();c.close()
  resource=self.local/'data/resources/users/a/test.txt';resource.parent.mkdir(parents=True);resource.write_text('实际素材',encoding='utf8')
  self.front={'yingce-skill-agent-v1':[{'id':'session-123456789','projectId':'project-123456789','messages':[{'id':'message-123456789','content':'聊天历史 **加粗**'}]}]}
 def tearDown(self):self.tmp.cleanup()
 def rewrite_payload(self,archive,mutate):
  with zipfile.ZipFile(archive) as z:
   members={n:z.read(n) for n in z.namelist()}
  payload=json.loads(members['project-data.json']);mutate(payload)
  members['project-data.json']=bundle.json_bytes(payload);manifest=json.loads(members['manifest.json']);manifest['dataSha256']=hashlib.sha256(members['project-data.json']).hexdigest();members['manifest.json']=bundle.json_bytes(manifest)
  with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
   for name,data in members.items():z.writestr(name,data)
 def test_inert_task_flag_is_compatible_but_unknown_fields_are_rejected(self):
  for folder in [self.local,self.target]:
   c=sqlite3.connect(folder/'data/open_ai_canvas.db');c.execute('CREATE TABLE tasks(id TEXT PRIMARY KEY,user_id TEXT,project_id TEXT,status TEXT)');c.commit();c.close()
  c=sqlite3.connect(self.local/'data/open_ai_canvas.db');c.execute('ALTER TABLE tasks ADD COLUMN agent_execution_ready INTEGER');c.execute("INSERT INTO tasks VALUES('task-123456789','user-source-12345','project-123456789','completed',0)");c.commit();c.close()
  archive=self.root/'tasks.zip';bundle.export_bundle(self.local,'user-source-12345',self.front,archive,'project-123456789')
  with zipfile.ZipFile(archive) as z:self.assertNotIn('agent_execution_ready',json.loads(z.read('project-data.json'))['tables']['tasks'][0])
  self.rewrite_payload(archive,lambda p:p['tables']['tasks'][0].update(agent_execution_ready=0))
  bundle.import_bundle(self.target,'target-user',archive)
  c=sqlite3.connect(self.target/'data/open_ai_canvas.db');self.assertEqual(c.execute('SELECT count(*) FROM tasks').fetchone()[0],1);c.close()
  c=sqlite3.connect(self.local/'data/open_ai_canvas.db');c.execute('ALTER TABLE tasks ADD COLUMN future_task_state TEXT');c.execute("UPDATE tasks SET future_task_state='unsupported'");c.commit();c.close()
  bundle.export_bundle(self.local,'user-source-12345',self.front,archive,'project-123456789')
  with self.assertRaisesRegex(ValueError,'tasks'):bundle.import_bundle(self.target,'target-user',archive)
 def test_manifest_counts_are_checked_before_database_changes(self):
  archive=self.root/'counts.zip';bundle.export_bundle(self.local,'user-source-12345',self.front,archive)
  self.rewrite_payload(archive,lambda p:p['tables']['project_units'].append(dict(p['tables']['project_units'][0],id='another-chapter-12345')))
  with self.assertRaisesRegex(ValueError,'数量'):bundle.import_bundle(self.target,'target-user',archive)
  c=sqlite3.connect(self.target/'data/open_ai_canvas.db');self.assertEqual(c.execute('SELECT count(*) FROM projects').fetchone()[0],0);c.close()
 def test_dangling_project_assets_cannot_replace_previous_export(self):
  archive=self.root/'retained.zip';archive.write_bytes(b'previous-good-export')
  c=sqlite3.connect(self.local/'data/open_ai_canvas.db');c.execute('CREATE TABLE project_asset_links(id TEXT PRIMARY KEY,project_id TEXT,asset_id TEXT)');c.execute("INSERT INTO project_asset_links VALUES('link-123456789','project-123456789','missing-asset-123456789')");c.commit();c.close()
  with self.assertRaisesRegex(ValueError,'缺少关联'):bundle.export_bundle(self.local,'user-source-12345',self.front,archive,'project-123456789')
  self.assertEqual(archive.read_bytes(),b'previous-good-export')
 def test_failed_import_restores_triggers_and_rolls_back_records_and_materials(self):
  archive=self.root/'rollback.zip';bundle.export_bundle(self.local,'user-source-12345',self.front,archive)
  c=sqlite3.connect(self.target/'data/open_ai_canvas.db');c.execute('CREATE TRIGGER yingce_provenance_after_insert AFTER INSERT ON projects BEGIN SELECT 1; END');trigger=c.execute("SELECT sql FROM sqlite_master WHERE name='yingce_provenance_after_insert'").fetchone()[0];c.close()
  original=bundle.connect
  class Fault(sqlite3.Connection):
   def execute(self,sql,params=()):
    if sql.startswith('INSERT INTO "project_units"'):raise sqlite3.IntegrityError('test write failure')
    return super().execute(sql,params)
  def failing(db):
   c=sqlite3.connect(db,factory=Fault);c.row_factory=sqlite3.Row;return c
  bundle.connect=failing
  try:
   with self.assertRaisesRegex(sqlite3.IntegrityError,'test write'):bundle.import_bundle(self.target,'target-user',archive)
  finally:bundle.connect=original
  c=sqlite3.connect(self.target/'data/open_ai_canvas.db');self.assertEqual(c.execute('SELECT count(*) FROM projects').fetchone()[0],0);self.assertEqual(c.execute("SELECT sql FROM sqlite_master WHERE name='yingce_provenance_after_insert'").fetchone()[0],trigger);c.close()
  self.assertEqual([p for p in (self.target/'data/resources').rglob('*') if p.is_file()],[])
 def test_provenance_triggers_do_not_duplicate_restored_asset_versions(self):
  for folder in [self.local,self.target]:
   c=sqlite3.connect(folder/'data/open_ai_canvas.db');c.executescript('''CREATE TABLE assets(id TEXT PRIMARY KEY,user_id TEXT);
   CREATE TABLE asset_versions(id TEXT PRIMARY KEY,asset_id TEXT,version INTEGER,UNIQUE(asset_id,version));
   CREATE TABLE asset_representations(id TEXT PRIMARY KEY,asset_version_id TEXT,task_id TEXT,role TEXT,UNIQUE(task_id,role));
   CREATE TABLE project_asset_candidates(id TEXT PRIMARY KEY,project_id TEXT,asset_id TEXT);
   CREATE TRIGGER yingce_provenance_after_insert AFTER INSERT ON project_asset_candidates BEGIN
   INSERT INTO asset_versions VALUES('auto-'||NEW.id,NEW.asset_id,1); END;''');c.commit();c.close()
  c=sqlite3.connect(self.local/'data/open_ai_canvas.db');c.execute("INSERT INTO assets VALUES('asset-123456789','user-source-12345')");c.execute("INSERT INTO project_asset_candidates VALUES('candidate-123456789','project-123456789','asset-123456789')");c.commit();c.close()
  archive=self.root/'triggers.zip';bundle.export_bundle(self.local,'user-source-12345',self.front,archive,'project-123456789')
  c=sqlite3.connect(self.local/'data/open_ai_canvas.db');version=c.execute('SELECT id FROM asset_versions').fetchone()[0];c.execute('INSERT INTO asset_representations VALUES(?,?,?,?)',('rep-123456789',version,'archived-task-123456789','image'));c.commit();c.close()
  bundle.export_bundle(self.local,'user-source-12345',self.front,archive,'project-123456789')
  bundle.import_bundle(self.target,'target-user',archive)
  bundle.import_bundle(self.target,'target-user',archive)
  c=sqlite3.connect(self.target/'data/open_ai_canvas.db');self.assertEqual(c.execute('SELECT count(*) FROM asset_versions').fetchone()[0],2);self.assertEqual(c.execute('SELECT count(*) FROM asset_representations').fetchone()[0],2)
  self.assertEqual(c.execute("SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name='yingce_provenance_after_insert'").fetchone()[0],1);c.close()
 def test_confirmed_materials_round_trip(self):
  self.front['yingce-confirmed-materials-v1']=[{'id':'material-123456789','projectId':'project-123456789','type':'character','title':'女主','content':'已确认人物设定','revision':2,'enabled':True,'revisions':[{'revision':1,'content':'上一版设定'}]}]
  archive=self.root/'materials.zip';bundle.export_bundle(self.local,'user-source-12345',self.front,archive,project_id='project-123456789')
  result=bundle.import_bundle(self.target,'target-user',archive)
  item=result['frontend']['yingce-confirmed-materials-v1'][0]
  self.assertEqual(item['content'],'已确认人物设定');self.assertEqual(item['revisions'][0]['content'],'上一版设定')
  self.assertNotEqual(item['projectId'],'project-123456789');self.assertEqual(item['revision'],2)
 def test_resource_upload_keys_are_isolated_for_repeated_imports(self):
  for folder in [self.local,self.target]:
   c=sqlite3.connect(folder/'data/open_ai_canvas.db');c.execute('ALTER TABLE resources ADD COLUMN upload_key TEXT');c.execute('CREATE UNIQUE INDEX unique_upload ON resources(user_id,upload_key)');c.commit();c.close()
  c=sqlite3.connect(self.local/'data/open_ai_canvas.db');c.execute("UPDATE resources SET upload_key='source-upload'");c.commit();c.close()
  archive=self.root/'uploads.zip';bundle.export_bundle(self.local,'user-source-12345',self.front,archive)
  bundle.import_bundle(self.target,'target-user',archive);bundle.import_bundle(self.target,'target-user',archive)
  c=sqlite3.connect(self.target/'data/open_ai_canvas.db');self.assertEqual(c.execute('SELECT count(DISTINCT upload_key) FROM resources').fetchone()[0],2);c.close()
 def test_imported_storage_paths_do_not_pull_original_skill_versions(self):
  c=sqlite3.connect(self.local/'data/open_ai_canvas.db');c.executescript('CREATE TABLE skills(id TEXT PRIMARY KEY,user_id TEXT);CREATE TABLE skill_versions(id TEXT PRIMARY KEY,skill_id TEXT,package_key TEXT);')
  c.execute("INSERT INTO skills VALUES('original-skill-123456789','user-source-12345')");c.execute("INSERT INTO skill_versions VALUES('old-version-123456789','original-skill-123456789','not-present.zip')")
  c.execute('UPDATE canvas_projects SET payload_json=? WHERE id=?',(json.dumps({'resourceId':'resource-123456789','filePath':'imports/batch/old-version-123456789.zip'}),'canvas-123456789'));c.commit();c.close()
  archive=self.root/'path-scope.zip';bundle.export_bundle(self.local,'user-source-12345',self.front,archive,'project-123456789')
  with zipfile.ZipFile(archive) as z:self.assertEqual(json.loads(z.read('project-data.json'))['tables']['skill_versions'],[])
 def test_round_trip_twice_preserves_content_and_remaps(self):
  archive=self.root/'project.zip';bundle.export_bundle(self.local,'user-source-12345',self.front,archive)
  with zipfile.ZipFile(archive) as z:
   data=z.read('project-data.json').decode();self.assertNotIn('password-secret',data);self.assertNotIn('key-secret',data);self.assertNotIn('别人的项目',data)
  first=bundle.import_bundle(self.target,'target-user',archive);second=bundle.import_bundle(self.target,'target-user',archive)
  c=sqlite3.connect(self.target/'data/open_ai_canvas.db')
  rows=c.execute('SELECT user_id,name FROM projects ORDER BY name').fetchall();self.assertEqual(len(rows),2);self.assertTrue(all(r[0]=='target-user' for r in rows));self.assertNotEqual(rows[0][1],rows[1][1])
  text=c.execute('SELECT source_text FROM project_units').fetchone()[0];self.assertIn('<strong>加粗</strong>',text)
  key=c.execute('SELECT object_key FROM resources LIMIT 1').fetchone()[0];self.assertEqual((self.target/'data/resources'/key).read_text(encoding='utf8'),'实际素材')
  canvas=json.loads(c.execute('SELECT payload_json FROM canvas_projects LIMIT 1').fetchone()[0]);self.assertNotEqual(canvas['resourceId'],'resource-123456789')
  self.assertNotEqual(first['frontend']['yingce-skill-agent-v1'][0]['id'],second['frontend']['yingce-skill-agent-v1'][0]['id']);self.assertEqual(c.execute('SELECT count(*) FROM users').fetchone()[0],0);c.close()
 def test_corruption_and_traversal_leave_target_unchanged(self):
  archive=self.root/'project.zip';bundle.export_bundle(self.local,'user-source-12345',self.front,archive)
  with zipfile.ZipFile(archive,'a') as z:z.writestr('../bad.txt','bad')
  with self.assertRaises(ValueError):bundle.import_bundle(self.target,'target-user',archive)
  c=sqlite3.connect(self.target/'data/open_ai_canvas.db');self.assertEqual(c.execute('SELECT count(*) FROM projects').fetchone()[0],0);c.close()
 def test_missing_material_does_not_create_incomplete_zip(self):
  (self.local/'data/resources/users/a/test.txt').unlink()
  with self.assertRaises(ValueError):bundle.export_bundle(self.local,'user-source-12345',self.front,self.root/'bad.zip')
  self.assertFalse((self.root/'bad.zip').exists())
 def test_card_export_contains_only_selected_project(self):
  c=sqlite3.connect(self.local/'data/open_ai_canvas.db');c.execute('INSERT INTO projects VALUES(?,?,?)',('project-second-12345','user-source-12345','另一个项目'));c.execute('INSERT INTO project_units VALUES(?,?,?,?,?)',('chapter-second-12345','project-second-12345','第二项目正文','private unrelated',0));c.commit();c.close()
  archive=self.root/'single.zip';bundle.export_bundle(self.local,'user-source-12345',self.front,archive,'project-123456789')
  with zipfile.ZipFile(archive) as z:
   data=json.loads(z.read('project-data.json'));self.assertEqual(len(data['tables']['projects']),1);self.assertNotIn('private unrelated',str(data))
  with self.assertRaises(ValueError):bundle.export_bundle(self.local,'user-source-12345',{},self.root/'forbidden.zip','project-other-12345')
 def test_shared_asset_and_folder_do_not_pull_other_projects(self):
  c=sqlite3.connect(self.local/'data/open_ai_canvas.db')
  c.executescript('CREATE TABLE assets(id TEXT PRIMARY KEY,user_id TEXT,folder_id TEXT);CREATE TABLE asset_folders(id TEXT PRIMARY KEY,user_id TEXT,name TEXT);CREATE TABLE project_asset_links(id TEXT PRIMARY KEY,project_id TEXT,asset_id TEXT);')
  c.execute('INSERT INTO asset_folders VALUES(?,?,?)',('folder-shared-12345','user-source-12345','共用文件夹'))
  for suffix in ['selected','unrelated']:c.execute('INSERT INTO assets VALUES(?,?,?)',('asset-'+suffix+'-12345','user-source-12345','folder-shared-12345'))
  c.execute('INSERT INTO project_asset_links VALUES(?,?,?)',('link-selected-12345','project-123456789','asset-selected-12345'))
  c.execute('INSERT INTO project_asset_links VALUES(?,?,?)',('link-unrelated-12345','project-other-12345','asset-selected-12345'));c.commit();c.close()
  archive=self.root/'scoped.zip';bundle.export_bundle(self.local,'user-source-12345',self.front,archive,'project-123456789')
  with zipfile.ZipFile(archive) as z:
   data=json.loads(z.read('project-data.json'));self.assertEqual([r['id'] for r in data['tables']['assets']],['asset-selected-12345']);self.assertEqual(len(data['tables']['project_asset_links']),1)

if __name__=='__main__':unittest.main()
