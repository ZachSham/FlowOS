import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  mode: string;
  task_title: string | null;
  flow_score: number;
}

export function startSession(db: InstanceType<typeof Database>, mode: string): string {
  const id = randomUUID();
  db.prepare("INSERT INTO sessions (id, started_at, mode) VALUES (?, ?, ?)").run(
    id,
    new Date().toISOString(),
    mode
  );
  return id;
}

export function endSession(db: InstanceType<typeof Database>, id: string): void {
  db.prepare("UPDATE sessions SET ended_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}

export function getRecentSessions(
  db: InstanceType<typeof Database>,
  limit = 20
): SessionRow[] {
  return db
    .prepare<SessionRow>("SELECT * FROM sessions ORDER BY started_at DESC, rowid DESC LIMIT ?")
    .all(limit);
}
