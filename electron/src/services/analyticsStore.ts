import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";

interface RecordEventInput {
  sessionId: string;
  kind: "app_switch" | "mode_enter" | "mode_exit" | "command_run" | "voice_start";
  app: string | null;
  payload: string | null;
}

interface DayInput {
  totalFocusSecs: number;
  codingSecs: number;
  researchSecs: number;
  commandsRun: number;
  sessionsCount: number;
}

export interface DailyStat {
  date: string;
  total_focus_secs: number;
  coding_secs: number;
  research_secs: number;
  commands_run: number;
  sessions_count: number;
}

export interface WeeklyRollup {
  totalFocusSecs: number;
  codingSecs: number;
  researchSecs: number;
  commandsRun: number;
  sessionsCount: number;
  dominantMode: "coding" | "research" | "balanced";
  avgDailyFocusMins: number;
}

export function recordFocusEvent(db: Database, input: RecordEventInput): void {
  db.prepare(`
    INSERT INTO focus_events (id, session_id, kind, app, payload, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), input.sessionId, input.kind, input.app, input.payload, new Date().toISOString());
}

export function upsertDailyStat(db: Database, date: string, input: DayInput): void {
  db.prepare(`
    INSERT INTO daily_stats (date, total_focus_secs, coding_secs, research_secs, commands_run, sessions_count)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      total_focus_secs = total_focus_secs + excluded.total_focus_secs,
      coding_secs      = coding_secs      + excluded.coding_secs,
      research_secs    = research_secs    + excluded.research_secs,
      commands_run     = commands_run     + excluded.commands_run,
      sessions_count   = sessions_count   + excluded.sessions_count
  `).run(date, input.totalFocusSecs, input.codingSecs, input.researchSecs, input.commandsRun, input.sessionsCount);
}

export function getDailyStats(db: Database, days = 7): DailyStat[] {
  return db.prepare(
    "SELECT * FROM daily_stats ORDER BY date DESC LIMIT ?"
  ).all(days) as DailyStat[];
}

export function getWeeklyRollup(db: Database): WeeklyRollup {
  const rows = getDailyStats(db, 7);
  const totalFocusSecs = rows.reduce((s, r) => s + r.total_focus_secs, 0);
  const codingSecs     = rows.reduce((s, r) => s + r.coding_secs, 0);
  const researchSecs   = rows.reduce((s, r) => s + r.research_secs, 0);
  const commandsRun    = rows.reduce((s, r) => s + r.commands_run, 0);
  const sessionsCount  = rows.reduce((s, r) => s + r.sessions_count, 0);

  let dominantMode: "coding" | "research" | "balanced" = "balanced";
  const ratio = totalFocusSecs > 0 ? codingSecs / totalFocusSecs : 0.5;
  if (ratio > 0.6) dominantMode = "coding";
  else if (ratio < 0.4) dominantMode = "research";

  return {
    totalFocusSecs,
    codingSecs,
    researchSecs,
    commandsRun,
    sessionsCount,
    dominantMode,
    avgDailyFocusMins: rows.length > 0 ? Math.round(totalFocusSecs / rows.length / 60) : 0,
  };
}
