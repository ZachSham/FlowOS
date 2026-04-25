# VS Code Snapshot → Claude Processing Design

**Date:** 2026-04-25
**Status:** Approved

---

## Goal

When the VS Code extension sends a `vscode.snapshot`, Electron debounces 5 seconds of inactivity, calls the Claude API to interpret what the user is working on, and pushes live task state + suggestions + reasoning to both renderer windows via IPC.

---

## Architecture

```
VS Code extension
  └─ sends vscode.snapshot every ~300ms (on file switch, edit, save, error change)

Electron WebSocket server (port 7331)
  └─ receives vscode.snapshot
  └─ debounces 5s of inactivity
  └─ calls Claude API (claude-sonnet-4-6) with snapshot context
  └─ parses JSON response → taskState + suggestions + reasoning
  └─ updates in-memory state
  └─ pushes to all BrowserWindows via webContents.send()

Renderer (main + sidebar windows)
  └─ listens via context bridge ipcRenderer.on("state:updated")
  └─ updates React state
  └─ re-renders: task card, suggestions, reasoning summary
```

---

## Files

| File | Action | Responsibility |
|------|--------|---------------|
| `electron/src/claude/client.ts` | Create | Build prompt, call API, parse JSON response |
| `electron/src/realtime/server.ts` | Modify | Add snapshot handler, 5s debounce, call claude client, push via IPC |
| `electron/src/main.ts` | Modify | Pass windows to server, load `.env` |
| `electron/src/ipc/channels.ts` | Modify | Add `stateUpdated` push channel |
| `electron/src/preload.ts` | Modify | Expose `onStateUpdate(callback)` listener |
| `renderer/src/App.tsx` | Modify | Subscribe to live updates, show reasoning, loading + error states |
| `.env` | Create | `ANTHROPIC_API_KEY=sk-ant-...` (gitignored) |
| `.gitignore` | Modify | Add `.env` |

**Not touched:** `shared/src/index.ts`, `extension-vscode/`, `extension-chrome/`, `db/`

---

## Claude API Integration

**Model:** `claude-sonnet-4-6`

**Prompt caching:** System prompt is cached (never changes). Only the snapshot data changes per call.

**Input sent to Claude:**
```
- activeFile: string | undefined
- openTabs: string[] (file names only, max 10)
- gitBranch: string | undefined
- diagnostics: Array<{ file, severity, message }> (max 10)
- recentEdits: string[] (last 5 files from recentCommands field)
```

**System prompt (cached):**
```
You are FlowOS, an AI that observes a developer's coding context and infers 
what they are working on. Given a snapshot of their VS Code state, respond 
with ONLY valid JSON matching this exact shape — no prose, no markdown:

{
  "title": "short task title (max 8 words)",
  "mode": "coding|debugging|design|writing|researching|meeting|study",
  "substate": "one sentence describing current focus",
  "confidence": 0.0-1.0,
  "reasoning": "2-3 sentences explaining why you inferred this",
  "suggestions": [
    { "kind": "file|command|tab", "title": "...", "description": "...", "payload": "...", "confidence": 0.0-1.0 }
  ]
}

Return exactly 3 suggestions. If unsure, return lower confidence values.
```

**Response parsing:** `JSON.parse()` the response text. The `claude/client.ts` assigns a generated `id` (`crypto.randomUUID()`) and `source: "model"` to each suggestion before returning — Claude does not produce these. On parse failure or API error, keep last known state — do not update, do not crash.

---

## IPC Push Channel

**New channel:** `"state:updated"`

**Payload pushed to renderer:**
```typescript
{
  taskState: TaskState;
  suggestions: Suggestion[];
  reasoning: string;
}
```

**Electron side:** After Claude responds, call `window.webContents.send("state:updated", payload)` on all non-destroyed BrowserWindows.

**Renderer side:** `ipcRenderer.on("state:updated", callback)` exposed via context bridge as `window.flowos.onStateUpdate(callback)`.

---

## Renderer UI Changes

### Task Card
- Updates live when `state:updated` fires
- Subtle pulse animation (`animate-pulse` for 1 cycle) when new data arrives
- Shows loading spinner on task card while Claude is processing — spinner appears when the 5s debounce timer fires (not on every snapshot arrival), disappears when response arrives or fails
- On API error: small `⚠` indicator on task card, last known state preserved

### Reasoning Summary (new section)
Appears below task card in both main and sidebar views:
```
┌─────────────────────────────────┐
│ WHY FLOWOS THINKS THIS          │
│ <reasoning text from Claude>    │
└─────────────────────────────────┘
```
Styled consistent with existing card aesthetic (dark bg, white/60 text, rounded-3xl border).

### Suggestions
Already rendered by `SuggestionList`. Gets live data instead of demo data. No UI changes needed — data change is sufficient.

---

## Environment & API Key

- `ANTHROPIC_API_KEY` stored in `FlowOS/.env`
- `.env` added to `.gitignore`
- Loaded in `electron/src/main.ts` via `dotenv` package before bootstrap
- If key is missing: log a warning, skip Claude calls, keep showing demo data

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| No API key | Log warning on startup, skip all Claude calls |
| Claude API error | Log error, keep last known state, show `⚠` on task card |
| Invalid JSON response | Log warning, keep last known state |
| No snapshot received yet | Show demo data (existing behaviour) |
| VS Code disconnects | Stop debounce timer, keep last known state |
