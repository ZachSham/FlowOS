import { describe, it, expect, beforeEach } from "vitest";
import { ensureDatabase } from "@flowos/db";
import {
  recordFocusEvent,
  upsertDailyStat,
  getDailyStats,
  getWeeklyRollup,
} from "./analyticsStore.js";

let db: ReturnType<typeof ensureDatabase>;

beforeEach(() => {
  db = ensureDatabase(":memory:");
});

describe("recordFocusEvent", () => {
  it("inserts a focus event with generated id", () => {
    recordFocusEvent(db, { sessionId: "s1", kind: "mode_enter", app: null, payload: null });
    const rows = db.prepare("SELECT * FROM focus_events").all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!["kind"]).toBe("mode_enter");
    expect(typeof rows[0]!["id"]).toBe("string");
  });
});

describe("upsertDailyStat", () => {
  it("inserts a new row for a date", () => {
    upsertDailyStat(db, "2026-05-06", { totalFocusSecs: 1800, codingSecs: 1200, researchSecs: 600, commandsRun: 5, sessionsCount: 1 });
    const row = db.prepare("SELECT * FROM daily_stats WHERE date = '2026-05-06'").get() as Record<string, unknown>;
    expect(row!["total_focus_secs"]).toBe(1800);
  });

  it("accumulates on existing row", () => {
    upsertDailyStat(db, "2026-05-06", { totalFocusSecs: 1000, codingSecs: 1000, researchSecs: 0, commandsRun: 2, sessionsCount: 1 });
    upsertDailyStat(db, "2026-05-06", { totalFocusSecs: 500, codingSecs: 0, researchSecs: 500, commandsRun: 1, sessionsCount: 1 });
    const row = db.prepare("SELECT * FROM daily_stats WHERE date = '2026-05-06'").get() as Record<string, unknown>;
    expect(row!["total_focus_secs"]).toBe(1500);
    expect(row!["coding_secs"]).toBe(1000);
    expect(row!["research_secs"]).toBe(500);
  });
});

describe("getDailyStats", () => {
  it("returns last N days ordered by date desc", () => {
    upsertDailyStat(db, "2026-05-04", { totalFocusSecs: 100, codingSecs: 100, researchSecs: 0, commandsRun: 1, sessionsCount: 1 });
    upsertDailyStat(db, "2026-05-05", { totalFocusSecs: 200, codingSecs: 200, researchSecs: 0, commandsRun: 2, sessionsCount: 1 });
    const rows = getDailyStats(db, 7);
    expect(rows[0]!.date).toBe("2026-05-05");
    expect(rows).toHaveLength(2);
  });
});

describe("getWeeklyRollup", () => {
  it("sums total_focus_secs across 7 days", () => {
    upsertDailyStat(db, "2026-05-05", { totalFocusSecs: 3600, codingSecs: 3600, researchSecs: 0, commandsRun: 10, sessionsCount: 2 });
    upsertDailyStat(db, "2026-05-06", { totalFocusSecs: 1800, codingSecs: 0, researchSecs: 1800, commandsRun: 5, sessionsCount: 1 });
    const rollup = getWeeklyRollup(db);
    expect(rollup.totalFocusSecs).toBe(5400);
    expect(rollup.dominantMode).toBe("coding");
  });
});
