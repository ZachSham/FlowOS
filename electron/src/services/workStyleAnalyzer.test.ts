import { describe, it, expect } from "vitest";
import { analyzeWorkStyle, buildAnalysisContext } from "./workStyleAnalyzer.js";
import type { TrackingEventRecord } from "./trackingSession.js";
import type { AppSnapshot } from "@flowos/shared";

const NOW = new Date("2026-05-06T20:00:00Z").getTime();
const MIN = 60_000;

function makeEvent(
  bundleId: string,
  name: string,
  event: string,
  ageMinutes: number
): TrackingEventRecord {
  const timestamp = new Date(NOW - ageMinutes * MIN).toISOString();
  return {
    timestamp,
    event,
    summary: `${event} ${name}`,
    payload: { app: { bundleId, name, pid: 1234, isActive: true, isHidden: false }, timestamp }
  };
}

function makeApp(bundleId: string, name: string, isHidden = false): AppSnapshot {
  return { bundleId, name, pid: 1234, isActive: false, isHidden };
}

// ─── Mode detection ───────────────────────────────────────────────────────────

describe("analyzeWorkStyle — mode detection", () => {
  it("returns unclear when no events", () => {
    const result = analyzeWorkStyle([], [], NOW);
    expect(result.mode).toBe("unclear");
    expect(result.confidence).toBe(0);
  });

  it("detects coding mode from IDE activations", () => {
    const events = [
      makeEvent("com.microsoft.VSCode", "VS Code", "app.activated", 1),
      makeEvent("com.microsoft.VSCode", "VS Code", "app.activated", 3),
      makeEvent("com.microsoft.VSCode", "VS Code", "app.activated", 5),
      makeEvent("com.apple.Terminal", "Terminal", "app.activated", 2),
    ];
    const apps = [
      makeApp("com.microsoft.VSCode", "VS Code"),
      makeApp("com.apple.Terminal", "Terminal"),
    ];
    const result = analyzeWorkStyle(events, apps, NOW);
    expect(result.mode).toBe("coding");
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("detects research mode from browser + notes activations", () => {
    const events = [
      makeEvent("com.google.Chrome", "Chrome", "app.activated", 1),
      makeEvent("com.google.Chrome", "Chrome", "app.activated", 3),
      makeEvent("com.google.Chrome", "Chrome", "app.activated", 6),
      makeEvent("net.shinyfrog.bear", "Bear", "app.activated", 2),
      makeEvent("net.shinyfrog.bear", "Bear", "app.activated", 4),
    ];
    const apps = [
      makeApp("com.google.Chrome", "Chrome"),
      makeApp("net.shinyfrog.bear", "Bear"),
    ];
    const result = analyzeWorkStyle(events, apps, NOW);
    expect(result.mode).toBe("research");
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("detects mixed mode when IDE and browser are both heavily used", () => {
    const events = [
      makeEvent("com.todesktop.230313mzl4w4u92", "Cursor", "app.activated", 1),
      makeEvent("com.google.Chrome", "Chrome", "app.activated", 2),
      makeEvent("com.todesktop.230313mzl4w4u92", "Cursor", "app.activated", 3),
      makeEvent("com.google.Chrome", "Chrome", "app.activated", 4),
    ];
    const apps = [
      makeApp("com.todesktop.230313mzl4w4u92", "Cursor"),
      makeApp("com.google.Chrome", "Chrome"),
    ];
    const result = analyzeWorkStyle(events, apps, NOW);
    expect(result.mode).toBe("mixed");
  });
});

// ─── Recency decay ────────────────────────────────────────────────────────────

describe("analyzeWorkStyle — recency decay", () => {
  it("prefers recent app over older heavily-used app", () => {
    // Chrome used heavily 20+ minutes ago, VS Code used just now
    const events = [
      makeEvent("com.google.Chrome", "Chrome", "app.activated", 22),
      makeEvent("com.google.Chrome", "Chrome", "app.activated", 24),
      makeEvent("com.google.Chrome", "Chrome", "app.activated", 26),
      makeEvent("com.google.Chrome", "Chrome", "app.activated", 28),
      makeEvent("com.google.Chrome", "Chrome", "app.activated", 30),
      makeEvent("com.microsoft.VSCode", "VS Code", "app.activated", 1),
      makeEvent("com.microsoft.VSCode", "VS Code", "app.activated", 2),
    ];
    const apps = [
      makeApp("com.microsoft.VSCode", "VS Code"),
      makeApp("com.google.Chrome", "Chrome"),
    ];
    const result = analyzeWorkStyle(events, apps, NOW);
    // Recent VS Code should dominate despite fewer activations
    expect(result.mode).toBe("coding");
  });

  it("scores drop significantly after 15+ minutes", () => {
    const recent = [makeEvent("com.microsoft.VSCode", "VS Code", "app.activated", 1)];
    const stale = [makeEvent("com.microsoft.VSCode", "VS Code", "app.activated", 20)];
    const apps = [makeApp("com.microsoft.VSCode", "VS Code")];

    const r1 = analyzeWorkStyle(recent, apps, NOW);
    const r2 = analyzeWorkStyle(stale, apps, NOW);
    // Recent coding score should be at least 3× the stale one
    expect(r1.codingScore).toBeGreaterThan(r2.codingScore * 3);
  });
});

// ─── Burst detection ──────────────────────────────────────────────────────────

describe("analyzeWorkStyle — burst detection", () => {
  it("gives burst bonus to app with 3+ rapid activations", () => {
    const bursty = [
      makeEvent("com.microsoft.VSCode", "VS Code", "app.activated", 0.5),
      makeEvent("com.microsoft.VSCode", "VS Code", "app.activated", 1.0),
      makeEvent("com.microsoft.VSCode", "VS Code", "app.activated", 1.5),
    ];
    const nonBursty = [
      makeEvent("com.microsoft.VSCode", "VS Code", "app.activated", 1),
      makeEvent("com.microsoft.VSCode", "VS Code", "app.activated", 10),
      makeEvent("com.microsoft.VSCode", "VS Code", "app.activated", 20),
    ];
    const apps = [makeApp("com.microsoft.VSCode", "VS Code")];

    const r1 = analyzeWorkStyle(bursty, apps, NOW);
    const r2 = analyzeWorkStyle(nonBursty, apps, NOW);
    // Burst should produce a higher score
    expect(r1.codingScore).toBeGreaterThan(r2.codingScore);
  });
});

// ─── Primary / secondary assignment ──────────────────────────────────────────

describe("analyzeWorkStyle — app assignment", () => {
  it("assigns highest-scoring IDE as primary in coding mode", () => {
    const events = [
      makeEvent("com.todesktop.230313mzl4w4u92", "Cursor", "app.activated", 1),
      makeEvent("com.todesktop.230313mzl4w4u92", "Cursor", "app.activated", 2),
      makeEvent("com.apple.Terminal", "Terminal", "app.activated", 3),
    ];
    const apps = [
      makeApp("com.todesktop.230313mzl4w4u92", "Cursor"),
      makeApp("com.apple.Terminal", "Terminal"),
    ];
    const result = analyzeWorkStyle(events, apps, NOW);
    expect(result.primaryApp?.bundleId).toBe("com.todesktop.230313mzl4w4u92");
    expect(result.secondaryApp?.bundleId).toBe("com.apple.Terminal");
  });

  it("assigns browser as primary and notes as secondary in research mode", () => {
    const events = [
      makeEvent("com.google.Chrome", "Chrome", "app.activated", 1),
      makeEvent("com.google.Chrome", "Chrome", "app.activated", 2),
      makeEvent("com.google.Chrome", "Chrome", "app.activated", 3),
      makeEvent("md.obsidian", "Obsidian", "app.activated", 2),
      makeEvent("md.obsidian", "Obsidian", "app.activated", 4),
    ];
    const apps = [
      makeApp("com.google.Chrome", "Chrome"),
      makeApp("md.obsidian", "Obsidian"),
    ];
    const result = analyzeWorkStyle(events, apps, NOW);
    expect(result.primaryApp?.bundleId).toBe("com.google.Chrome");
    expect(result.secondaryApp?.bundleId).toBe("md.obsidian");
  });

  it("includes running apps not in events with zero score", () => {
    const events = [
      makeEvent("com.microsoft.VSCode", "VS Code", "app.activated", 1),
    ];
    const apps = [
      makeApp("com.microsoft.VSCode", "VS Code"),
      makeApp("com.tinyspeck.slackmacgap", "Slack"),  // running but not in events
    ];
    const result = analyzeWorkStyle(events, apps, NOW);
    const slack = [...result.appsToHide, ...result.appsToMinimize].find((a) => a.bundleId === "com.tinyspeck.slackmacgap");
    expect(slack).toBeDefined();
    expect(slack?.score).toBe(0);
  });
});

// ─── Role assignment ──────────────────────────────────────────────────────────

describe("analyzeWorkStyle — role assignment", () => {
  it("marks Slack and Discord as distractors in coding mode", () => {
    const events = [
      makeEvent("com.microsoft.VSCode", "VS Code", "app.activated", 1),
      makeEvent("com.microsoft.VSCode", "VS Code", "app.activated", 2),
      makeEvent("com.microsoft.VSCode", "VS Code", "app.activated", 3),
    ];
    const apps = [
      makeApp("com.microsoft.VSCode", "VS Code"),
      makeApp("com.tinyspeck.slackmacgap", "Slack"),
      makeApp("com.hnc.Discord", "Discord"),
    ];
    const result = analyzeWorkStyle(events, apps, NOW);
    expect(result.mode).toBe("coding");
    const distractors = result.appsToHide.map((a) => a.bundleId);
    expect(distractors).toContain("com.tinyspeck.slackmacgap");
    expect(distractors).toContain("com.hnc.Discord");
  });

  it("marks Spotify as grounding in research mode", () => {
    const events = [
      makeEvent("com.google.Chrome", "Chrome", "app.activated", 1),
      makeEvent("com.google.Chrome", "Chrome", "app.activated", 2),
      makeEvent("com.google.Chrome", "Chrome", "app.activated", 3),
      makeEvent("net.shinyfrog.bear", "Bear", "app.activated", 2),
    ];
    const apps = [
      makeApp("com.google.Chrome", "Chrome"),
      makeApp("net.shinyfrog.bear", "Bear"),
      makeApp("com.spotify.client", "Spotify"),
    ];
    const result = analyzeWorkStyle(events, apps, NOW);
    expect(result.mode).toBe("research");
    const spotify = result.appsToHide.find((a) => a.bundleId === "com.spotify.client");
    expect(spotify?.role).toBe("grounding");
  });
});

// ─── Unknown apps ─────────────────────────────────────────────────────────────

describe("analyzeWorkStyle — unknown app categorization", () => {
  it("categorizes unknown bundleId with 'terminal' in name as terminal", () => {
    const events = [
      makeEvent("com.some.custom.terminal", "MyTerminal", "app.activated", 1),
      makeEvent("com.some.custom.terminal", "MyTerminal", "app.activated", 2),
      makeEvent("com.some.custom.terminal", "MyTerminal", "app.activated", 3),
    ];
    const apps = [makeApp("com.some.custom.terminal", "MyTerminal")];
    const result = analyzeWorkStyle(events, apps, NOW);
    // Terminal contributes to coding signal
    expect(result.codingScore).toBeGreaterThan(result.researchScore);
  });
});

// ─── buildAnalysisContext ─────────────────────────────────────────────────────

describe("buildAnalysisContext", () => {
  it("returns brief message for unclear mode", () => {
    const result = analyzeWorkStyle([], [], NOW);
    const ctx = buildAnalysisContext(result);
    expect(ctx).toContain("insufficient tracking data");
  });

  it("includes primary and secondary bundleIds in output", () => {
    const events = [
      makeEvent("com.todesktop.230313mzl4w4u92", "Cursor", "app.activated", 1),
      makeEvent("com.todesktop.230313mzl4w4u92", "Cursor", "app.activated", 2),
      makeEvent("com.apple.Terminal", "Terminal", "app.activated", 3),
    ];
    const apps = [
      makeApp("com.todesktop.230313mzl4w4u92", "Cursor"),
      makeApp("com.apple.Terminal", "Terminal"),
    ];
    const analysis = analyzeWorkStyle(events, apps, NOW);
    const ctx = buildAnalysisContext(analysis);
    expect(ctx).toContain("com.todesktop.230313mzl4w4u92");
    expect(ctx).toContain("com.apple.Terminal");
    expect(ctx).toContain("PRIMARY");
    expect(ctx).toContain("SECONDARY");
  });
});
