# Context-Triggered Layout Service — Design Spec

**Goal:** FlowOS automatically applies a focus layout when the user sustains focus on an app for 8+ seconds, using a lightweight GPT inference call to decide whether and which layout to trigger.

**Date:** 2026-04-26

---

## Overview

When the user focuses an app and stays there for at least 8 seconds, a background service captures a lightweight context snapshot and asks GPT whether a layout change is warranted. If yes, the existing `runEnterFlowMode` path fires silently — no voice, no clicks, no confirmation. The user's desktop rearranges itself based on what they're doing.

---

## Behaviour

- **Trigger condition:** `app.activated` event from Swift helper, sustained for 8 seconds (debounce)
- **Rate limit:** Will not re-trigger within 5 minutes of the last successful layout change
- **Silent execution:** No popover, no notification. Layout fires in the background
- **Suppression conditions** (any of these block the trigger):
  - `flowModeStatus === "running"` — an existing flow run is in progress
  - Last triggered layout was the same mode — skip redundant re-runs
  - GPT call fails — log error, do nothing
  - App switch happens before the 8-second debounce expires — cancel and reset

---

## GPT Inference Call

**Model:** Same as `OPENAI_MODEL` env var (default `gpt-4.1`)

**Input prompt fields:**
- `focusedApp` — name of the app that just received focus
- `previousApp` — name of the app that had focus before
- `recentEvents` — last 5 events from the tracking buffer (or empty array if not tracking)
- `displayCount` — number of connected displays
- `timeOfDay` — `"morning"` | `"afternoon"` | `"evening"` | `"night"` (derived from local hour)
- `currentFlowStatus` — `"idle"` | `"completed"` | `"failed"`

**Expected output (JSON):**
```json
{
  "trigger": true,
  "mode": "coding",
  "reason": "User focused Cursor after 3 recent app.activated events on dev tools"
}
```
or
```json
{
  "trigger": false,
  "mode": "none",
  "reason": "Finder focus is ambiguous, no clear workflow signal"
}
```

**Response parsing:** Parse as JSON. If parsing fails or `trigger` is missing, treat as `trigger: false` and log the raw response.

---

## Architecture

### New file: `electron/src/services/contextTriggerService.ts`

Single responsibility: watch `app.activated` events, debounce, call GPT, invoke callback.

**Interface:**
```typescript
export type TriggerCallback = (mode: "coding" | "research") => void;

export interface ContextTriggerHandle {
  stop: () => void;
}

export function startContextTriggerService(
  bridge: SwiftHelperBridge,
  trackingSession: TrackingSession,
  getFlowStatus: () => "idle" | "running" | "completed" | "failed",
  onTrigger: TriggerCallback
): ContextTriggerHandle;
```

**Internal state (all in-memory):**
- `debounceTimer: NodeJS.Timeout | null` — reset on every `app.activated`
- `lastTriggerAt: number | null` — timestamp of last successful trigger (for rate limiting)
- `lastTriggeredMode: string | null` — mode of last trigger (for dedup)
- `previousApp: string | null` — tracks the app before the current focus

### Integration in `electron/src/main.ts`

Wire into the existing `nativeHelperBridge.onEvent` handler — approximately 5 lines:

```typescript
const contextTrigger = startContextTriggerService(
  nativeHelperBridge,
  trackingSession,
  () => flowModeStatus,
  (mode) => void runEnterFlowMode(mode)
);
```

Stop it in `before-quit`:
```typescript
contextTrigger.stop();
```

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| GPT call fails (network, API error) | Log to console, do nothing |
| GPT returns unparseable JSON | Treat as `trigger: false`, log raw response |
| `app.activated` fires before debounce expires | Cancel timer, restart with new app |
| `flowModeStatus === "running"` | Skip inference call entirely |
| Same mode as last trigger | Skip execution, don't call `runEnterFlowMode` |
| Tracking not active | Still runs — uses app name + time of day as signal |

---

## Logging

Each inference result (trigger or not) is appended to `persistentMemoryStore` via the existing `appendMemoryEntry` function:

```typescript
appendMemoryEntry("context.trigger.inference", reason, {
  focusedApp,
  trigger,
  mode,
  triggered: trigger && modeIsNew
});
```

---

## File Summary

| File | Change |
|------|--------|
| `electron/src/services/contextTriggerService.ts` | **Create** — full service implementation |
| `electron/src/main.ts` | **Modify** — wire up service in `bootstrap()`, stop in `before-quit` |

No new IPC channels. No renderer changes. No new dependencies.

---

## Out of Scope

- User-configurable app → layout rules (can be added later)
- Confirmation UI before applying layout
- Per-app debounce customisation
- Windows / Linux support
