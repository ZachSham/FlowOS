import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const baseSchemaSql = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  mode TEXT NOT NULL,
  task_title TEXT,
  flow_score REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS layouts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  learned INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  payload TEXT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
`;

export function ensureDatabase(dbPath = process.env.FLOWOS_DB_PATH ?? "./data/flowos.db") {
  const absolutePath = resolve(dbPath);
  mkdirSync(dirname(absolutePath), { recursive: true });

  const db = new Database(absolutePath);
  db.exec(baseSchemaSql);

  return db;
}
