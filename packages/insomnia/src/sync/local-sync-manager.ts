import fs from 'fs';
import fsPath from 'path';

import { ChangeBufferEvent, database as db } from '../common/database';
import { getOrCreate } from '../models/settings';
import { resolvePath, sanitizeName } from './path-resolver';
import { BaseModel } from '../models';

const writeTimers = new Map<string, NodeJS.Timeout>();
const idToPathMap = new Map<string, string>();

export async function initLocalSync() {
  const settings = await getOrCreate();
  if (settings.localSyncPath) {
    try {
      // Perform full export for all workspaces
      const workspaces = await db.all('Workspace');
      for (const w of workspaces) {
        const descendants = await db.withDescendants(w);
        for (const doc of [w, ...descendants]) {
          await handleDatabaseChange('insert', doc, settings.localSyncPath);
        }
      }
    } catch (e) {
      console.error('[local-sync] Full export failed', e);
    }
  }

  db.onChange(async (changes: ChangeBufferEvent[]) => {
    const currentSettings = await getOrCreate();
    if (!currentSettings.localSyncPath) {
      return;
    }

    for (const [event, doc] of changes) {
      await handleDatabaseChange(event, doc, currentSettings.localSyncPath);
    }
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanDoc(doc: any) {
  const cloned = { ...doc };
  delete cloned.modified;
  delete cloned.created;
  return cloned;
}

async function handleDatabaseChange(event: string, doc: BaseModel, basePath: string) {
  const filePath = await resolvePath(doc, basePath);
  if (!filePath) {
    return;
  }

  const oldPath = idToPathMap.get(doc._id);

  if (event === 'insert' || event === 'update') {
    if (oldPath && oldPath !== filePath && fs.existsSync(oldPath)) {
      if (doc.type === 'RequestGroup' || doc.type === 'UnitTestSuite') {
        const oldDir = oldPath;
        const newDir = filePath;
        if (oldDir !== newDir && fs.existsSync(oldDir)) {
          const parentNewDir = fsPath.dirname(newDir);
          if (!fs.existsSync(parentNewDir)) {
            fs.mkdirSync(parentNewDir, { recursive: true });
          }
          try {
            fs.renameSync(oldDir, newDir);
          } catch (e) {
            console.error('[local-sync] Failed to rename dir', e);
          }
        }
      } else if (doc.type === 'Workspace') {
        const oldDir = fsPath.dirname(oldPath);
        const newDir = fsPath.dirname(filePath);
        if (oldDir !== newDir && fs.existsSync(oldDir)) {
          const parentNewDir = fsPath.dirname(newDir);
          if (!fs.existsSync(parentNewDir)) {
            fs.mkdirSync(parentNewDir, { recursive: true });
          }
          try {
            fs.renameSync(oldDir, newDir);
          } catch (e) {
            console.error('[local-sync] Failed to rename dir', e);
          }
        }
      } else {
        try {
          fs.unlinkSync(oldPath);
        } catch (e) {}
      }
    }

    idToPathMap.set(doc._id, filePath);

    if (doc.type === 'RequestGroup' || doc.type === 'UnitTestSuite') {
      if (!fs.existsSync(filePath)) {
        fs.mkdirSync(filePath, { recursive: true });
      }
      return; // Do not write JSON file for these containers!
    }

    const dir = fsPath.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = JSON.stringify(cleanDoc(doc), null, 2);
    
    if (writeTimers.has(filePath)) {
      clearTimeout(writeTimers.get(filePath)!);
    }
    
    writeTimers.set(filePath, setTimeout(() => {
      fs.writeFileSync(filePath, content, 'utf8');
      writeTimers.delete(filePath);
    }, 500));
  } else if (event === 'remove') {
    if (writeTimers.has(filePath)) {
      clearTimeout(writeTimers.get(filePath)!);
      writeTimers.delete(filePath);
    }
    
    if (doc.type === 'RequestGroup' || doc.type === 'UnitTestSuite') {
      if (fs.existsSync(filePath)) {
        try {
          fs.rmSync(filePath, { recursive: true, force: true });
        } catch(e) {}
      }
    } else {
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch(e) {}
      }
      
      if (doc.type === 'Workspace') {
        const workspacePath = fsPath.dirname(filePath);
        if (fs.existsSync(workspacePath)) {
          try {
            fs.rmSync(workspacePath, { recursive: true, force: true });
          } catch(e) {}
        }
      }
    }
  }
}
