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

CREATE TABLE IF NOT EXISTS focus_events (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  app         TEXT,
  payload     TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_stats (
  date           TEXT PRIMARY KEY,
  total_focus_secs INTEGER NOT NULL DEFAULT 0,
  coding_secs      INTEGER NOT NULL DEFAULT 0,
  research_secs    INTEGER NOT NULL DEFAULT 0,
  commands_run     INTEGER NOT NULL DEFAULT 0,
  sessions_count   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS licenses (
  key          TEXT PRIMARY KEY,
  email        TEXT,
  plan         TEXT NOT NULL DEFAULT 'pro',
  activated_at TEXT NOT NULL,
  expires_at   TEXT
);

CREATE TABLE IF NOT EXISTS context_capsules (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  vscode_json  TEXT,
  chrome_json  TEXT,
  windows_json TEXT,
  created_at   TEXT NOT NULL
);
`;

export function ensureDatabase(dbPath = process.env.FLOWOS_DB_PATH ?? "./data/flowos.db") {
  if (dbPath === ":memory:") {
    const db = new Database(":memory:");
    db.exec(baseSchemaSql);
    return db;
  }

  const absolutePath = resolve(dbPath);
  mkdirSync(dirname(absolutePath), { recursive: true });

  const db = new Database(absolutePath);
  db.exec(baseSchemaSql);

  return db;
}

export interface FocusEvent {
  id: string;
  session_id: string;
  kind: "app_switch" | "mode_enter" | "mode_exit" | "command_run" | "voice_start";
  app: string | null;
  payload: string | null;
  occurred_at: string;
}

export interface DailyStat {
  date: string;
  total_focus_secs: number;
  coding_secs: number;
  research_secs: number;
  commands_run: number;
  sessions_count: number;
}

export interface License {
  key: string;
  email: string | null;
  plan: string;
  activated_at: string;
  expires_at: string | null;
}
