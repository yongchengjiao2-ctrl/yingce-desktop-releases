// Idempotent repair for old task databases; never changes existing task state.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync, backup} from 'node:sqlite';

export async function ensureTaskSchema(dbPath) {
  if (!fs.existsSync(dbPath)) return {changed:false,reason:'database-not-created'};
  const db=new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout=15000');
  const columns=()=>db.prepare('PRAGMA table_info(tasks)').all();
  try {
    const before=columns();
    if (!before.length) return {changed:false,reason:'tasks-not-created'};
    if (before.some(c=>c.name==='agent_execution_ready')) return {changed:false,reason:'schema-current'};
    const folder=path.join(path.dirname(dbPath),'backups','task-schema-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid);
    fs.mkdirSync(folder,{recursive:true});
    const backupPath=path.join(folder,'open_ai_canvas.db');
    await backup(db,backupPath);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!columns().some(c=>c.name==='agent_execution_ready')) {
        db.exec('ALTER TABLE tasks ADD COLUMN agent_execution_ready INTEGER NOT NULL DEFAULT 0');
      }
      db.exec('COMMIT');
    } catch(error) {db.exec('ROLLBACK');throw error;}
    return {changed:true,backup:backupPath,column:'agent_execution_ready'};
  } finally {db.close();}
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const index=process.argv.indexOf('--db');
  if (index<0 || !process.argv[index+1]) throw Error('--db is required');
  console.log(JSON.stringify(await ensureTaskSchema(path.resolve(process.argv[index+1]))));
}
