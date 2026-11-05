import importlib.util
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
