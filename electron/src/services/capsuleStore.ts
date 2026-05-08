import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

type DB = InstanceType<typeof Database>;

export interface CapsuleVscodeState {
  activeFile: string | null;
  activeLine: number | null;
  openTabs: string[];
  workspaceRoot: string | null;
}

export interface CapsuleChromTab {
  url: string;
  title: string;
  pinned: boolean;
  active: boolean;
}

export interface CapsuleWindowFrame {
  windowId: string;
  appName: string;
  bundleId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContextCapsule {
  id: string;
  name: string;
  vscode: CapsuleVscodeState | null;
  chrome: CapsuleChromTab[];
  windows: CapsuleWindowFrame[];
  created_at: string;
}

interface CapsuleRow {
  id: string;
  name: string;
  vscode_json: string | null;
  chrome_json: string | null;
  windows_json: string | null;
  created_at: string;
}

function rowToCapsule(row: CapsuleRow): ContextCapsule {
  return {
    id: row.id,
    name: row.name,
    vscode: row.vscode_json ? JSON.parse(row.vscode_json) as CapsuleVscodeState : null,
    chrome: row.chrome_json ? JSON.parse(row.chrome_json) as CapsuleChromTab[] : [],
    windows: row.windows_json ? JSON.parse(row.windows_json) as CapsuleWindowFrame[] : [],
    created_at: row.created_at,
  };
}

export function saveCapsule(
  db: DB,
  name: string,
  vscode: CapsuleVscodeState | null,
  chrome: CapsuleChromTab[],
  windows: CapsuleWindowFrame[]
): ContextCapsule {
  const id = randomUUID();
  const created_at = new Date().toISOString();
  db.prepare(`
    INSERT INTO context_capsules (id, name, vscode_json, chrome_json, windows_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    vscode ? JSON.stringify(vscode) : null,
    chrome.length > 0 ? JSON.stringify(chrome) : null,
    windows.length > 0 ? JSON.stringify(windows) : null,
    created_at
  );
  return { id, name, vscode, chrome, windows, created_at };
}

export function listCapsules(db: DB): ContextCapsule[] {
  const rows = db.prepare(
    "SELECT * FROM context_capsules ORDER BY created_at DESC, rowid DESC LIMIT 20"
  ).all() as CapsuleRow[];
  return rows.map(rowToCapsule);
}

export function getCapsule(db: DB, id: string): ContextCapsule | undefined {
  const row = db.prepare("SELECT * FROM context_capsules WHERE id = ?").get(id) as CapsuleRow | undefined;
  return row ? rowToCapsule(row) : undefined;
}

export function deleteCapsule(db: DB, id: string): void {
  db.prepare("DELETE FROM context_capsules WHERE id = ?").run(id);
}
