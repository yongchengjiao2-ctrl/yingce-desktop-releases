import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ensureTaskSchema} from '../task-schema.mjs';

test('upgrade old task DB, preserve data, back up WAL, accept task inserts and remain idempotent',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yingce-task-schema-'));
 const file=path.join(root,'open_ai_canvas.db');
 const db=new DatabaseSync(file);
 try {
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE tasks(id TEXT PRIMARY KEY,status TEXT); INSERT INTO tasks VALUES('old','succeeded'); CREATE TABLE settings(id TEXT,value TEXT); INSERT INTO settings VALUES('model','preserved')");
  const first=await ensureTaskSchema(file);
  assert.equal(first.changed,true);assert.ok(fs.existsSync(first.backup));
  assert.equal(db.prepare('SELECT agent_execution_ready FROM tasks WHERE id=?').get('old').agent_execution_ready,0);
  db.prepare('INSERT INTO tasks(id,status,agent_execution_ready) VALUES(?,?,?)').run('new','queued',1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM tasks').get().n,2);
  assert.equal(db.prepare('SELECT value FROM settings').get().value,'preserved');
  const saved=new DatabaseSync(first.backup);
  try {assert.equal(saved.prepare('SELECT count(*) AS n FROM tasks').get().n,1);assert.equal(saved.prepare('PRAGMA table_info(tasks)').all().some(c=>c.name==='agent_execution_ready'),false);}finally{saved.close();}
  const second=await ensureTaskSchema(file);assert.equal(second.changed,false);
  assert.equal(db.prepare('SELECT agent_execution_ready FROM tasks WHERE id=?').get('new').agent_execution_ready,1);
  assert.equal(fs.readdirSync(path.join(root,'backups')).length,1);
 } finally {db.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('uninitialized installs do not create an empty DB or block later initialization',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yingce-task-empty-'));const file=path.join(root,'db');
 try {assert.equal((await ensureTaskSchema(file)).changed,false);assert.equal(fs.existsSync(file),false);
 const db=new DatabaseSync(file);db.close();assert.equal((await ensureTaskSchema(file)).changed,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
