import { describe, it, expect, beforeEach } from "vitest";
import { ensureDatabase } from "@flowos/db";
import {
  saveCapsule,
  listCapsules,
  getCapsule,
  deleteCapsule,
  type CapsuleVscodeState,
  type CapsuleChromTab,
  type CapsuleWindowFrame,
} from "./capsuleStore.js";

let db: ReturnType<typeof ensureDatabase>;

const vscode: CapsuleVscodeState = {
  activeFile: "/Users/test/project/src/main.ts",
  activeLine: 42,
  openTabs: ["/Users/test/project/src/main.ts", "/Users/test/project/src/utils.ts"],
  workspaceRoot: "/Users/test/project",
};

const chrome: CapsuleChromTab[] = [
  { url: "https://github.com/org/repo/pull/123", title: "PR #123", pinned: false, active: true },
  { url: "https://docs.example.com", title: "Docs", pinned: true, active: false },
];

const windows: CapsuleWindowFrame[] = [
  { windowId: "win-1", appName: "Code", bundleId: "com.microsoft.VSCode", x: 0, y: 25, width: 1440, height: 900 },
  { windowId: "win-2", appName: "Terminal", bundleId: "com.apple.Terminal", x: 0, y: 700, width: 800, height: 400 },
];

beforeEach(() => {
  db = ensureDatabase(":memory:");
});

// ── saveCapsule ──────────────────────────────────────────────────────────────

describe("saveCapsule", () => {
  it("saves and returns a capsule with all fields", () => {
    const c = saveCapsule(db, "Morning", vscode, chrome, windows);
    expect(c.id).toBeTruthy();
    expect(c.name).toBe("Morning");
    expect(c.vscode?.activeFile).toBe("/Users/test/project/src/main.ts");
    expect(c.vscode?.activeLine).toBe(42);
    expect(c.chrome).toHaveLength(2);
    expect(c.windows).toHaveLength(2);
    expect(c.created_at).toBeTruthy();
  });

  it("saves capsule with null vscode (not connected)", () => {
    const c = saveCapsule(db, "No VS Code", null, chrome, windows);
    expect(c.vscode).toBeNull();
    expect(c.chrome).toHaveLength(2);
  });

  it("saves capsule with empty chrome array", () => {
    const c = saveCapsule(db, "No Browser", vscode, [], windows);
    expect(c.chrome).toEqual([]);
  });

  it("saves capsule with empty windows array", () => {
    const c = saveCapsule(db, "No Windows", vscode, chrome, []);
    expect(c.windows).toEqual([]);
  });

  it("saves a minimal capsule (all optional data empty)", () => {
    const c = saveCapsule(db, "Empty", null, [], []);
    expect(c.id).toBeTruthy();
    expect(c.vscode).toBeNull();
    expect(c.chrome).toEqual([]);
    expect(c.windows).toEqual([]);
  });

  it("generates unique IDs for each capsule", () => {
    const a = saveCapsule(db, "A", null, [], []);
    const b = saveCapsule(db, "B", null, [], []);
    expect(a.id).not.toBe(b.id);
  });

  it("persists data correctly to SQLite — round-trip check", () => {
    saveCapsule(db, "Round-trip", vscode, chrome, windows);
    const row = db.prepare("SELECT * FROM context_capsules").get() as {
      vscode_json: string;
      chrome_json: string;
      windows_json: string;
    };
    const parsedVscode = JSON.parse(row.vscode_json) as CapsuleVscodeState;
    const parsedChrome = JSON.parse(row.chrome_json) as CapsuleChromTab[];
    const parsedWindows = JSON.parse(row.windows_json) as CapsuleWindowFrame[];
    expect(parsedVscode.activeLine).toBe(42);
    expect(parsedChrome[0]?.url).toBe("https://github.com/org/repo/pull/123");
    expect(parsedWindows[1]?.appName).toBe("Terminal");
  });

  it("handles names with special characters", () => {
    const c = saveCapsule(db, "Client A — backend 🔥", vscode, [], []);
    expect(c.name).toBe("Client A — backend 🔥");
  });

  it("handles very long open tabs list", () => {
    const manyTabs = Array.from({ length: 50 }, (_, i) => ({
      url: `https://example.com/${i}`,
      title: `Tab ${i}`,
      pinned: false,
      active: i === 0,
    }));
    const c = saveCapsule(db, "Many tabs", vscode, manyTabs, []);
    expect(c.chrome).toHaveLength(50);
  });
});

// ── listCapsules ─────────────────────────────────────────────────────────────

describe("listCapsules", () => {
  it("returns empty array when no capsules saved", () => {
    expect(listCapsules(db)).toEqual([]);
  });

  it("returns capsules ordered newest-first", () => {
    saveCapsule(db, "First", null, [], []);
    saveCapsule(db, "Second", null, [], []);
    saveCapsule(db, "Third", null, [], []);
    const list = listCapsules(db);
    expect(list[0]?.name).toBe("Third");
    expect(list[2]?.name).toBe("First");
  });

  it("caps list at 20 capsules", () => {
    for (let i = 0; i < 25; i++) {
      saveCapsule(db, `Capsule ${i}`, null, [], []);
    }
    expect(listCapsules(db)).toHaveLength(20);
  });

  it("deserializes vscode/chrome/windows back correctly", () => {
    saveCapsule(db, "Test", vscode, chrome, windows);
    const list = listCapsules(db);
    expect(list[0]?.vscode?.activeFile).toBe("/Users/test/project/src/main.ts");
    expect(list[0]?.chrome[0]?.url).toBe("https://github.com/org/repo/pull/123");
    expect(list[0]?.windows[0]?.appName).toBe("Code");
  });

  it("handles null vscode_json gracefully", () => {
    saveCapsule(db, "No vscode", null, [], []);
    const list = listCapsules(db);
    expect(list[0]?.vscode).toBeNull();
  });
});

// ── getCapsule ────────────────────────────────────────────────────────────────

describe("getCapsule", () => {
  it("returns the correct capsule by id", () => {
    const saved = saveCapsule(db, "Specific", vscode, chrome, windows);
    const fetched = getCapsule(db, saved.id);
    expect(fetched?.id).toBe(saved.id);
    expect(fetched?.name).toBe("Specific");
  });

  it("returns undefined for unknown id", () => {
    expect(getCapsule(db, "non-existent-id")).toBeUndefined();
  });

  it("returns the right capsule when multiple exist", () => {
    saveCapsule(db, "A", null, [], []);
    const target = saveCapsule(db, "Target", vscode, [], []);
    saveCapsule(db, "C", null, [], []);
    const fetched = getCapsule(db, target.id);
    expect(fetched?.name).toBe("Target");
    expect(fetched?.vscode?.workspaceRoot).toBe("/Users/test/project");
  });
});

// ── deleteCapsule ─────────────────────────────────────────────────────────────

describe("deleteCapsule", () => {
  it("removes the capsule from the database", () => {
    const c = saveCapsule(db, "ToDelete", null, [], []);
    deleteCapsule(db, c.id);
    expect(getCapsule(db, c.id)).toBeUndefined();
  });

  it("does not remove other capsules", () => {
    const a = saveCapsule(db, "Keep A", null, [], []);
    const b = saveCapsule(db, "Delete B", null, [], []);
    const c = saveCapsule(db, "Keep C", null, [], []);
    deleteCapsule(db, b.id);
    expect(getCapsule(db, a.id)).toBeDefined();
    expect(getCapsule(db, c.id)).toBeDefined();
    expect(getCapsule(db, b.id)).toBeUndefined();
  });

  it("is a no-op for unknown id", () => {
    saveCapsule(db, "Safe", null, [], []);
    expect(() => deleteCapsule(db, "unknown-id")).not.toThrow();
    expect(listCapsules(db)).toHaveLength(1);
  });
});
