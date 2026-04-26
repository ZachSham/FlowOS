// electron/src/services/contextTriggerService.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startContextTriggerService } from "./contextTriggerService.js";
import type { NativeHelperBridge } from "../bridge/swiftHelper.js";
import type { TrackingSession } from "./trackingSession.js";

function makeEvent(appName: string) {
  return {
    kind: "event" as const,
    event: "app.activated" as const,
    payload: { timestamp: new Date().toISOString(), app: { name: appName, bundleId: "com.example", pid: 1, isActive: true, isHidden: false } }
  };
}

function makeBridge(): NativeHelperBridge & { fire: (e: unknown) => void } {
  let capturedListener: ((e: unknown) => void) | null = null;
  const bridge = {
    onEvent: vi.fn().mockImplementation((listener: (e: unknown) => void) => {
      capturedListener = listener;
      return () => { capturedListener = null; };
    }),
    fire(event: unknown) { capturedListener?.(event); },
    request: vi.fn(),
    getStatus: vi.fn().mockReturnValue({ connected: false, transport: "stdio", command: [] }),
    stop: vi.fn()
  };
  return bridge as unknown as NativeHelperBridge & { fire: (e: unknown) => void };
}

function makeSession(): TrackingSession {
  return {
    getSummary: vi.fn().mockReturnValue({
      isTracking: false,
      startedAt: null,
      eventCount: 0,
      recentEvents: [],
      countsByEvent: {}
    }),
    getState: vi.fn(),
    start: vi.fn(),
    record: vi.fn()
  } as unknown as TrackingSession;
}

function mockGptTrigger(mode: "coding" | "research") {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ trigger: true, mode, reason: "test" }) } }]
    })
  }));
}

describe("contextTriggerService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env["OPENAI_API_KEY"] = "test-key";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env["OPENAI_API_KEY"];
  });

  it("calls onTrigger after 8s of sustained focus", async () => {
    mockGptTrigger("coding");
    const bridge = makeBridge();
    const onTrigger = vi.fn();
    startContextTriggerService(bridge, makeSession(), () => "idle", onTrigger);

    bridge.fire(makeEvent("Cursor"));
    await vi.advanceTimersByTimeAsync(8000);

    expect(onTrigger).toHaveBeenCalledWith("coding");
  });

  it("resets debounce when a second app.activated fires before 8s", async () => {
    mockGptTrigger("coding");
    const bridge = makeBridge();
    const onTrigger = vi.fn();
    startContextTriggerService(bridge, makeSession(), () => "idle", onTrigger);

    bridge.fire(makeEvent("Cursor"));
    await vi.advanceTimersByTimeAsync(4000);
    bridge.fire(makeEvent("Chrome"));
    await vi.advanceTimersByTimeAsync(4000);

    expect(onTrigger).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4000);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("does not trigger when flowStatus is running", async () => {
    mockGptTrigger("coding");
    const bridge = makeBridge();
    const onTrigger = vi.fn();
    startContextTriggerService(bridge, makeSession(), () => "running", onTrigger);

    bridge.fire(makeEvent("Cursor"));
    await vi.advanceTimersByTimeAsync(8000);

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("does not trigger within 5 minutes of last trigger", async () => {
    mockGptTrigger("coding");
    const bridge = makeBridge();
    const onTrigger = vi.fn();
    startContextTriggerService(bridge, makeSession(), () => "idle", onTrigger);

    bridge.fire(makeEvent("Cursor"));
    await vi.advanceTimersByTimeAsync(8000);
    expect(onTrigger).toHaveBeenCalledTimes(1);

    mockGptTrigger("research");
    bridge.fire(makeEvent("Chrome"));
    await vi.advanceTimersByTimeAsync(8000);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("does not trigger when mode matches last triggered mode", async () => {
    mockGptTrigger("coding");
    const bridge = makeBridge();
    const onTrigger = vi.fn();
    startContextTriggerService(bridge, makeSession(), () => "idle", onTrigger);

    bridge.fire(makeEvent("Cursor"));
    await vi.advanceTimersByTimeAsync(8000);
    expect(onTrigger).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);

    bridge.fire(makeEvent("Cursor"));
    await vi.advanceTimersByTimeAsync(8000);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("does not throw or call onTrigger when GPT call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const bridge = makeBridge();
    const onTrigger = vi.fn();
    startContextTriggerService(bridge, makeSession(), () => "idle", onTrigger);

    bridge.fire(makeEvent("Cursor"));
    await vi.advanceTimersByTimeAsync(8000);

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("stop() clears pending debounce and no trigger fires", async () => {
    mockGptTrigger("coding");
    const bridge = makeBridge();
    const onTrigger = vi.fn();
    const handle = startContextTriggerService(bridge, makeSession(), () => "idle", onTrigger);

    bridge.fire(makeEvent("Cursor"));
    await vi.advanceTimersByTimeAsync(4000);
    handle.stop();
    await vi.advanceTimersByTimeAsync(8000);

    expect(onTrigger).not.toHaveBeenCalled();
  });
});
