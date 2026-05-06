import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { baseSchemaSql } from "@flowos/db";
import { startSession, endSession, getRecentSessions } from "./sessionStore.js";

function makeTestDb() {
  const db = new Database(":memory:");
  db.exec(baseSchemaSql);
  return db;
}

describe("sessionStore", () => {
  let db: ReturnType<typeof makeTestDb>;

  beforeEach(() => {
    db = makeTestDb();
  });

  it("startSession inserts a row and returns an id", () => {
    const id = startSession(db, "coding");
    const rows = getRecentSessions(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(id);
    expect(rows[0]?.mode).toBe("coding");
    expect(rows[0]?.ended_at).toBeNull();
  });

  it("endSession sets ended_at", () => {
    const id = startSession(db, "research");
    endSession(db, id);
    const rows = getRecentSessions(db);
    expect(rows[0]?.ended_at).not.toBeNull();
  });

  it("getRecentSessions returns newest first", () => {
    const id1 = startSession(db, "coding");
    const id2 = startSession(db, "research");
    const rows = getRecentSessions(db);
    expect(rows[0]?.id).toBe(id2);
    expect(rows[1]?.id).toBe(id1);
  });
});
