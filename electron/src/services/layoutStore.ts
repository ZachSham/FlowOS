import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface LayoutWindowFrame {
  windowId: string;
  appName: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SavedLayout {
  id: string;
  name: string;
  mode: string;
  learned: boolean;
  config: LayoutWindowFrame[];
  createdAt: string;
}

interface LayoutRow {
  id: string;
  name: string;
  mode: string;
  learned: number;
  config_json: string;
  created_at: string;
}

export function saveLayout(
  db: InstanceType<typeof Database>,
  name: string,
  mode: string,
  config: LayoutWindowFrame[]
): SavedLayout {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO layouts (id, name, mode, learned, config_json, created_at) VALUES (?, ?, ?, 0, ?, ?)"
  ).run(id, name, mode, JSON.stringify(config), now);
  return { id, name, mode, learned: false, config, createdAt: now };
}

export function listLayouts(db: InstanceType<typeof Database>): SavedLayout[] {
  const rows = db
    .prepare<LayoutRow>("SELECT * FROM layouts ORDER BY created_at DESC, rowid DESC")
    .all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    mode: r.mode,
    learned: r.learned === 1,
    config: (() => { const p: unknown = JSON.parse(r.config_json); return Array.isArray(p) ? (p as LayoutWindowFrame[]) : []; })(),
    createdAt: r.created_at
  }));
}

export function getLayout(
  db: InstanceType<typeof Database>,
  id: string
): SavedLayout | undefined {
  const row = db
    .prepare<LayoutRow>("SELECT * FROM layouts WHERE id = ?")
    .get(id);
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    learned: row.learned === 1,
    config: (() => { const p: unknown = JSON.parse(row.config_json); return Array.isArray(p) ? (p as LayoutWindowFrame[]) : []; })(),
    createdAt: row.created_at
  };
}

export function deleteLayout(db: InstanceType<typeof Database>, id: string): void {
  db.prepare("DELETE FROM layouts WHERE id = ?").run(id);
}
