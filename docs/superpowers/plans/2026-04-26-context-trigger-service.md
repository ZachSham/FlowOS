# Context-Triggered Layout Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a background service that watches app focus events and silently applies a coding or research layout when the user sustains focus on an app for 8+ seconds, using a lightweight GPT inference call to decide.

**Architecture:** A new `contextTriggerService.ts` registers a listener on the existing `NativeHelperBridge.onEvent` stream, debounces `app.activated` events to 8 seconds, calls OpenAI with a minimal prompt, and invokes `runEnterFlowMode` if the result says to trigger. Two guard rails: a 5-minute rate limit and a same-mode dedup check prevent thrashing. The service is wired into `main.ts` in `bootstrap()` and torn down in `before-quit`.

**Tech Stack:** TypeScript, Electron `net.fetch`, Vitest (fake timers), existing `NativeHelperBridge` + `TrackingSession` interfaces

---

## File Map

| File | Action |
|------|--------|
| `electron/src/services/contextTriggerService.ts` | **Create** — full service |
| `electron/src/services/contextTriggerService.test.ts` | **Create** — 7 tests |
| `electron/src/main.ts` | **Modify** — import + wire in `bootstrap()` + stop in `before-quit` |

---

## Task 1: Write failing tests

**Files:**
- Create: `electron/src/services/contextTriggerService.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
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

function makeBridge(onEventImpl?: (listener: (e: unknown) => void) => () => void): NativeHelperBridge {
  let capturedListener: ((e: unknown) => void) | null = null;
  return {
    onEvent: vi.fn().mockImplementation((listener: (e: unknown) => void) => {
      capturedListener = listener;
      if (onEventImpl) return onEventImpl(listener);
      return () => { capturedListener = null; };
    }),
    fire(event: unknown) { capturedListener?.(event); },
    request: vi.fn(),
    getStatus: vi.fn().mockReturnValue({ connected: false, transport: "stdio", command: [] }),
    stop: vi.fn()
  } as unknown as NativeHelperBridge & { fire: (e: unknown) => void };
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

function mockGptNoTrigger() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ trigger: false, mode: "none", reason: "no signal" }) } }]
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
    delete process.env["OPENAI_API_KEY"];
  });

  it("calls onTrigger after 8s of sustained focus", async () => {
    mockGptTrigger("coding");
    const bridge = makeBridge() as NativeHelperBridge & { fire: (e: unknown) => void };
    const onTrigger = vi.fn();
    startContextTriggerService(bridge, makeSession(), () => "idle", onTrigger);

    (bridge as unknown as { fire: (e: unknown) => void }).fire(makeEvent("Cursor"));
    await vi.advanceTimersByTimeAsync(8000);

    expect(onTrigger).toHaveBeenCalledWith("coding");
  });

  it("resets debounce when a second app.activated fires before 8s", async () => {
    mockGptTrigger("coding");
    const bridge = makeBridge() as NativeHelperBridge & { fire: (e: unknown) => void };
    const onTrigger = vi.fn();
    startContextTriggerService(bridge, makeSession(), () => "idle", onTrigger);

    (bridge as unknown as { fire: (e: unknown) => void }).fire(makeEvent("Cursor"));
    await vi.advanceTimersByTimeAsync(4000);
    (bridge as unknown as { fire: (e: unknown) => void }).fire(makeEvent("Chrome"));
    await vi.advanceTimersByTimeAsync(4000);

    // only 4s since Chrome focus — should not have fired yet
    expect(onTrigger).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4000);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("does not trigger when flowStatus is running", async () => {
    mockGptTrigger("coding");
    const bridge = makeBridge() as NativeHelperBridge & { fire: (e: unknown) => void };
    const onTrigger = vi.fn();
    startContextTriggerService(bridge, makeSession(), () => "running", onTrigger);

    (bridge as unknown as { fire: (e: unknown) => void }).fire(makeEvent("Cursor"));
    await vi.advanceTimersByTimeAsync(8000);

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("does not trigger within 5 minutes of last trigger", async () => {
    mockGptTrigger("coding");
    const bridge = makeBridge() as NativeHelperBridge & { fire: (e: unknown) => void };
    const onTrigger = vi.fn();
    startContextTriggerService(bridge, makeSession(), () => "idle", onTrigger);

    // First trigger
    (bridge as unknown as { fire: (e: unknown) => void }).fire(makeEvent("Cursor"));
    await vi.advanceTimersByTimeAsync(8000);
    expect(onTrigger).toHaveBeenCalledTimes(1);

    // Second trigger within 5 minutes — blocked
    mockGptTrigger("research");
    (bridge as unknown as { fire: (e: unknown) => void }).fire(makeEvent("Chrome"));
    await vi.advanceTimersByTimeAsync(8000);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("does not trigger when mode matches last triggered mode", async () => {
    mockGptTrigger("coding");
    const bridge = makeBridge() as NativeHelperBridge & { fire: (e: unknown) => void };
    const onTrigger = vi.fn();
    startContextTriggerService(bridge, makeSession(), () => "idle", onTrigger);

    // First trigger fires
    (bridge as unknown as { fire: (e: unknown) => void }).fire(makeEvent("Cursor"));
    await vi.advanceTimersByTimeAsync(8000);
    expect(onTrigger).toHaveBeenCalledTimes(1);

    // Advance past rate limit
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);

    // Same mode again — should be skipped
    (bridge as unknown as { fire: (e: unknown) => void }).fire(makeEvent("Cursor"));
    await vi.advanceTimersByTimeAsync(8000);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("does not throw or call onTrigger when GPT call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const bridge = makeBridge() as NativeHelperBridge & { fire: (e: unknown) => void };
    const onTrigger = vi.fn();
    startContextTriggerService(bridge, makeSession(), () => "idle", onTrigger);

    (bridge as unknown as { fire: (e: unknown) => void }).fire(makeEvent("Cursor"));
    await vi.advanceTimersByTimeAsync(8000);

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("stop() clears pending debounce and no trigger fires", async () => {
    mockGptTrigger("coding");
    const bridge = makeBridge() as NativeHelperBridge & { fire: (e: unknown) => void };
    const onTrigger = vi.fn();
    const handle = startContextTriggerService(bridge, makeSession(), () => "idle", onTrigger);

    (bridge as unknown as { fire: (e: unknown) => void }).fire(makeEvent("Cursor"));
    await vi.advanceTimersByTimeAsync(4000);
    handle.stop();
    await vi.advanceTimersByTimeAsync(8000);

    expect(onTrigger).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they all fail**

```bash
cd /path/to/FlowOS
npm run test --workspace @flowos/electron 2>&1
```

Expected: 7 tests fail with "Cannot find module './contextTriggerService.js'"

---

## Task 2: Implement contextTriggerService

**Files:**
- Create: `electron/src/services/contextTriggerService.ts`

- [ ] **Step 3: Create the service file**

```typescript
// electron/src/services/contextTriggerService.ts
import { net } from "electron";
import type { NativeHelperBridge } from "../bridge/swiftHelper.js";
import type { NativeEventEnvelope } from "@flowos/shared";
import type { TrackingSession } from "./trackingSession.js";

const DEBOUNCE_MS = 8_000;
const RATE_LIMIT_MS = 5 * 60 * 1_000;

export type TriggerCallback = (mode: "coding" | "research") => void;

export interface ContextTriggerHandle {
  stop: () => void;
}

interface InferenceResult {
  trigger: boolean;
  mode: "coding" | "research" | "none";
  reason: string;
}

function getTimeOfDay(hour: number): "morning" | "afternoon" | "evening" | "night" {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

async function callInference(params: {
  focusedApp: string;
  previousApp: string | null;
  recentEvents: Array<{ event: string; summary: string; timestamp: string }>;
  timeOfDay: string;
  currentFlowStatus: string;
}): Promise<InferenceResult> {
  const apiKey = process.env["OPENAI_API_KEY"]?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const model = process.env["OPENAI_MODEL"] ?? "gpt-4.1";
  const electronFetch = (net as unknown as { fetch?: typeof fetch } | undefined)?.fetch;
  const activeFetch = electronFetch ?? fetch;

  const prompt = `You are FlowOS, a macOS desktop orchestrator. Decide whether to automatically apply a focus layout based on the user's current context.

Context:
- App just focused: ${params.focusedApp}
- Previously focused: ${params.previousApp ?? "unknown"}
- Time of day: ${params.timeOfDay}
- Current flow status: ${params.currentFlowStatus}
- Recent activity (last 5 events): ${JSON.stringify(params.recentEvents)}

Available layouts:
- "coding": splits IDE + dev tools on primary display, pushes Chrome to second display
- "research": splits Chrome + notes app on primary display

Respond with ONLY valid JSON, no markdown fences:
{"trigger": true or false, "mode": "coding" or "research" or "none", "reason": "brief explanation"}

Only set trigger to true if the signal is strong and unambiguous. When uncertain, return trigger: false.`;

  const response = await activeFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 100
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string | null } }>;
  };
  const content = data.choices[0]?.message?.content ?? "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Unparseable inference response: ${content}`);
  }

  const result = parsed as Record<string, unknown>;
  if (typeof result["trigger"] !== "boolean") {
    throw new Error(`Invalid inference response: ${content}`);
  }

  return {
    trigger: result["trigger"] as boolean,
    mode: (result["mode"] as "coding" | "research" | "none") ?? "none",
    reason: typeof result["reason"] === "string" ? result["reason"] : ""
  };
}

export function startContextTriggerService(
  bridge: NativeHelperBridge,
  trackingSession: TrackingSession,
  getFlowStatus: () => "idle" | "running" | "completed" | "failed",
  onTrigger: TriggerCallback
): ContextTriggerHandle {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTriggerAt: number | null = null;
  let lastTriggeredMode: string | null = null;
  let previousApp: string | null = null;

  function clearDebounce() {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  async function runInference(focusedApp: string, prevApp: string | null) {
    if (getFlowStatus() === "running") return;

    const now = Date.now();
    if (lastTriggerAt !== null && now - lastTriggerAt < RATE_LIMIT_MS) return;

    const summary = trackingSession.getSummary();
    const hour = new Date().getHours();

    let result: InferenceResult;
    try {
      result = await callInference({
        focusedApp,
        previousApp: prevApp,
        recentEvents: summary.recentEvents.slice(0, 5).map((e) => ({
          event: e.event,
          summary: e.summary,
          timestamp: e.timestamp
        })),
        timeOfDay: getTimeOfDay(hour),
        currentFlowStatus: getFlowStatus()
      });
    } catch (err) {
      console.error("[flowos][context-trigger] inference failed", err);
      return;
    }

    if (!result.trigger || result.mode === "none") return;
    if (result.mode === lastTriggeredMode) return;

    lastTriggerAt = Date.now();
    lastTriggeredMode = result.mode;
    onTrigger(result.mode);
  }

  const unsubscribe = bridge.onEvent((event: NativeEventEnvelope) => {
    if (event.event !== "app.activated") return;

    const payload = event.payload as { app?: { name?: string } };
    const appName = payload.app?.name;
    if (!appName) return;

    clearDebounce();

    const prevApp = previousApp;
    previousApp = appName;

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void runInference(appName, prevApp);
    }, DEBOUNCE_MS);
  });

  return {
    stop() {
      clearDebounce();
      unsubscribe();
    }
  };
}
```

- [ ] **Step 4: Run tests to confirm they all pass**

```bash
npm run test --workspace @flowos/electron 2>&1
```

Expected: 17 tests pass (10 existing + 7 new), 0 failures

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck --workspace @flowos/electron 2>&1
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add electron/src/services/contextTriggerService.ts electron/src/services/contextTriggerService.test.ts
git commit -m "feat: add context-triggered layout service with GPT inference"
```

---

## Task 3: Wire into main.ts

**Files:**
- Modify: `electron/src/main.ts`

- [ ] **Step 7: Add the import at the top of main.ts**

Find the block of service imports (around line 20–33) and add:

```typescript
import {
  startContextTriggerService,
  type ContextTriggerHandle
} from "./services/contextTriggerService.js";
```

- [ ] **Step 8: Add the handle variable alongside the other module-level handles**

Find where the other `let` handles are declared (around line 42–49, near `let realtimeServer`, `let observationService`, etc.) and add:

```typescript
let contextTrigger: ContextTriggerHandle | null = null;
```

- [ ] **Step 9: Start the service inside bootstrap(), after the nativeHelperBridge block**

Find the lines (around line 104):
```typescript
nativeHelperTelemetry = await startNativeHelperTelemetry(nativeHelperBridge);
const flowOrchestrator = new OpenAIFlowOrchestrator({
```

Insert between those two lines:

```typescript
  contextTrigger = startContextTriggerService(
    nativeHelperBridge,
    trackingSession,
    () => flowModeStatus,
    (mode) => { void runEnterFlowMode(mode); }
  );
```

- [ ] **Step 10: Stop the service in the before-quit handler**

Find `app.on("before-quit", ...)` and add `contextTrigger?.stop();` alongside the other stop calls:

```typescript
app.on("before-quit", () => {
  globalShortcut.unregisterAll();
  menuBarTray?.destroy();
  menuBarTray = null;
  contextTrigger?.stop();         // ← add this line
  realtimeServer?.stop();
  nativeHelperTelemetry?.stop();
  nativeHelperBridge?.stop();
  observationService?.stop();
});
```

- [ ] **Step 11: Run typecheck to confirm no errors**

```bash
npm run typecheck --workspace @flowos/electron 2>&1
```

Expected: no errors

- [ ] **Step 12: Run tests to confirm nothing regressed**

```bash
npm run test --workspace @flowos/electron 2>&1
```

Expected: 17 tests pass

- [ ] **Step 13: Commit**

```bash
git add electron/src/main.ts
git commit -m "feat: wire context-trigger service into main process lifecycle"
```

---

## Done

The service is live. From this point:
- Focus Cursor or Xcode for 8+ seconds → GPT infers "coding" → coding layout fires silently
- Focus Chrome for 8+ seconds → GPT infers "research" → research layout fires silently
- Quick cmd-tabs (< 8s) → nothing happens
- Back-to-back triggers within 5 minutes → rate-limited
- Same mode twice in a row → deduped
- `flowModeStatus === "running"` → suppressed
