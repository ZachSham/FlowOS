import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { baseSchemaSql } from "@flowos/db";
import { saveLayout, listLayouts, deleteLayout } from "./layoutStore.js";

function makeTestDb() {
  const db = new Database(":memory:");
  db.exec(baseSchemaSql);
  return db;
}

const sampleConfig = [{ windowId: "ax:123:0", appName: "Cursor", x: 0, y: 0, width: 800, height: 600 }];

describe("layoutStore", () => {
  let db: ReturnType<typeof makeTestDb>;

  beforeEach(() => {
    db = makeTestDb();
  });

  it("saveLayout persists and listLayouts retrieves it", () => {
    saveLayout(db, "My Coding Setup", "coding", sampleConfig);
    const layouts = listLayouts(db);
    expect(layouts).toHaveLength(1);
    expect(layouts[0]?.name).toBe("My Coding Setup");
    expect(layouts[0]?.config).toEqual(sampleConfig);
  });

  it("listLayouts returns newest first", () => {
    saveLayout(db, "Layout A", "coding", sampleConfig);
    saveLayout(db, "Layout B", "research", sampleConfig);
    const layouts = listLayouts(db);
    expect(layouts[0]?.name).toBe("Layout B");
  });

  it("deleteLayout removes the row", () => {
    const saved = saveLayout(db, "Temp", "coding", sampleConfig);
    deleteLayout(db, saved.id);
    expect(listLayouts(db)).toHaveLength(0);
  });
});
