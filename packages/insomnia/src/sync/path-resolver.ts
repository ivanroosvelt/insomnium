import { BaseModel } from '../models';
import { database as db } from '../common/database';
import fsPath from 'path';

export function sanitizeName(name: string): string {
  if (!name) return 'unnamed';
  return name.replace(/[\/\\?%*:|"<>\0]/g, '-').trim() || 'unnamed';
}

export async function resolvePath(doc: BaseModel, basePath: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docAny = doc as any;
  const ancestors = await db.withAncestors(doc);
  
  const workspace = ancestors.find(a => a.type === 'Workspace');
  if (!workspace) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workspacePath = fsPath.join(basePath, sanitizeName((workspace as any).name));

  if (doc.type === 'Workspace') {
    return fsPath.join(workspacePath, 'workspace.json');
  }

  const docName = docAny.name ? sanitizeName(docAny.name) : 'unnamed';
  const fileName = `${docName}.json`;

  if (doc.type === 'Environment') {
    return fsPath.join(workspacePath, 'environments', fileName);
  }

  if (doc.type === 'Request' || doc.type === 'GrpcRequest' || doc.type === 'WebSocketRequest') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const folders = ancestors.filter(a => a.type === 'RequestGroup').reverse().map(a => sanitizeName((a as any).name));
    return fsPath.join(workspacePath, 'requests', ...folders, fileName);
  }

  if (doc.type === 'RequestGroup') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const folders = ancestors.filter(a => a.type === 'RequestGroup').reverse().map(a => sanitizeName((a as any).name));
    return fsPath.join(workspacePath, 'requests', ...folders);
  }

  if (doc.type === 'UnitTest') {
    const suite = ancestors.find(a => a.type === 'UnitTestSuite');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const suiteName = suite ? sanitizeName((suite as any).name) : 'unknown-suite';
    return fsPath.join(workspacePath, 'tests', suiteName, fileName);
  }

  if (doc.type === 'UnitTestSuite') {
    return fsPath.join(workspacePath, 'tests', docName);
  }

  return null;
}
