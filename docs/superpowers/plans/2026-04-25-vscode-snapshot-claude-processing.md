# VS Code Snapshot → Claude Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When VS Code sends a snapshot, Electron debounces 5 seconds, calls Claude API to infer task context, and pushes live task state + suggestions + reasoning to renderer windows via IPC.

**Architecture:** A new `claude/client.ts` module handles API calls with a cached system prompt. The realtime server debounces snapshots and calls it. Results are pushed to all BrowserWindows via `webContents.send()`. The renderer subscribes via the context bridge and updates React state live.

**Tech Stack:** `@anthropic-ai/sdk`, `dotenv`, Electron IPC (`webContents.send` + `ipcRenderer.on`), React state, Tailwind CSS

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `electron/src/claude/client.ts` | Create | Claude API call, prompt building, response parsing |
| `electron/src/realtime/server.ts` | Modify | Add snapshot handler, 5s debounce, call claude client, push via IPC |
| `electron/src/ipc/channels.ts` | Modify | Add `stateUpdated` and `stateLoading` channel names |
| `electron/src/preload.ts` | Modify | Expose `onStateUpdate` and `onStateLoading` listeners via context bridge |
| `electron/src/main.ts` | Modify | Add `import "dotenv/config"` before bootstrap |
| `renderer/src/App.tsx` | Modify | Subscribe to live IPC updates, show reasoning + loading + error states |
| `.env` | Create | `ANTHROPIC_API_KEY=your-key-here` (gitignored) |
| `.gitignore` | Modify | Add `.env` |

**Do not touch:** `shared/src/index.ts`, `extension-vscode/`, `extension-chrome/`, `db/`

---

## Task 1: Setup — Dependencies, .env, .gitignore

**Files:**
- Modify: `FlowOS/electron/package.json` (via npm install)
- Create: `FlowOS/.env`
- Modify: `FlowOS/.gitignore`

- [ ] **Step 1: Install dependencies in the electron workspace**

```bash
cd /Users/phdpc/Desktop/flow/FlowOS
npm install @anthropic-ai/sdk dotenv --workspace @flowos/electron
```

Expected output: packages added to `electron/node_modules` (or hoisted), `package-lock.json` updated.

- [ ] **Step 2: Create `.env` at repo root**

Create `/Users/phdpc/Desktop/flow/FlowOS/.env`:
```
ANTHROPIC_API_KEY=your-api-key-here
```

Replace `your-api-key-here` with your actual Anthropic API key from https://console.anthropic.com.

- [ ] **Step 3: Add `.env` to `.gitignore`**

Check if `.gitignore` exists at the repo root:
```bash
ls /Users/phdpc/Desktop/flow/FlowOS/.gitignore 2>/dev/null || echo "not found"
```

If it exists, append `.env` to it. If not, create it:
```
.env
node_modules/
dist/
*.tsbuildinfo
data/
```

- [ ] **Step 4: Verify `.env` is gitignored**

```bash
cd /Users/phdpc/Desktop/flow/FlowOS && git check-ignore -v .env
```

Expected: `.gitignore:.env` (confirming it's ignored). If git isn't initialized, skip this step.

- [ ] **Step 5: Commit**

```bash
cd /Users/phdpc/Desktop/flow/FlowOS
git add electron/package.json package-lock.json .gitignore
git commit -m "feat: add @anthropic-ai/sdk, dotenv deps and gitignore .env"
```

---

## Task 2: IPC Channels + Preload

**Files:**
- Modify: `electron/src/ipc/channels.ts`
- Modify: `electron/src/preload.ts`

- [ ] **Step 1: Add new channels to `electron/src/ipc/channels.ts`**

Current file:
```typescript
export const ipcChannels = {
  getBootstrapState: "bootstrap:get-state"
} as const;
```

Replace with:
```typescript
export const ipcChannels = {
  getBootstrapState: "bootstrap:get-state",
  stateUpdated: "state:updated",
  stateLoading: "state:loading",
} as const;
```

- [ ] **Step 2: Update `electron/src/preload.ts`**

Current file:
```typescript
import { contextBridge, ipcRenderer } from "electron";
import { ipcChannels } from "./ipc/channels.js";

contextBridge.exposeInMainWorld("flowos", {
  getBootstrapState: () => ipcRenderer.invoke(ipcChannels.getBootstrapState)
});
```

Replace with:
```typescript
import { contextBridge, ipcRenderer } from "electron";
import { ipcChannels } from "./ipc/channels.js";
import type { TaskState, Suggestion } from "@flowos/shared";

export interface LiveState {
  taskState?: TaskState;
  suggestions?: Suggestion[];
  reasoning?: string;
  hasError: boolean;
}

contextBridge.exposeInMainWorld("flowos", {
  getBootstrapState: () => ipcRenderer.invoke(ipcChannels.getBootstrapState),

  onStateUpdate: (callback: (state: LiveState) => void) => {
    ipcRenderer.on(ipcChannels.stateUpdated, (_event, state: LiveState) =>
      callback(state)
    );
  },

  onStateLoading: (callback: () => void) => {
    ipcRenderer.on(ipcChannels.stateLoading, () => callback());
  },
});
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/phdpc/Desktop/flow/FlowOS && npm run typecheck --workspace @flowos/electron
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add electron/src/ipc/channels.ts electron/src/preload.ts
git commit -m "feat: add stateUpdated/stateLoading IPC channels and preload listeners"
```

---

## Task 3: Claude Client

**Files:**
- Create: `electron/src/claude/client.ts`

- [ ] **Step 1: Create `electron/src/claude/client.ts`**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { TaskState, Suggestion, FlowMode } from "@flowos/shared";

const SYSTEM_PROMPT = `You are FlowOS, an AI that observes a developer's VS Code state and infers what they are working on.

Given a snapshot of their editor state, respond with ONLY valid JSON — no markdown fences, no prose, no explanation outside the JSON object.

The JSON must match this exact shape:
{
  "title": "short task title (max 8 words)",
  "mode": "coding|debugging|design|writing|researching|meeting|study",
  "substate": "one sentence describing current focus",
  "confidence": 0.85,
  "reasoning": "2-3 sentences explaining why you inferred this from the given context",
  "suggestions": [
    {
      "kind": "file|command|tab",
      "title": "short action title",
      "description": "one sentence explaining why this is relevant",
      "payload": "file path, shell command, or URL",
      "confidence": 0.88
    }
  ]
}

Return exactly 3 suggestions. Prefer file suggestions when errors are present. Use lower confidence when context is ambiguous.`;

export interface SnapshotInput {
  activeFile?: string;
  openTabs: string[];
  diagnostics: Array<{ file: string; severity: string; message: string }>;
  recentEdits: string[];
}

export interface ClaudeInsight {
  taskState: TaskState;
  suggestions: Suggestion[];
  reasoning: string;
}

interface RawClaudeResponse {
  title: string;
  mode: FlowMode;
  substate: string;
  confidence: number;
  reasoning: string;
  suggestions: Array<{
    kind: "file" | "command" | "tab";
    title: string;
    description: string;
    payload: string;
    confidence: number;
  }>;
}

export async function analyzeSnapshot(
  snapshot: SnapshotInput
): Promise<ClaudeInsight | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[claude] ANTHROPIC_API_KEY not set — skipping analysis");
    return null;
  }

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: buildUserContent(snapshot) }],
    });

    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "";
    const parsed = JSON.parse(text) as RawClaudeResponse;

    const taskState: TaskState = {
      id: `task-${Date.now()}`,
      title: parsed.title,
      mode: parsed.mode,
      substate: parsed.substate,
      confidence: parsed.confidence,
      updatedAt: new Date().toISOString(),
      signals: [],
    };

    const suggestions: Suggestion[] = parsed.suggestions.map((s) => ({
      id: crypto.randomUUID(),
      kind: s.kind,
      title: s.title,
      description: s.description,
      payload: s.payload,
      confidence: s.confidence,
      source: "model" as const,
    }));

    return { taskState, suggestions, reasoning: parsed.reasoning };
  } catch (error) {
    console.error("[claude] error:", error);
    return null;
  }
}

function buildUserContent(s: SnapshotInput): string {
  const lines: string[] = [];
  if (s.activeFile) lines.push(`Active file: ${s.activeFile}`);
  if (s.openTabs.length > 0)
    lines.push(`Open tabs: ${s.openTabs.slice(0, 10).join(", ")}`);
  if (s.recentEdits.length > 0)
    lines.push(`Recent edits: ${s.recentEdits.slice(0, 5).join(", ")}`);
  if (s.diagnostics.length > 0) {
    lines.push(`Diagnostics:`);
    for (const d of s.diagnostics.slice(0, 10)) {
      lines.push(`  [${d.severity}] ${d.file}: ${d.message}`);
    }
  }
  if (lines.length === 0) lines.push("No context available yet.");
  return lines.join("\n");
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/phdpc/Desktop/flow/FlowOS && npm run typecheck --workspace @flowos/electron
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add electron/src/claude/client.ts
git commit -m "feat: add Claude API client with cached system prompt and snapshot analysis"
```

---

## Task 4: Realtime Server — Snapshot Processing

**Files:**
- Modify: `electron/src/realtime/server.ts`

- [ ] **Step 1: Rewrite `electron/src/realtime/server.ts`**

```typescript
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { BrowserWindow } from "electron";
import type { RealtimeMessage, VsCodeSnapshot } from "@flowos/shared";
import { analyzeSnapshot } from "../claude/client.js";
import { ipcChannels } from "../ipc/channels.js";

const DEBOUNCE_MS = 5_000;

export function createRealtimeServer(port: number) {
  const wss = new WebSocketServer({ port });
  let lastSnapshot: VsCodeSnapshot | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function pushToWindows(channel: string, payload?: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  }

  async function processSnapshot(snapshot: VsCodeSnapshot): Promise<void> {
    pushToWindows(ipcChannels.stateLoading);

    const insight = await analyzeSnapshot({
      activeFile: snapshot.activeFile,
      openTabs: snapshot.openTabs,
      diagnostics: snapshot.diagnostics,
      recentEdits: snapshot.recentCommands,
    });

    if (insight) {
      pushToWindows(ipcChannels.stateUpdated, {
        taskState: insight.taskState,
        suggestions: insight.suggestions,
        reasoning: insight.reasoning,
        hasError: false,
      });
    } else {
      pushToWindows(ipcChannels.stateUpdated, { hasError: true });
    }
  }

  wss.on("connection", (socket: WebSocket) => {
    console.log(`[realtime] client connected on :${port}`);

    socket.on("message", (raw: RawData) => {
      try {
        const parsed = JSON.parse(String(raw)) as RealtimeMessage;
        console.log("[realtime] event", parsed.type);

        if (parsed.type === "vscode.snapshot") {
          lastSnapshot = parsed.payload;
          if (debounceTimer !== undefined) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            debounceTimer = undefined;
            if (lastSnapshot !== null) void processSnapshot(lastSnapshot);
          }, DEBOUNCE_MS);
        }
      } catch (error) {
        console.error("[realtime] invalid message", error);
      }
    });

    socket.on("close", () => {
      console.log("[realtime] client disconnected");
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
    });
  });

  return wss;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/phdpc/Desktop/flow/FlowOS && npm run typecheck --workspace @flowos/electron
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add electron/src/realtime/server.ts
git commit -m "feat: process vscode.snapshot with 5s debounce and push Claude insight via IPC"
```

---

## Task 5: Main Process — Load dotenv

**Files:**
- Modify: `electron/src/main.ts`

- [ ] **Step 1: Add dotenv import to `electron/src/main.ts`**

Add `import "dotenv/config";` as the very first line of the file, before all other imports:

```typescript
import "dotenv/config";
import { app, BrowserWindow, ipcMain } from "electron";
import { ensureDatabase } from "@flowos/db";
import { demoSuggestions, demoTaskState, type Suggestion, type TaskState } from "@flowos/shared";
import { ipcChannels } from "./ipc/channels.js";
import { createRealtimeServer } from "./realtime/server.js";
import { getSwiftHelperStatus } from "./bridge/swiftHelper.js";
import { createMainWindow, createSidebarWindow } from "./windows/browserWindows.js";
```

(The rest of `main.ts` is unchanged.)

- [ ] **Step 2: Typecheck**

```bash
cd /Users/phdpc/Desktop/flow/FlowOS && npm run typecheck --workspace @flowos/electron
```

Expected: no errors.

- [ ] **Step 3: Build electron to verify**

```bash
cd /Users/phdpc/Desktop/flow/FlowOS && npm run build --workspace @flowos/electron
```

Expected: clean build, no errors.

- [ ] **Step 4: Commit**

```bash
git add electron/src/main.ts
git commit -m "feat: load .env via dotenv before bootstrap"
```

---

## Task 6: Renderer — Live Updates + Reasoning + Loading/Error States

**Files:**
- Modify: `renderer/src/App.tsx`

- [ ] **Step 1: Rewrite `renderer/src/App.tsx`**

```typescript
import { useEffect, useState } from "react";
import type { Suggestion, TaskState } from "@flowos/shared";
import { demoSuggestions, demoTaskState } from "@flowos/shared";
import { SuggestionList } from "./components/SuggestionList";

type BootstrapState = {
  taskState: TaskState;
  suggestions: Suggestion[];
  websocketPort: number;
  swiftHelper: { connected: boolean; socketPath: string };
};

type LiveState = {
  taskState?: TaskState;
  suggestions?: Suggestion[];
  reasoning?: string;
  hasError: boolean;
};

declare global {
  interface Window {
    flowos?: {
      getBootstrapState: () => Promise<BootstrapState>;
      onStateUpdate: (callback: (state: LiveState) => void) => void;
      onStateLoading: (callback: () => void) => void;
    };
  }
}

function useViewMode() {
  const params = new URLSearchParams(window.location.search);
  return params.get("view") === "sidebar" ? "sidebar" : "main";
}

export function App() {
  const viewMode = useViewMode();
  const [taskState, setTaskState] = useState<TaskState>(demoTaskState);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(demoSuggestions);
  const [websocketPort, setWebsocketPort] = useState(7331);
  const [reasoning, setReasoning] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!window.flowos) return;

    void window.flowos.getBootstrapState().then((state) => {
      setTaskState(state.taskState);
      setSuggestions(state.suggestions);
      setWebsocketPort(state.websocketPort);
    });

    window.flowos.onStateLoading(() => {
      setIsLoading(true);
      setHasError(false);
    });

    window.flowos.onStateUpdate((state) => {
      setIsLoading(false);
      if (state.hasError) {
        setHasError(true);
        return;
      }
      setHasError(false);
      if (state.taskState) setTaskState(state.taskState);
      if (state.suggestions) setSuggestions(state.suggestions);
      if (state.reasoning !== undefined) setReasoning(state.reasoning);
    });
  }, []);

  const fileSuggestions = suggestions.filter((item) => item.kind === "file");
  const commandSuggestions = suggestions.filter((item) => item.kind === "command");
  const tabSuggestions = suggestions.filter((item) => item.kind === "tab");

  if (viewMode === "sidebar") {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b_0%,#0f172a_48%,#020617_100%)] px-4 py-5 text-ink">
        <div className={`mb-5 rounded-3xl border border-orange-400/20 bg-black/20 p-4 transition-opacity ${isLoading ? "opacity-60" : "opacity-100"}`}>
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-[0.24em] text-orange-300/75">Flow State</div>
            <div className="flex items-center gap-2">
              {isLoading && <span className="text-[10px] text-white/40 animate-pulse">thinking…</span>}
              {hasError && <span className="text-[10px] text-orange-400/80">⚠ offline</span>}
            </div>
          </div>
          <h1 className="mt-2 text-xl font-semibold text-white">{taskState.title}</h1>
          <p className="mt-2 text-sm text-white/65">{taskState.substate}</p>
          <div className="mt-4 flex items-center justify-between text-xs text-white/45">
            <span>{taskState.mode}</span>
            <span>WS {websocketPort}</span>
          </div>
        </div>

        {reasoning && (
          <div className="mb-5 rounded-3xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 text-[11px] uppercase tracking-[0.24em] text-white/45">Why FlowOS thinks this</div>
            <p className="text-sm leading-6 text-white/60">{reasoning}</p>
          </div>
        )}

        <div className="space-y-4">
          <SuggestionList heading="Suggested Files" items={fileSuggestions} />
          <SuggestionList heading="Suggested Commands" items={commandSuggestions} />
          <SuggestionList heading="Suggested Tabs" items={tabSuggestions} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(135deg,#020617_0%,#0f172a_40%,#1f2937_100%)] p-8 text-ink">
      <div className="w-full max-w-5xl rounded-[32px] border border-white/10 bg-white/5 p-8 backdrop-blur">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-orange-300/75">
              FlowOS
            </div>
            <h1 className="mt-3 text-4xl font-semibold text-white">{taskState.title}</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-white/65">
              {taskState.substate}
            </p>
            {reasoning && (
              <div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/60 px-5 py-4 max-w-2xl">
                <div className="text-[11px] uppercase tracking-[0.22em] text-white/40 mb-2">Why FlowOS thinks this</div>
                <p className="text-sm leading-6 text-white/60">{reasoning}</p>
              </div>
            )}
          </div>

          <div className={`rounded-3xl border border-white/10 bg-slate-950/60 px-5 py-4 transition-opacity ${isLoading ? "opacity-60" : "opacity-100"}`}>
            <div className="flex items-center justify-between gap-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-white/45">Current Task</div>
              <div className="flex items-center gap-2">
                {isLoading && <span className="text-[10px] text-white/40 animate-pulse">thinking…</span>}
                {hasError && <span className="text-[10px] text-orange-400/80">⚠ offline</span>}
              </div>
            </div>
            <div className="mt-2 text-lg font-medium text-white">{taskState.title}</div>
            <div className="mt-2 text-sm text-white/55">{taskState.substate}</div>
            <div className="mt-3 text-xs text-white/30">{taskState.mode} · {Math.round(taskState.confidence * 100)}% confidence</div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck renderer**

```bash
cd /Users/phdpc/Desktop/flow/FlowOS && npm run typecheck --workspace @flowos/renderer
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add renderer/src/App.tsx
git commit -m "feat: subscribe to live IPC state updates, show reasoning and loading/error states"
```

---

## Verification

### End-to-End Test

1. Add your Anthropic API key to `.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

2. Start the full stack:
   ```bash
   cd /Users/phdpc/Desktop/flow/FlowOS && npm run dev
   ```

3. Press F5 in `extension-vscode/` folder to launch Extension Development Host.

4. Open any code project in the Extension Development Host.

5. Switch between a few files, then **wait 5 seconds without touching anything**.

6. Watch the FlowOS Electron window — the task card should update from demo data to Claude's inference. The reasoning section should appear below.

7. The sidebar window should also update with Claude's suggestions replacing the demo suggestions.

8. Introduce a TypeScript error in any file, wait 5 seconds — Claude should switch the mode to "debugging".

### Verify Loading State
Switch files rapidly, then stop. Within 300ms the VS Code extension sends a snapshot. After exactly 5 seconds of no activity, the UI should show `thinking…` on the task card. A few seconds later it should update with Claude's response.

### Verify Error Handling
Temporarily set an invalid API key in `.env`:
```
ANTHROPIC_API_KEY=invalid
```
Restart `npm run dev`. Switch files, wait 5 seconds. The UI should show `⚠ offline` on the task card but NOT crash or blank out — last known state (demo data) is preserved.

Restore the real key and restart to resume normal operation.
