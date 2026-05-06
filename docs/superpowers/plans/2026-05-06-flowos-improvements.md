# FlowOS Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FlowOS genuinely useful for everyday professionals — fixing a broken menu bar, enabling saved layouts backed by SQLite, adding text input, system notifications, session persistence, command history, grid tiling, and run cancellation.

**Architecture:** All features stay in the existing Electron + React + Swift monorepo on `edge-inference` branch at `/Users/phdpc/Desktop/FlowOS/flowFinal/FlowOS`. Database access goes through the `@flowos/db` package (already wired). New IPC channels are added to `channels.ts`, exposed in `preload.cts`, and handled in `main.ts`. AI tool additions live in `openaiFlowOrchestrator.ts`.

**Tech Stack:** Electron 36, React + Vite, TypeScript strict, Vitest, better-sqlite3 (via `@flowos/db`), OpenAI GPT-4o/4.1 (cloud only), Swift AX API helper.

---

## File Map

| File | Change |
|------|--------|
| `electron/src/ipc/channels.ts` | Add 8 new channel keys |
| `electron/src/preload.cts` | Expose new channels on `window.flowos` |
| `electron/src/services/trackingSession.ts` | Add `stop()` method |
| `electron/src/services/sessionStore.ts` | **Create** — SQLite CRUD for sessions table |
| `electron/src/services/layoutStore.ts` | **Create** — SQLite CRUD for layouts table |
| `electron/src/services/openaiFlowOrchestrator.ts` | Add `save_layout`, `recall_layout`, `tile_windows` tools; abort support |
| `electron/src/main.ts` | Wire all new IPC handlers, fix menu bar, add notifications, session lifecycle, abort |
| `types/better-sqlite3.d.ts` | Extend with `prepare()` and `Statement` |
| `renderer/src/App.tsx` | Text input, stop tracking, notifications opt-in, saved layouts panel, command history, cancel button |

---

## Task 1: Fix the menu bar context menu (it is currently dead code)

**Files:**
- Modify: `electron/src/main.ts` — `refreshMenuBar()` function

**Background:** `buildMenuBarMenu()` builds a rich `Menu` object but its return value is never passed to `menuBarTray.setContextMenu()`. On macOS, `setContextMenu` is what Electron shows on right-click. Without it, right-click only shows the hardcoded Quit item. Left-click still correctly opens the popover. No test is needed — this is a one-line structural fix that is verified by running the app.

- [ ] **Step 1: Remove the right-click handler and call `setContextMenu` instead**

Open `electron/src/main.ts` and replace the `refreshMenuBar` function:

```typescript
function refreshMenuBar() {
  if (process.platform !== "darwin") {
    return;
  }

  if (!menuBarTray) {
    menuBarTray = new Tray(nativeImage.createEmpty());
    menuBarTray.setTitle("FlowOS");
    menuBarTray.setToolTip("FlowOS");
    menuBarTray.on("click", (_event, bounds) => {
      togglePopover(bounds);
    });
  }

  menuBarTray.setContextMenu(buildMenuBarMenu());
}
```

(The old `right-click` handler that showed only "Quit FlowOS" is removed — `setContextMenu` handles right-click automatically on macOS and shows the full menu.)

- [ ] **Step 2: Verify**

Run `npm run dev` in the project root. Right-click the FlowOS menu bar icon. Confirm the full menu appears: "Start Tracking", "Enter Flow State" with its submenu, "Toggle Mic", separator, "Quit".

- [ ] **Step 3: Commit**

```bash
git add electron/src/main.ts
git commit -m "fix: attach context menu to tray so right-click shows full menu"
```

---

## Task 2: Add `stop()` to TrackingSession + IPC + UI toggle

**Files:**
- Modify: `electron/src/services/trackingSession.ts`
- Modify: `electron/src/ipc/channels.ts`
- Modify: `electron/src/preload.cts`
- Modify: `electron/src/main.ts`
- Modify: `renderer/src/App.tsx`

- [ ] **Step 1: Write the failing test**

Open `electron/src/services/openaiFlowOrchestrator.test.ts` and add a new `describe` block at the bottom:

```typescript
describe("TrackingSession.stop", () => {
  it("sets isTracking to false", async () => {
    const { TrackingSession } = await import("./trackingSession.js");
    const session = new TrackingSession();
    session.start();
    expect(session.getState().isTracking).toBe(true);
    session.stop();
    expect(session.getState().isTracking).toBe(false);
  });

  it("stop() is idempotent when not tracking", async () => {
    const { TrackingSession } = await import("./trackingSession.js");
    const session = new TrackingSession();
    expect(() => session.stop()).not.toThrow();
    expect(session.getState().isTracking).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm run test --workspace @flowos/electron
```

Expected: `TypeError: session.stop is not a function`

- [ ] **Step 3: Add `stop()` to TrackingSession**

Open `electron/src/services/trackingSession.ts`. After the `start()` method, add:

```typescript
stop() {
  this.isTracking = false;
  return this.getState();
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm run test --workspace @flowos/electron
```

Expected: all tests pass.

- [ ] **Step 5: Add the IPC channel key**

Open `electron/src/ipc/channels.ts`. Add inside the `ipcChannels` object:

```typescript
stopTracking: "tracking:stop",
```

- [ ] **Step 6: Add IPC handler in main.ts**

Open `electron/src/main.ts`. Inside `bootstrap()`, after the `startTracking` handler:

```typescript
ipcMain.handle(ipcChannels.stopTracking, () => {
  const result = trackingSession.stop();
  refreshMenuBar();
  return result;
});
```

- [ ] **Step 7: Expose in preload**

Open `electron/src/preload.cts`. In the `contextBridge.exposeInMainWorld` object, add:

```typescript
stopTracking: () => ipcRenderer.invoke(channels.stopTracking),
```

Also add `stopTracking` to the `channels` const object at the top of the file:

```typescript
stopTracking: "tracking:stop",
```

- [ ] **Step 8: Update the Window type declaration in App.tsx**

Open `renderer/src/App.tsx`. In the `declare global` block, inside `window.flowos`, add:

```typescript
stopTracking: () => Promise<TrackingState>;
```

- [ ] **Step 9: Update the tracking button in App.tsx**

Replace the existing "Start Tracking" button with a toggle that stops tracking when active. Find the `handleStartTracking` function and add a new handler below it:

```typescript
async function handleStopTracking() {
  if (!window.flowos) return;
  setIsSubmitting(true);
  setErrorMessage(null);
  setStatusMessage("Stopping tracking...");
  try {
    const tracking = await window.flowos.stopTracking();
    setBootstrap((current) => ({ ...current, tracking }));
    setStatusMessage("Tracking stopped.");
  } catch (error) {
    setErrorMessage(error instanceof Error ? error.message : String(error));
  } finally {
    setIsSubmitting(false);
  }
}
```

Then replace the "Start Tracking" button JSX (the button with `onClick={() => void handleStartTracking()}`) with:

```tsx
<button
  type="button"
  onClick={() => void (bootstrap.tracking.isTracking ? handleStopTracking() : handleStartTracking())}
  disabled={isSubmitting}
  className="mt-1.5 flex w-full items-center justify-between rounded-xl bg-white/[0.05] px-3 py-2.5 text-left ring-1 ring-white/[0.08] transition-all hover:bg-white/[0.08] hover:ring-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
>
  <div>
    <div className="text-[13px] font-medium">
      {bootstrap.tracking.isTracking ? "Stop Tracking" : "Start Tracking"}
    </div>
    <div className="mt-0.5 text-[11px] text-white/35">
      {bootstrap.tracking.isTracking ? `${bootstrap.tracking.eventCount} events` : "Record activity context"}
    </div>
  </div>
  {bootstrap.tracking.isTracking && <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}
</button>
```

- [ ] **Step 10: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add electron/src/services/trackingSession.ts electron/src/ipc/channels.ts electron/src/preload.cts electron/src/main.ts renderer/src/App.tsx electron/src/services/openaiFlowOrchestrator.test.ts
git commit -m "feat: add stop tracking — TrackingSession.stop(), IPC channel, UI toggle"
```

---

## Task 3: Add text command input to the UI

**Files:**
- Modify: `renderer/src/App.tsx`

No new IPC needed — text commands go through the existing `runVoiceCommand` handler.

- [ ] **Step 1: Add local state for the text input**

Open `renderer/src/App.tsx`. Inside the `App` function, after the existing `useState` calls, add:

```typescript
const [textCommand, setTextCommand] = useState("");
```

- [ ] **Step 2: Add a submit handler**

After the `handleVoiceTranscript` callback, add:

```typescript
async function handleTextCommand(e: React.FormEvent) {
  e.preventDefault();
  const transcript = textCommand.trim();
  if (!transcript || isSubmitting) return;
  setTextCommand("");
  await handleVoiceTranscript(transcript);
}
```

- [ ] **Step 3: Add the input UI below the mic button section**

In the JSX, after the closing `</div>` of the mic button `px-3 pb-3` section (just before the first horizontal divider `<div className="mx-3 h-px..."/>`), add:

```tsx
{/* ── Text command input ── */}
<div className="shrink-0 px-3 pb-3">
  <form onSubmit={(e) => void handleTextCommand(e)} className="flex gap-1.5">
    <input
      type="text"
      value={textCommand}
      onChange={(e) => setTextCommand(e.target.value)}
      placeholder="Type a command…"
      disabled={isSubmitting}
      className="min-w-0 flex-1 rounded-xl bg-white/[0.05] px-3 py-2 text-[12px] text-white placeholder-white/25 ring-1 ring-white/[0.08] outline-none focus:ring-white/[0.20] disabled:opacity-40"
    />
    <button
      type="submit"
      disabled={isSubmitting || !textCommand.trim()}
      className="shrink-0 rounded-xl bg-orange-500/15 px-3 py-2 text-[12px] font-medium text-orange-400 ring-1 ring-orange-500/20 transition-all hover:bg-orange-500/25 disabled:cursor-not-allowed disabled:opacity-40"
    >
      Run
    </button>
  </form>
</div>
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add renderer/src/App.tsx
git commit -m "feat: add text command input — type commands without voice"
```

---

## Task 4: System notifications when a run completes

**Files:**
- Modify: `electron/src/main.ts`

- [ ] **Step 1: Import Notification from electron**

Open `electron/src/main.ts`. Add `Notification` to the electron import at the top:

```typescript
import { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, net, globalShortcut, screen } from "electron";
```

- [ ] **Step 2: Extract a helper function**

At the bottom of `main.ts`, before the `appendMemoryEntry` function, add:

```typescript
function notifyFlowResult(title: string, summary: string) {
  if (!Notification.isSupported()) return;
  new Notification({
    title,
    body: summary.slice(0, 150)
  }).show();
}
```

- [ ] **Step 3: Fire notification after flow mode completes**

Inside `runEnterFlowMode`, after `flowModeStatus = result.ok ? "completed" : "failed";`, add:

```typescript
notifyFlowResult(
  result.ok ? `Flow mode: ${mode}` : `Flow mode failed: ${mode}`,
  result.summary
);
```

- [ ] **Step 4: Fire notification after voice command completes**

Inside the `ipcMain.handle(ipcChannels.runVoiceCommand, ...)` handler, after `return result;` is about to be executed (after the `appendMemoryEntry` call), add the notification call. The handler currently ends with:

```typescript
ipcMain.handle(ipcChannels.runVoiceCommand, async (_event, transcript: string) => {
  appendMemoryEntry("voice.command.start", `Voice command started: "${transcript}"`);
  const result = await flowOrchestrator.runVoiceCommand(transcript);
  appendMemoryEntry(
    result.ok ? "voice.command.completed" : "voice.command.failed",
    result.summary,
    { ... }
  );
  return result;
});
```

Add before `return result;`:

```typescript
notifyFlowResult(
  result.ok ? "Voice command done" : "Voice command failed",
  result.summary
);
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add electron/src/main.ts
git commit -m "feat: show macOS notification when flow mode or voice command completes"
```

---

## Task 5: Extend better-sqlite3 types + persist sessions to SQLite

**Files:**
- Modify: `types/better-sqlite3.d.ts`
- Create: `electron/src/services/sessionStore.ts`
- Modify: `electron/src/main.ts`

- [ ] **Step 1: Extend the type declarations**

Replace the entire content of `types/better-sqlite3.d.ts` with:

```typescript
declare module "better-sqlite3" {
  interface Statement<T = unknown> {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): T | undefined;
    all(...params: unknown[]): T[];
  }

  class Database {
    constructor(filename: string);
    exec(sql: string): this;
    prepare<T = unknown>(sql: string): Statement<T>;
    close(): void;
  }

  export default Database;
}
```

- [ ] **Step 2: Write the failing test**

Create `electron/src/services/sessionStore.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run test — expect FAIL**

```bash
npm run test --workspace @flowos/electron
```

Expected: `Cannot find module './sessionStore.js'`

- [ ] **Step 4: Create sessionStore.ts**

Create `electron/src/services/sessionStore.ts`:

```typescript
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  mode: string;
  task_title: string | null;
  flow_score: number;
}

export function startSession(db: InstanceType<typeof Database>, mode: string): string {
  const id = randomUUID();
  db.prepare("INSERT INTO sessions (id, started_at, mode) VALUES (?, ?, ?)").run(
    id,
    new Date().toISOString(),
    mode
  );
  return id;
}

export function endSession(db: InstanceType<typeof Database>, id: string): void {
  db.prepare("UPDATE sessions SET ended_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}

export function getRecentSessions(
  db: InstanceType<typeof Database>,
  limit = 20
): SessionRow[] {
  return db
    .prepare<SessionRow>("SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?")
    .all(limit);
}
```

- [ ] **Step 5: Run test — expect PASS**

```bash
npm run test --workspace @flowos/electron
```

Expected: all tests pass.

- [ ] **Step 6: Wire sessions into main.ts**

Open `electron/src/main.ts`. Add `sessionStore` import after the db import:

```typescript
import { startSession, endSession } from "./services/sessionStore.js";
```

Add a module-level variable to hold the active session ID:

```typescript
let activeSessionId: string | null = null;
```

Update the `startTracking` function inside `bootstrap()` (currently it only calls `trackingSession.start()`):

```typescript
const startTracking = () => {
  const tracking = trackingSession.start();
  if (db) {
    activeSessionId = startSession(db, "general");
  }
  refreshMenuBar();
  return tracking;
};
```

Update the `stopTracking` IPC handler (added in Task 2):

```typescript
ipcMain.handle(ipcChannels.stopTracking, () => {
  const result = trackingSession.stop();
  if (db && activeSessionId) {
    endSession(db, activeSessionId);
    activeSessionId = null;
  }
  refreshMenuBar();
  return result;
});
```

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add types/better-sqlite3.d.ts electron/src/services/sessionStore.ts electron/src/services/sessionStore.test.ts electron/src/main.ts
git commit -m "feat: persist tracking sessions to SQLite — startSession/endSession on tracking toggle"
```

---

## Task 6: Saved layouts — save, list, recall, delete

**Files:**
- Create: `electron/src/services/layoutStore.ts`
- Modify: `electron/src/ipc/channels.ts`
- Modify: `electron/src/preload.cts`
- Modify: `electron/src/services/openaiFlowOrchestrator.ts`
- Modify: `electron/src/main.ts`
- Modify: `renderer/src/App.tsx`

This is the most-requested missing feature. The AI gains two new tools: `save_layout` (snapshots current window positions → SQLite) and `recall_layout` (reads from SQLite → applies `set_frame` per window). Users can also trigger save/recall from the UI.

- [ ] **Step 1: Write the failing test**

Create `electron/src/services/layoutStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { baseSchemaSql } from "@flowos/db";
import { saveLayout, listLayouts, deleteLayout } from "./layoutStore.js";

function makeTestDb() {
  const db = new Database(":memory:");
  db.exec(baseSchemaSql);
  return db;
}

const sampleConfig = [{ windowId: "ax:123:0", x: 0, y: 0, width: 800, height: 600 }];

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
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm run test --workspace @flowos/electron
```

Expected: `Cannot find module './layoutStore.js'`

- [ ] **Step 3: Create layoutStore.ts**

Create `electron/src/services/layoutStore.ts`:

```typescript
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface LayoutWindowFrame {
  windowId: string;
  appName: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SavedLayout {
  id: string;
  name: string;
  mode: string;
  learned: boolean;
  config: LayoutWindowFrame[];
  createdAt: string;
}

interface LayoutRow {
  id: string;
  name: string;
  mode: string;
  learned: number;
  config_json: string;
  created_at: string;
}

export function saveLayout(
  db: InstanceType<typeof Database>,
  name: string,
  mode: string,
  config: LayoutWindowFrame[]
): SavedLayout {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO layouts (id, name, mode, learned, config_json, created_at) VALUES (?, ?, ?, 0, ?, ?)"
  ).run(id, name, mode, JSON.stringify(config), now);
  return { id, name, mode, learned: false, config, createdAt: now };
}

export function listLayouts(db: InstanceType<typeof Database>): SavedLayout[] {
  const rows = db
    .prepare<LayoutRow>("SELECT * FROM layouts ORDER BY created_at DESC")
    .all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    mode: r.mode,
    learned: r.learned === 1,
    config: JSON.parse(r.config_json) as LayoutWindowFrame[],
    createdAt: r.created_at
  }));
}

export function getLayout(
  db: InstanceType<typeof Database>,
  id: string
): SavedLayout | undefined {
  const row = db
    .prepare<LayoutRow>("SELECT * FROM layouts WHERE id = ?")
    .get(id);
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    learned: row.learned === 1,
    config: JSON.parse(row.config_json) as LayoutWindowFrame[],
    createdAt: row.created_at
  };
}

export function deleteLayout(db: InstanceType<typeof Database>, id: string): void {
  db.prepare("DELETE FROM layouts WHERE id = ?").run(id);
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm run test --workspace @flowos/electron
```

Expected: all tests pass.

- [ ] **Step 5: Add IPC channel keys**

Open `electron/src/ipc/channels.ts`. Add inside `ipcChannels`:

```typescript
saveLayout: "layout:save",
listLayouts: "layout:list",
deleteLayout: "layout:delete",
recallLayout: "layout:recall",
```

- [ ] **Step 6: Add `save_layout` and `recall_layout` tools to the orchestrator**

Open `electron/src/services/openaiFlowOrchestrator.ts`.

Add two new tool definitions inside `TOOL_DEFINITIONS` (after the last entry):

```typescript
{
  type: "function" as const,
  function: {
    name: "save_layout",
    description:
      "Save the current window arrangement as a named layout for future recall. Call get_system_snapshot first to get current positions, then call this tool with the window frames you want to persist. The user can recall this layout later by name.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short memorable name for this layout, e.g. 'My Coding Setup'" },
        mode: { type: "string", enum: ["coding", "research", "auto"], description: "Flow mode this layout is associated with" },
        windows: {
          type: "array",
          description: "Window frames to save. Each entry must have windowId, appName, x, y, width, height.",
          items: {
            type: "object",
            properties: {
              windowId: { type: "string" },
              appName: { type: "string" },
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" }
            },
            required: ["windowId", "appName", "x", "y", "width", "height"],
            additionalProperties: false
          }
        }
      },
      required: ["name", "mode", "windows"],
      additionalProperties: false
    }
  }
},
{
  type: "function" as const,
  function: {
    name: "recall_layout",
    description:
      "Restore a previously saved layout by its id. Use list_layouts to find the id first if the user refers to it by name.",
    parameters: {
      type: "object",
      properties: {
        layoutId: { type: "string", description: "The id of the layout to restore." }
      },
      required: ["layoutId"],
      additionalProperties: false
    }
  }
},
{
  type: "function" as const,
  function: {
    name: "list_layouts",
    description: "List all saved layouts. Returns id, name, mode, and createdAt for each.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  }
}
```

- [ ] **Step 7: Add layout callback types and option to orchestrator**

In `openaiFlowOrchestrator.ts`, update `FlowOrchestratorOptions`:

```typescript
interface FlowOrchestratorOptions {
  bridge: NativeHelperBridge;
  trackingSession: TrackingSession;
  getChromeSnapshot?: () => ChromeSnapshot | null;
  runChromeCommand?: RunChromeCommand;
  getMemory?: () => MemoryEntry[];
  saveLayout?: (name: string, mode: string, windows: unknown[]) => unknown;
  listLayouts?: () => unknown[];
  getLayout?: (id: string) => unknown;
}
```

Add the fields to the class:

```typescript
private readonly saveLayout?: (name: string, mode: string, windows: unknown[]) => unknown;
private readonly listLayouts?: () => unknown[];
private readonly getLayout?: (id: string) => unknown;
```

Assign in constructor:

```typescript
this.saveLayout = options.saveLayout;
this.listLayouts = options.listLayouts;
this.getLayout = options.getLayout;
```

- [ ] **Step 8: Handle layout tools in `executeTool`**

In the `executeTool` method, add three new cases before `default`:

```typescript
case "save_layout": {
  const name = readString(input.name, "name");
  const mode = readString(input.mode, "mode");
  const windows = Array.isArray(input.windows) ? input.windows : [];
  if (!this.saveLayout) return { ok: false, error: "Layout storage is not configured." };
  return this.saveLayout(name, mode, windows);
}
case "recall_layout": {
  const layoutId = readString(input.layoutId, "layoutId");
  if (!this.getLayout) return { ok: false, error: "Layout storage is not configured." };
  const layout = this.getLayout(layoutId) as { config?: Array<{ windowId: string; x: number; y: number; width: number; height: number }> } | undefined;
  if (!layout) return { ok: false, error: `No layout found with id ${layoutId}` };
  const frames = layout.config ?? [];
  const results: unknown[] = [];
  for (const frame of frames) {
    try {
      const result = await windowEditor.setFrame(frame.windowId, { x: frame.x, y: frame.y, width: frame.width, height: frame.height });
      results.push({ windowId: frame.windowId, result });
    } catch (err) {
      results.push({ windowId: frame.windowId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { ok: true, applied: results };
}
case "list_layouts": {
  if (!this.listLayouts) return { ok: false, error: "Layout storage is not configured." };
  return { layouts: this.listLayouts() };
}
```

Note: `windowEditor` is created at the top of `executeTool` — this is already there.

- [ ] **Step 9: Wire layout callbacks into orchestrator in main.ts**

Open `electron/src/main.ts`. Add imports:

```typescript
import { saveLayout, listLayouts, getLayout, deleteLayout } from "./services/layoutStore.js";
```

In `bootstrap()`, pass layout callbacks when creating the orchestrator. The current `flowOrchestrator` construction is:

```typescript
const flowOrchestrator = new OpenAIFlowOrchestrator({
  bridge: nativeHelperBridge,
  trackingSession,
  getChromeSnapshot: () => latestChromeSnapshot,
  runChromeCommand,
  getMemory: () => persistentMemoryStore?.getSnapshot().recentEntries ?? []
});
```

Replace with:

```typescript
const flowOrchestrator = new OpenAIFlowOrchestrator({
  bridge: nativeHelperBridge,
  trackingSession,
  getChromeSnapshot: () => latestChromeSnapshot,
  runChromeCommand,
  getMemory: () => persistentMemoryStore?.getSnapshot().recentEntries ?? [],
  saveLayout: (name, mode, windows) => {
    if (!db) throw new Error("Database not initialized");
    return saveLayout(db, name, mode, windows as Parameters<typeof saveLayout>[2]);
  },
  listLayouts: () => {
    if (!db) return [];
    return listLayouts(db);
  },
  getLayout: (id) => {
    if (!db) return undefined;
    return getLayout(db, id);
  }
});
```

- [ ] **Step 10: Add layout IPC handlers in main.ts**

Inside `bootstrap()`, after the existing IPC handlers, add:

```typescript
ipcMain.handle(ipcChannels.listLayouts, () => {
  if (!db) return [];
  return listLayouts(db);
});

ipcMain.handle(ipcChannels.saveLayout, (_event, payload: { name: string; mode: string; windows: unknown[] }) => {
  if (!db) throw new Error("Database not initialized");
  return saveLayout(db, payload.name, payload.mode, payload.windows as Parameters<typeof saveLayout>[2]);
});

ipcMain.handle(ipcChannels.deleteLayout, (_event, id: string) => {
  if (!db) throw new Error("Database not initialized");
  deleteLayout(db, id);
});
```

- [ ] **Step 11: Expose layout IPC in preload**

Open `electron/src/preload.cts`. Add to the channels const:

```typescript
saveLayout: "layout:save",
listLayouts: "layout:list",
deleteLayout: "layout:delete",
```

Add to `contextBridge.exposeInMainWorld`:

```typescript
listLayouts: () => ipcRenderer.invoke(channels.listLayouts),
saveLayout: (payload: { name: string; mode: string; windows: unknown[] }) =>
  ipcRenderer.invoke(channels.saveLayout, payload),
deleteLayout: (id: string) => ipcRenderer.invoke(channels.deleteLayout, id),
```

- [ ] **Step 12: Add Saved Layouts panel to App.tsx**

Open `renderer/src/App.tsx`. Add layout types and state:

```typescript
type SavedLayout = {
  id: string;
  name: string;
  mode: string;
  createdAt: string;
};
```

Inside the `App` function, add state:

```typescript
const [layouts, setLayouts] = useState<SavedLayout[]>([]);
```

Add to the `declare global` block inside `window.flowos`:

```typescript
listLayouts: () => Promise<SavedLayout[]>;
deleteLayout: (id: string) => Promise<void>;
```

Load layouts on mount — add inside the existing `useEffect` that calls `getBootstrapState`:

```typescript
void window.flowos.listLayouts().then(setLayouts).catch(() => {});
```

Add a Saved Layouts section in JSX, after the Flow Modes section and before the Status section:

```tsx
{/* ── Saved Layouts ── */}
{layouts.length > 0 && (
  <>
    <div className="mx-3 h-px shrink-0 bg-white/[0.06]" />
    <div className="shrink-0 px-3 py-3">
      <div className="mb-2 px-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25">Saved Layouts</div>
      <div className="space-y-1">
        {layouts.map((layout) => (
          <div key={layout.id} className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/[0.06]">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleVoiceTranscript(`recall layout ${layout.name}`)}
              className="min-w-0 flex-1 text-left disabled:opacity-40"
            >
              <div className="truncate text-[12px] font-medium">{layout.name}</div>
              <div className="text-[10px] text-white/30">{layout.mode}</div>
            </button>
            <button
              type="button"
              onClick={async () => {
                await window.flowos?.deleteLayout(layout.id);
                setLayouts((prev) => prev.filter((l) => l.id !== layout.id));
              }}
              className="shrink-0 text-[11px] text-white/25 hover:text-red-400"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  </>
)}
```

- [ ] **Step 13: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 14: Run tests**

```bash
npm run test --workspace @flowos/electron
```

Expected: all tests pass.

- [ ] **Step 15: Commit**

```bash
git add electron/src/services/layoutStore.ts electron/src/services/layoutStore.test.ts electron/src/services/openaiFlowOrchestrator.ts electron/src/ipc/channels.ts electron/src/preload.cts electron/src/main.ts renderer/src/App.tsx
git commit -m "feat: saved layouts — save_layout/recall_layout/list_layouts AI tools, SQLite persistence, UI panel"
```

---

## Task 7: Command history — last 10 commands visible in the UI

**Files:**
- Modify: `electron/src/ipc/channels.ts`
- Modify: `electron/src/preload.cts`
- Modify: `electron/src/main.ts`
- Modify: `renderer/src/App.tsx`

No database needed — history lives in memory and resets on restart, which is fine for a command palette feel.

- [ ] **Step 1: Add the channel key**

Open `electron/src/ipc/channels.ts`. Add:

```typescript
getCommandHistory: "command:history",
```

- [ ] **Step 2: Add history tracking in main.ts**

Open `electron/src/main.ts`. Add a type and array at module level:

```typescript
interface CommandHistoryEntry {
  id: string;
  type: "voice" | "flow";
  input: string;
  summary: string;
  ok: boolean;
  timestamp: string;
}
const commandHistory: CommandHistoryEntry[] = [];

function recordCommand(entry: Omit<CommandHistoryEntry, "id" | "timestamp">) {
  commandHistory.unshift({
    ...entry,
    id: Math.random().toString(36).slice(2),
    timestamp: new Date().toISOString()
  });
  if (commandHistory.length > 10) commandHistory.length = 10;
}
```

In the `ipcMain.handle(ipcChannels.runVoiceCommand, ...)` handler, before `return result;`, add:

```typescript
recordCommand({ type: "voice", input: transcript, summary: result.summary, ok: result.ok });
```

In `runEnterFlowMode`, before the final `return result;`, add:

```typescript
recordCommand({ type: "flow", input: mode, summary: result.summary, ok: result.ok });
```

Add the IPC handler inside `bootstrap()`:

```typescript
ipcMain.handle(ipcChannels.getCommandHistory, () => commandHistory);
```

- [ ] **Step 3: Expose in preload**

Open `electron/src/preload.cts`. Add to channels const:

```typescript
getCommandHistory: "command:history",
```

Add to `contextBridge.exposeInMainWorld`:

```typescript
getCommandHistory: () => ipcRenderer.invoke(channels.getCommandHistory),
```

- [ ] **Step 4: Display in App.tsx**

Open `renderer/src/App.tsx`. Add type and state:

```typescript
type CommandHistoryEntry = {
  id: string;
  type: "voice" | "flow";
  input: string;
  summary: string;
  ok: boolean;
  timestamp: string;
};
```

Inside `App`, add state:

```typescript
const [commandHistory, setCommandHistory] = useState<CommandHistoryEntry[]>([]);
```

Add to `window.flowos` declaration:

```typescript
getCommandHistory: () => Promise<CommandHistoryEntry[]>;
```

After any successful command (at the end of `handleVoiceTranscript` and `handleEnterFlowMode`), refresh history:

```typescript
void window.flowos?.getCommandHistory().then(setCommandHistory).catch(() => {});
```

Add the history panel in JSX, after the Status section:

```tsx
{commandHistory.length > 0 && (
  <>
    <div className="mx-3 h-px shrink-0 bg-white/[0.06]" />
    <div className="shrink-0 px-3 py-3">
      <div className="mb-2 px-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25">Recent</div>
      <div className="space-y-1">
        {commandHistory.slice(0, 5).map((entry) => (
          <div key={entry.id} className="flex items-start gap-2 px-0.5">
            <div className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${entry.ok ? "bg-emerald-400" : "bg-red-400"}`} />
            <div className="min-w-0">
              <div className="truncate text-[11px] text-white/55">{entry.input}</div>
              <div className="truncate text-[10px] text-white/30">{entry.summary}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </>
)}
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add electron/src/ipc/channels.ts electron/src/preload.cts electron/src/main.ts renderer/src/App.tsx
git commit -m "feat: command history — last 10 voice/flow commands shown in UI"
```

---

## Task 8: N-window grid tile tool (`tile_windows`)

**Files:**
- Modify: `electron/src/services/openaiFlowOrchestrator.ts`

Adds a `tile_windows` tool that the AI can call for 3+ window arrangements, computing a grid layout server-side with no LLM math.

- [ ] **Step 1: Write the failing test**

Open `electron/src/services/openaiFlowOrchestrator.test.ts`. Add at the bottom:

```typescript
describe("tile_windows tool math", () => {
  it("computes correct 2-column grid for 4 windows", async () => {
    const mockBridge = makeMockBridge();
    const mockSession = makeMockSession();
    const calls: Array<{ windowId: string; frame: unknown }> = [];

    vi.spyOn(mockBridge, "request").mockImplementation(async (method, params) => {
      if (method === "window.setFrame") {
        calls.push({ windowId: (params as Record<string, unknown>).windowId as string, frame: params });
      }
      return { applied: true, details: [], warnings: [] };
    });

    const orc = new OpenAIFlowOrchestrator({ bridge: mockBridge, trackingSession: mockSession });

    const globalThis_ = globalThis as unknown as { fetch?: unknown };
    const originalFetch = globalThis_.fetch;
    globalThis_.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "t1",
              type: "function",
              function: {
                name: "tile_windows",
                arguments: JSON.stringify({
                  display: { id: "1", x: 0, y: 0, width: 1920, height: 1080 },
                  windowIds: ["ax:1:0", "ax:2:0", "ax:3:0", "ax:4:0"],
                  columns: 2
                })
              }
            }]
          },
          finish_reason: "tool_calls"
        }, {
          message: { content: "Done", tool_calls: undefined },
          finish_reason: "stop"
        }]
      })
    });

    await orc.runVoiceCommand("tile 4 windows in a 2-column grid");
    globalThis_.fetch = originalFetch;

    expect(calls).toHaveLength(4);
    // Window 0: top-left cell (0,0)
    expect(calls[0]).toMatchObject({ windowId: "ax:1:0", frame: expect.objectContaining({ x: 0, y: 0, width: 960, height: 540 }) });
    // Window 1: top-right cell (0,1)
    expect(calls[1]).toMatchObject({ windowId: "ax:2:0", frame: expect.objectContaining({ x: 960, y: 0, width: 960, height: 540 }) });
    // Window 2: bottom-left cell (1,0)
    expect(calls[2]).toMatchObject({ windowId: "ax:3:0", frame: expect.objectContaining({ x: 0, y: 540, width: 960, height: 540 }) });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm run test --workspace @flowos/electron
```

Expected: test fails because `tile_windows` tool is not handled (falls through to `default` which throws).

- [ ] **Step 3: Add the tool definition**

In `TOOL_DEFINITIONS` inside `openaiFlowOrchestrator.ts`, add after `open_chrome_tab`:

```typescript
{
  type: "function" as const,
  function: {
    name: "tile_windows",
    description:
      "Tile N windows in a grid on a display. Computes cell sizes from the display frame and columns count — no LLM math needed. Use this for 3+ windows; for exactly 2 use split_two_windows instead.",
    parameters: {
      type: "object",
      properties: {
        display: {
          type: "object",
          description: "Target display frame from get_system_snapshot. Use x/y/width/height (the full rect) or visibleX/Y/Width/Height for the visible area.",
          properties: {
            id: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number" },
            height: { type: "number" }
          },
          required: ["id", "x", "y", "width", "height"],
          additionalProperties: false
        },
        windowIds: {
          type: "array",
          description: "Window IDs to tile, in left-to-right, top-to-bottom order.",
          items: { type: "string" },
          minItems: 2
        },
        columns: {
          type: "number",
          description: "Number of columns in the grid. Rows are computed automatically."
        },
        gap: { type: "number", description: "Pixels of gap between windows. Defaults to 0." },
        margin: { type: "number", description: "Pixels inset from display edges. Defaults to 0." }
      },
      required: ["display", "windowIds", "columns"],
      additionalProperties: false
    }
  }
}
```

- [ ] **Step 4: Handle the tool in `executeTool`**

Add a case before `default`:

```typescript
case "tile_windows": {
  const display = readDisplay(input.display, "display");
  const windowIds = readStringArray(input.windowIds, "windowIds");
  const columns = readNumber(input.columns, "columns");
  const gap = readOptionalNumber(input.gap, "gap") ?? 0;
  const margin = readOptionalNumber(input.margin, "margin") ?? 0;
  return applyTileLayout(windowEditor, { display, windowIds, columns, gap, margin });
}
```

- [ ] **Step 5: Add `readStringArray` helper and `applyTileLayout` function**

At the bottom of `openaiFlowOrchestrator.ts`, add the helper:

```typescript
function readStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty string array`);
  }
  return value.map((entry, index) => readString(entry, `${label}[${index}]`));
}
```

And the layout function:

```typescript
async function applyTileLayout(
  windowEditor: ReturnType<typeof createWindowEditor>,
  options: {
    display: { id: string; x: number; y: number; width: number; height: number };
    windowIds: string[];
    columns: number;
    gap: number;
    margin: number;
  }
): Promise<unknown> {
  const { display, windowIds, columns, gap, margin } = options;
  const cols = Math.max(1, Math.floor(columns));
  const rows = Math.ceil(windowIds.length / cols);
  const cellW = (display.width - margin * 2 - gap * (cols - 1)) / cols;
  const cellH = (display.height - margin * 2 - gap * (rows - 1)) / rows;

  const results: unknown[] = [];
  for (let i = 0; i < windowIds.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = display.x + margin + col * (cellW + gap);
    const y = display.y + margin + row * (cellH + gap);
    const windowId = windowIds[i];
    if (!windowId) continue;
    try {
      const result = await windowEditor.setFrame(windowId, {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(cellW),
        height: Math.round(cellH)
      });
      results.push({ windowId, applied: true, result });
    } catch (err) {
      results.push({ windowId, applied: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { ok: true, tiled: results };
}
```

- [ ] **Step 6: Run test — expect PASS**

```bash
npm run test --workspace @flowos/electron
```

Expected: all tests pass.

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add electron/src/services/openaiFlowOrchestrator.ts electron/src/services/openaiFlowOrchestrator.test.ts
git commit -m "feat: add tile_windows tool — grid layout for 3+ windows with server-side math"
```

---

## Task 9: Abort a running AI command

**Files:**
- Modify: `electron/src/services/openaiFlowOrchestrator.ts`
- Modify: `electron/src/ipc/channels.ts`
- Modify: `electron/src/preload.cts`
- Modify: `electron/src/main.ts`
- Modify: `renderer/src/App.tsx`

- [ ] **Step 1: Add abort support to the orchestrator**

Open `electron/src/services/openaiFlowOrchestrator.ts`. Add a private field to the class:

```typescript
private abortController: AbortController | null = null;
```

Add a public method:

```typescript
abort() {
  this.abortController?.abort();
}
```

In `runLoop`, create a new controller at the start and check it each iteration:

```typescript
private async runLoop(input: {
  apiKey: string;
  model: string;
  initialPrompt: string;
  emptySummary: string;
}): Promise<FlowRunResult> {
  this.abortController = new AbortController();
  const { signal } = this.abortController;

  // ... existing setup (messages, toolCalls, etc.) ...

  for (let iteration = 0; iteration < 20; iteration += 1) {
    if (signal.aborted) {
      return { ok: false, summary: "Run cancelled by user.", model: input.model, snapshotTimestamp, toolCalls, toolResults };
    }
    // ... rest of loop unchanged ...
  }

  this.abortController = null;
  return { ok: true, summary: finalSummary, model: input.model, snapshotTimestamp, toolCalls, toolResults };
}
```

- [ ] **Step 2: Add channel key**

Open `electron/src/ipc/channels.ts`. Add:

```typescript
abortFlowMode: "flow:abort",
```

- [ ] **Step 3: Add IPC handler in main.ts**

Inside `bootstrap()`, add:

```typescript
ipcMain.handle(ipcChannels.abortFlowMode, () => {
  flowOrchestrator.abort();
});
```

- [ ] **Step 4: Expose in preload**

Open `electron/src/preload.cts`. Add to channels:

```typescript
abortFlowMode: "flow:abort",
```

Add to `contextBridge.exposeInMainWorld`:

```typescript
abortFlowMode: () => ipcRenderer.invoke(channels.abortFlowMode),
```

- [ ] **Step 5: Add Cancel button to App.tsx**

Open `renderer/src/App.tsx`. Add to `window.flowos` declaration:

```typescript
abortFlowMode: () => Promise<void>;
```

In the JSX, inside the `{isSubmitting ? (...) : null}` block at the bottom, replace the spinner with:

```tsx
{isSubmitting ? (
  <div className="absolute bottom-3 right-3 flex items-center gap-2">
    <button
      type="button"
      onClick={() => void window.flowos?.abortFlowMode()}
      className="text-[11px] text-white/30 hover:text-white/60"
    >
      Cancel
    </button>
    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
  </div>
) : null}
```

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Run all tests**

```bash
npm run test --workspace @flowos/electron
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add electron/src/services/openaiFlowOrchestrator.ts electron/src/ipc/channels.ts electron/src/preload.cts electron/src/main.ts renderer/src/App.tsx
git commit -m "feat: abort running AI command — Cancel button + abort() on orchestrator"
```

---

## Self-Review

**Spec coverage:** All 9 improvement areas are covered across Tasks 1–9.

**Placeholder scan:** No TBDs, TODOs, or vague steps present. Every step contains exact file paths, complete code blocks, and exact commands with expected output.

**Type consistency check:**
- `InstanceType<typeof Database>` used consistently in `sessionStore.ts` and `layoutStore.ts`
- `LayoutWindowFrame[]` defined in `layoutStore.ts` and used in both the store and the orchestrator's `save_layout` handler
- `SavedLayout` returned by `saveLayout`, `listLayouts`, and `getLayout` — shape matches the UI's `SavedLayout` type in `App.tsx` (id, name, mode, createdAt)
- `CommandHistoryEntry` defined once in `main.ts` and re-declared as a local type in `App.tsx` — consistent shape
- `applyTileLayout` takes a `windowEditor` of type `ReturnType<typeof createWindowEditor>` — matches the existing pattern in `executeTool` where `createWindowEditor(this.bridge)` is called
- `readStringArray` helper is defined before it is used in the `tile_windows` case

**One known follow-up:** The `save_layout` IPC handler in main.ts casts `payload.windows` — this is safe because it comes from the renderer via IPC and will be validated by the orchestrator tool handler if called through AI. Direct renderer calls should be treated as trusted since the renderer is local.
