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

  it("returns balanced when coding and research are roughly equal", () => {
    upsertDailyStat(db, "2026-05-06", { totalFocusSecs: 2000, codingSecs: 1000, researchSecs: 1000, commandsRun: 0, sessionsCount: 1 });
    const rollup = getWeeklyRollup(db);
    expect(rollup.dominantMode).toBe("balanced");
  });

  it("returns research when research > 60% of total", () => {
    upsertDailyStat(db, "2026-05-06", { totalFocusSecs: 1000, codingSecs: 300, researchSecs: 700, commandsRun: 0, sessionsCount: 1 });
    const rollup = getWeeklyRollup(db);
    expect(rollup.dominantMode).toBe("research");
  });

  it("returns avgDailyFocusMins as 0 when no data", () => {
    const rollup = getWeeklyRollup(db);
    expect(rollup.avgDailyFocusMins).toBe(0);
    expect(rollup.totalFocusSecs).toBe(0);
    expect(rollup.dominantMode).toBe("balanced");
  });

  it("caps getDailyStats to 7 rows even if more exist", () => {
    for (let i = 1; i <= 10; i++) {
      upsertDailyStat(db, `2026-05-${String(i).padStart(2, "0")}`, { totalFocusSecs: 100, codingSecs: 100, researchSecs: 0, commandsRun: 0, sessionsCount: 1 });
    }
    const rows = getDailyStats(db, 7);
    expect(rows).toHaveLength(7);
  });
});

describe("recordFocusEvent — all kinds", () => {
  it("stores each valid event kind without error", () => {
    const kinds = ["app_switch", "mode_enter", "mode_exit", "command_run", "voice_start"] as const;
    for (const kind of kinds) {
      recordFocusEvent(db, { sessionId: "s1", kind, app: "com.apple.Xcode", payload: null });
    }
    const rows = db.prepare("SELECT kind FROM focus_events").all() as Array<{ kind: string }>;
    expect(rows.map((r) => r.kind).sort()).toEqual([...kinds].sort());
  });

  it("stores payload JSON string", () => {
    recordFocusEvent(db, { sessionId: "s1", kind: "command_run", app: null, payload: JSON.stringify({ transcript: "open file" }) });
    const row = db.prepare("SELECT payload FROM focus_events").get() as { payload: string };
    expect(JSON.parse(row.payload)).toMatchObject({ transcript: "open file" });
  });
});
