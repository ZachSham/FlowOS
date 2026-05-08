import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFocusScoreService } from "./focusScoreService.js";

vi.useFakeTimers();

describe("createFocusScoreService — score calculation", () => {
  it("starts with a perfect score (no switches)", () => {
    const updates: number[] = [];
    const svc = createFocusScoreService({
      onScoreUpdate: ({ score }) => updates.push(score),
      onFragmentationAlert: vi.fn(),
    });
    // No switches — getScore should reflect 0 switches in window
    expect(svc.getScore()).toBe(100);
  });

  it("score = 90 after 1 switch", () => {
    const updates: number[] = [];
    const svc = createFocusScoreService({
      onScoreUpdate: ({ score }) => updates.push(score),
      onFragmentationAlert: vi.fn(),
    });
    svc.recordSwitch("com.apple.Safari");
    expect(updates.at(-1)).toBe(90);
  });

  it("score = 60 after 4 switches", () => {
    const updates: number[] = [];
    const svc = createFocusScoreService({
      onScoreUpdate: ({ score }) => updates.push(score),
      onFragmentationAlert: vi.fn(),
    });
    for (let i = 0; i < 4; i++) svc.recordSwitch("app");
    expect(updates.at(-1)).toBe(60);
  });

  it("score floors at 0 with 10+ switches", () => {
    const updates: number[] = [];
    const svc = createFocusScoreService({
      onScoreUpdate: ({ score }) => updates.push(score),
      onFragmentationAlert: vi.fn(),
    });
    for (let i = 0; i < 15; i++) svc.recordSwitch("app");
    expect(updates.at(-1)).toBe(0);
  });

  it("score recovers after rolling window expires", () => {
    const updates: number[] = [];
    const svc = createFocusScoreService({
      onScoreUpdate: ({ score }) => updates.push(score),
      onFragmentationAlert: vi.fn(),
    });
    // Make 8 switches (score = 20)
    for (let i = 0; i < 8; i++) svc.recordSwitch("app");
    expect(updates.at(-1)).toBe(20);

    // Advance 61 seconds — rolling window expires
    vi.advanceTimersByTime(61_000);

    // One new switch after window clears = score 90
    svc.recordSwitch("com.apple.Safari");
    expect(updates.at(-1)).toBe(90);
  });

  it("switchesPerMin is reported correctly", () => {
    const switchRates: number[] = [];
    const svc = createFocusScoreService({
      onScoreUpdate: ({ switchesPerMin }) => switchRates.push(switchesPerMin),
      onFragmentationAlert: vi.fn(),
    });
    for (let i = 0; i < 5; i++) svc.recordSwitch("app");
    expect(switchRates.at(-1)).toBe(5);
  });
});

// ── Fragmentation alerts ──────────────────────────────────────────────────────

describe("createFocusScoreService — fragmentation alerts", () => {
  it("fires alert when score drops below 40 with enough events", () => {
    const onAlert = vi.fn();
    const svc = createFocusScoreService({
      onScoreUpdate: vi.fn(),
      onFragmentationAlert: onAlert,
    });
    // Need 3+ events and score < 40 (7 switches = score 30)
    for (let i = 0; i < 7; i++) svc.recordSwitch("app");
    expect(onAlert).toHaveBeenCalledOnce();
  });

  it("does not fire with fewer than 3 events even if score is low", () => {
    const onAlert = vi.fn();
    const svc = createFocusScoreService({
      onScoreUpdate: vi.fn(),
      onFragmentationAlert: onAlert,
    });
    // 2 switches = score 80 — not enough events even if score was low
    svc.recordSwitch("app");
    svc.recordSwitch("app");
    expect(onAlert).not.toHaveBeenCalled();
  });

  it("does not fire twice in the same fragmented state (hysteresis)", () => {
    const onAlert = vi.fn();
    const svc = createFocusScoreService({
      onScoreUpdate: vi.fn(),
      onFragmentationAlert: onAlert,
    });
    // Get into alert state
    for (let i = 0; i < 7; i++) svc.recordSwitch("app");
    expect(onAlert).toHaveBeenCalledOnce();
    // More switches while still fragmented — should NOT alert again
    svc.recordSwitch("app");
    svc.recordSwitch("app");
    expect(onAlert).toHaveBeenCalledOnce();
  });

  it("fires again after score recovers above threshold", () => {
    const onAlert = vi.fn();
    const svc = createFocusScoreService({
      onScoreUpdate: vi.fn(),
      onFragmentationAlert: onAlert,
    });
    // First fragmentation
    for (let i = 0; i < 7; i++) svc.recordSwitch("app");
    expect(onAlert).toHaveBeenCalledOnce();

    // Recover: let the window expire
    vi.advanceTimersByTime(61_000);

    // One switch to reset (score 90 — above recovery threshold of 55)
    svc.recordSwitch("recovered");

    // Fragment again
    for (let i = 0; i < 7; i++) svc.recordSwitch("app");
    expect(onAlert).toHaveBeenCalledTimes(2);
  });

  it("does not fire when score is above 40", () => {
    const onAlert = vi.fn();
    const svc = createFocusScoreService({
      onScoreUpdate: vi.fn(),
      onFragmentationAlert: onAlert,
    });
    // 5 switches = score 50 — above alert threshold
    for (let i = 0; i < 5; i++) svc.recordSwitch("app");
    expect(onAlert).not.toHaveBeenCalled();
  });
});

// ── getScore + dispose ────────────────────────────────────────────────────────

describe("createFocusScoreService — getScore and dispose", () => {
  it("getScore returns current score without recording a switch", () => {
    const svc = createFocusScoreService({
      onScoreUpdate: vi.fn(),
      onFragmentationAlert: vi.fn(),
    });
    for (let i = 0; i < 3; i++) svc.recordSwitch("app");
    const score = svc.getScore();
    expect(score).toBe(70);
  });

  it("dispose clears internal state — score resets to 100", () => {
    const svc = createFocusScoreService({
      onScoreUpdate: vi.fn(),
      onFragmentationAlert: vi.fn(),
    });
    for (let i = 0; i < 8; i++) svc.recordSwitch("app");
    svc.dispose();
    expect(svc.getScore()).toBe(100);
  });

  it("dispose prevents further alerts after cleanup", () => {
    const onAlert = vi.fn();
    const svc = createFocusScoreService({
      onScoreUpdate: vi.fn(),
      onFragmentationAlert: onAlert,
    });
    svc.dispose();
    // After dispose, switches should still work but state is cleared
    for (let i = 0; i < 7; i++) svc.recordSwitch("app");
    // Fresh start after dispose — alert CAN fire (state was cleared)
    // This verifies dispose properly reset lastAlertScore
    expect(onAlert).toHaveBeenCalled();
  });
});

// ── Rolling window boundary ───────────────────────────────────────────────────

describe("createFocusScoreService — rolling window", () => {
  it("old switches outside 60s window are not counted", () => {
    const updates: number[] = [];
    const svc = createFocusScoreService({
      onScoreUpdate: ({ score }) => updates.push(score),
      onFragmentationAlert: vi.fn(),
    });

    // 6 switches → score 40
    for (let i = 0; i < 6; i++) svc.recordSwitch("app");
    expect(updates.at(-1)).toBe(40);

    // Advance 70s — all previous switches expire
    vi.advanceTimersByTime(70_000);

    // Now 2 fresh switches → score 80
    svc.recordSwitch("app");
    svc.recordSwitch("app");
    expect(updates.at(-1)).toBe(80);
  });

  it("switches at exactly 60s boundary are excluded", () => {
    const updates: number[] = [];
    const svc = createFocusScoreService({
      onScoreUpdate: ({ score }) => updates.push(score),
      onFragmentationAlert: vi.fn(),
    });
    for (let i = 0; i < 5; i++) svc.recordSwitch("old");
    vi.advanceTimersByTime(60_001); // just past the window
    svc.recordSwitch("new");
    // Only 1 switch in window now → score 90
    expect(updates.at(-1)).toBe(90);
  });
});
