# Voice Command Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users speak any natural language command that Claude interprets via the existing 10-tool agentic infrastructure and executes natively on macOS.

**Architecture:** Add `runVoiceCommand(transcript)` to `AnthropicFlowOrchestrator` reusing its existing agentic loop (same tools, different prompt); wire a new `voice:run-command` IPC channel from renderer → main; capture voice in the renderer using the Web Speech API with a push-to-talk button that calls `window.flowos.runVoiceCommand(transcript)` on result.

**Tech Stack:** TypeScript, Electron IPC (`contextBridge`/`ipcMain`), Web Speech API (`SpeechRecognition`), Vitest, React hooks

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `electron/src/services/anthropicFlowOrchestrator.ts` | Export `buildVoicePrompt`, add `runVoiceCommand` method |
| Create | `electron/src/services/anthropicFlowOrchestrator.test.ts` | Unit tests for prompt builder + `runVoiceCommand` |
| Create | `electron/vitest.config.ts` | Vitest config for electron workspace |
| Modify | `electron/package.json` | Add vitest dev dep + test scripts |
| Modify | `electron/src/ipc/channels.ts` | Add `runVoiceCommand: "voice:run-command"` |
| Modify | `electron/src/main.ts` | Add `ipcMain.handle` for `runVoiceCommand` |
| Modify | `electron/src/preload.cts` | Expose `runVoiceCommand` via `contextBridge` |
| Create | `renderer/src/hooks/useVoiceDictation.ts` | Web Speech API hook |
| Modify | `renderer/src/App.tsx` | Mic button + voice result panel |

---

## Task 1: Add Vitest to the electron workspace

**Files:**
- Modify: `electron/package.json`
- Create: `electron/vitest.config.ts`

- [ ] **Step 1: Install vitest**

Run from the repo root (`/Users/phdpc/Desktop/flowFinal/FlowOS`):
```bash
npm install --save-dev vitest --workspace @flowos/electron
```

- [ ] **Step 2: Create `electron/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false
  }
});
```

- [ ] **Step 3: Add test scripts to `electron/package.json`**

In the `"scripts"` block, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify setup works (no test files found is OK)**

```bash
npm test --workspace @flowos/electron
```
Expected output: exits 0, prints "No test files found" or similar — no errors.

- [ ] **Step 5: Commit**
```bash
git add electron/package.json electron/vitest.config.ts
git commit -m "feat: add vitest to electron workspace"
```

---

## Task 2: Export `buildVoicePrompt` and write failing tests

**Files:**
- Modify: `electron/src/services/anthropicFlowOrchestrator.ts`
- Create: `electron/src/services/anthropicFlowOrchestrator.test.ts`

- [ ] **Step 1: Export `buildVoicePrompt` from the orchestrator**

In `electron/src/services/anthropicFlowOrchestrator.ts`, add this function after the existing `buildUserPrompt` function (around line 235):

```typescript
export function buildVoicePrompt(transcript: string): string {
  return [
    `The user said: "${transcript}".`,
    "You are controlling the user's Mac through explicit tools only.",
    "First inspect the current state using get_system_snapshot.",
    "Then execute what the user asked for using only the provided tools.",
    "If the request is ambiguous, make a reasonable interpretation and proceed.",
    "Finish with a short plain-English summary of what you did."
  ].join(" ");
}
```

- [ ] **Step 2: Write the failing tests**

Create `electron/src/services/anthropicFlowOrchestrator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildVoicePrompt, AnthropicFlowOrchestrator } from "./anthropicFlowOrchestrator.js";
import type { NativeHelperBridge } from "../bridge/swiftHelper.js";
import type { TrackingSession } from "./trackingSession.js";

function makeMockBridge(): NativeHelperBridge {
  return {
    request: vi.fn().mockResolvedValue({ ok: true }),
    onEvent: vi.fn(),
    getStatus: vi.fn().mockReturnValue({ connected: false, transport: "stdio", command: [] }),
    stop: vi.fn()
  } as unknown as NativeHelperBridge;
}

function makeMockSession(): TrackingSession {
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

describe("buildVoicePrompt", () => {
  it("includes the transcript verbatim", () => {
    const prompt = buildVoicePrompt("open vscode");
    expect(prompt).toContain("open vscode");
  });

  it("instructs Claude to call get_system_snapshot first", () => {
    const prompt = buildVoicePrompt("anything");
    expect(prompt).toContain("get_system_snapshot");
  });

  it("does not contain hardcoded flow-mode content", () => {
    const prompt = buildVoicePrompt("minimize terminal");
    expect(prompt).not.toContain("2x2");
    expect(prompt).not.toContain("develop mode");
    expect(prompt).not.toContain("Cursor");
  });
});

describe("AnthropicFlowOrchestrator.runVoiceCommand", () => {
  const originalKey = process.env["ANTHROPIC_API_KEY"];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env["ANTHROPIC_API_KEY"];
    } else {
      process.env["ANTHROPIC_API_KEY"] = originalKey;
    }
  });

  it("returns ok:false when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    const orchestrator = new AnthropicFlowOrchestrator({
      bridge: makeMockBridge(),
      trackingSession: makeMockSession()
    });
    const result = await orchestrator.runVoiceCommand("open vscode");
    expect(result.ok).toBe(false);
    expect(result.summary).toContain("ANTHROPIC_API_KEY");
  });

  it("includes transcript in the first user message sent to the API", async () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "Opened VS Code." }],
        stop_reason: "end_turn"
      })
    });
    vi.stubGlobal("fetch", mockFetch);

    const orchestrator = new AnthropicFlowOrchestrator({
      bridge: makeMockBridge(),
      trackingSession: makeMockSession()
    });
    await orchestrator.runVoiceCommand("focus on terminal");

    const callBody = JSON.parse(
      (mockFetch.mock.calls[0] as [string, { body: string }])[1].body
    ) as { messages: Array<{ role: string; content: Array<{ type: string; text: string }> }> };
    expect(callBody.messages[0]?.content[0]?.text).toContain("focus on terminal");
  });

  it("returns ok:true with the API text as summary on success", async () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Focused Terminal window." }],
          stop_reason: "end_turn"
        })
      })
    );

    const orchestrator = new AnthropicFlowOrchestrator({
      bridge: makeMockBridge(),
      trackingSession: makeMockSession()
    });
    const result = await orchestrator.runVoiceCommand("focus on terminal");
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("Focused Terminal window.");
  });

  it("returns toolCalls populated when Claude uses tools", async () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key";
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) {
          return {
            ok: true,
            json: async () => ({
              content: [
                { type: "tool_use", id: "t1", name: "activate_app", input: { bundleId: "com.apple.Terminal" } }
              ],
              stop_reason: "tool_use"
            })
          };
        }
        return {
          ok: true,
          json: async () => ({
            content: [{ type: "text", text: "Activated Terminal." }],
            stop_reason: "end_turn"
          })
        };
      })
    );

    const orchestrator = new AnthropicFlowOrchestrator({
      bridge: makeMockBridge(),
      trackingSession: makeMockSession()
    });
    const result = await orchestrator.runVoiceCommand("open terminal");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe("activate_app");
  });
});
```

- [ ] **Step 3: Run tests — verify they fail**

```bash
npm test --workspace @flowos/electron
```
Expected: Tests fail because `runVoiceCommand` doesn't exist yet.

- [ ] **Step 4: Commit the failing tests**
```bash
git add electron/src/services/anthropicFlowOrchestrator.ts electron/src/services/anthropicFlowOrchestrator.test.ts
git commit -m "test: add failing tests for voice command orchestrator"
```

---

## Task 3: Implement `runVoiceCommand` on the orchestrator

**Files:**
- Modify: `electron/src/services/anthropicFlowOrchestrator.ts`

- [ ] **Step 1: Add `runVoiceCommand` method to `AnthropicFlowOrchestrator`**

Inside the `AnthropicFlowOrchestrator` class, add after `enterDevelopFlowMode()`:

```typescript
async runVoiceCommand(transcript: string): Promise<FlowRunResult> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  const model = process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-4-0";

  if (!apiKey) {
    return {
      ok: false,
      summary: "Missing ANTHROPIC_API_KEY in .env",
      model: null,
      snapshotTimestamp: null,
      toolCalls: [],
      toolResults: []
    };
  }

  const messages: Array<{
    role: "user" | "assistant";
    content: Array<Record<string, unknown>>;
  }> = [
    {
      role: "user",
      content: [{ type: "text", text: buildVoicePrompt(transcript) }]
    }
  ];

  const toolCalls: FlowToolUse[] = [];
  const toolResults: Array<{ name: string; result: unknown }> = [];
  let snapshotTimestamp: string | null = null;
  let finalSummary = "Voice command finished without a summary.";

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const response = await callAnthropic({ apiKey, model, messages });

    messages.push({
      role: "assistant",
      content: response.content as unknown as Array<Record<string, unknown>>
    });

    const text = response.content
      .filter((block): block is AnthropicTextBlock => block.type === "text")
      .map((block) => block.text.trim())
      .filter(Boolean)
      .join("\n");

    if (text) {
      finalSummary = text;
    }

    const toolUses = response.content.filter(
      (block): block is AnthropicToolUseBlock => block.type === "tool_use"
    );

    if (toolUses.length === 0) {
      break;
    }

    const toolResultBlocks: Array<Record<string, unknown>> = [];
    for (const toolUse of toolUses) {
      toolCalls.push({ name: toolUse.name, input: toolUse.input });
      const result = await this.executeTool(toolUse.name, toolUse.input);
      if (isSystemSnapshot(result)) {
        snapshotTimestamp = result.timestamp;
      }
      toolResults.push({ name: toolUse.name, result });
      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify(result)
      });
    }

    messages.push({ role: "user", content: toolResultBlocks });
  }

  return { ok: true, summary: finalSummary, model, snapshotTimestamp, toolCalls, toolResults };
}
```

- [ ] **Step 2: Run tests — verify all pass**

```bash
npm test --workspace @flowos/electron
```
Expected: All 6 tests pass.

- [ ] **Step 3: Commit**
```bash
git add electron/src/services/anthropicFlowOrchestrator.ts
git commit -m "feat: add runVoiceCommand to AnthropicFlowOrchestrator"
```

---

## Task 4: Wire IPC — channels, main.ts, preload

**Files:**
- Modify: `electron/src/ipc/channels.ts`
- Modify: `electron/src/main.ts`
- Modify: `electron/src/preload.cts`

- [ ] **Step 1: Add channel to `electron/src/ipc/channels.ts`**

Replace the file contents with:
```typescript
export const ipcChannels = {
  getBootstrapState: "bootstrap:get-state",
  startTracking: "tracking:start",
  enterFlowMode: "flow:enter",
  stateUpdated: "state:updated",
  runChromeCommand: "chrome:run-command",
  runVoiceCommand: "voice:run-command"
} as const;
```

- [ ] **Step 2: Add IPC handler in `electron/src/main.ts`**

Inside `bootstrap()`, after the `ipcMain.handle(ipcChannels.enterFlowMode, ...)` block (around line 140), add:

```typescript
ipcMain.handle(ipcChannels.runVoiceCommand, async (_event, transcript: string) => {
  return await flowOrchestrator.runVoiceCommand(transcript);
});
```

- [ ] **Step 3: Expose `runVoiceCommand` in `electron/src/preload.cts`**

Add `runVoiceCommand: "voice:run-command"` to the local `channels` object:
```typescript
const channels = {
  getBootstrapState: "bootstrap:get-state",
  startTracking: "tracking:start",
  enterFlowMode: "flow:enter",
  stateUpdated: "state:updated",
  runChromeCommand: "chrome:run-command",
  runVoiceCommand: "voice:run-command"
} as const;
```

Then add to the `contextBridge.exposeInMainWorld("flowos", { ... })` object:
```typescript
runVoiceCommand: (transcript: string) =>
  ipcRenderer.invoke(channels.runVoiceCommand, transcript)
```

- [ ] **Step 4: Typecheck**
```bash
npm run typecheck --workspace @flowos/electron
```
Expected: 0 errors.

- [ ] **Step 5: Commit**
```bash
git add electron/src/ipc/channels.ts electron/src/main.ts electron/src/preload.cts
git commit -m "feat: wire voice:run-command IPC channel end-to-end"
```

---

## Task 5: Create `useVoiceDictation` hook

**Files:**
- Create: `renderer/src/hooks/useVoiceDictation.ts`

- [ ] **Step 1: Create the hook**

Create `renderer/src/hooks/useVoiceDictation.ts`:

```typescript
import { useCallback, useRef, useState } from "react";

export type VoiceDictationHook = {
  isListening: boolean;
  lastTranscript: string;
  error: string | null;
  supported: boolean;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useVoiceDictation(
  onTranscript: (transcript: string) => void
): VoiceDictationHook {
  const [isListening, setIsListening] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setError("Speech recognition is not supported in this browser.");
      return;
    }

    setError(null);
    setLastTranscript("");

    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      setLastTranscript(transcript);
      if (transcript) {
        onTranscriptRef.current(transcript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setError(`Recognition error: ${event.error}`);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  return {
    isListening,
    lastTranscript,
    error,
    supported: getSpeechRecognitionCtor() !== null,
    start,
    stop
  };
}
```

- [ ] **Step 2: Typecheck renderer**
```bash
npm run typecheck --workspace @flowos/renderer
```
Expected: 0 errors.

- [ ] **Step 3: Commit**
```bash
git add renderer/src/hooks/useVoiceDictation.ts
git commit -m "feat: add useVoiceDictation hook (Web Speech API)"
```

---

## Task 6: Add mic button and voice panel to `App.tsx`

**Files:**
- Modify: `renderer/src/App.tsx`

- [ ] **Step 1: Add `runVoiceCommand` to the Window type declaration**

In `renderer/src/App.tsx`, update the `declare global` block:

```typescript
declare global {
  interface Window {
    flowos?: {
      getBootstrapState: () => Promise<BootstrapState>;
      startTracking: () => Promise<TrackingState>;
      enterFlowMode: () => Promise<FlowRunResult>;
      runVoiceCommand: (transcript: string) => Promise<FlowRunResult>;
    };
  }
}
```

- [ ] **Step 2: Import the hook**

At the top of `renderer/src/App.tsx`, add:
```typescript
import { useVoiceDictation } from "./hooks/useVoiceDictation";
```

- [ ] **Step 3: Add voice state and handler inside `App()`**

After the existing `useState` declarations, add:
```typescript
const [voiceResult, setVoiceResult] = useState<FlowRunResult | null>(null);

async function handleVoiceTranscript(transcript: string) {
  if (!window.flowos) {
    setErrorMessage("Electron preload bridge is unavailable.");
    return;
  }
  setIsSubmitting(true);
  setErrorMessage(null);
  setStatusMessage(`Voice: "${transcript}" — processing...`);
  try {
    const result = await window.flowos.runVoiceCommand(transcript);
    setVoiceResult(result);
    setStatusMessage(result.ok ? "Voice command completed." : "Voice command failed.");
    if (!result.ok) setErrorMessage(result.summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setErrorMessage(message);
    setStatusMessage("Voice command failed.");
  } finally {
    setIsSubmitting(false);
  }
}

const {
  isListening,
  lastTranscript,
  error: voiceError,
  supported: voiceSupported,
  start: startListening,
  stop: stopListening
} = useVoiceDictation(handleVoiceTranscript);
```

- [ ] **Step 4: Add the mic button to the button row**

In the `mt-6 flex flex-col gap-3 sm:flex-row` div, add after the "Enter Flow Mode" button:

```tsx
<button
  type="button"
  onClick={isListening ? stopListening : startListening}
  disabled={isSubmitting || !voiceSupported}
  className={`rounded-2xl border px-4 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
    isListening
      ? "border-red-400/40 bg-red-400/15 text-red-100 hover:bg-red-400/25"
      : "border-white/15 bg-white/10 text-white hover:bg-white/15"
  }`}
>
  {isListening ? "Stop Recording" : "Voice Command"}
</button>
```

- [ ] **Step 5: Add the voice result panel**

After the Bridge Command section (the last `<section>` in the return), add:

```tsx
{(lastTranscript || voiceError || voiceResult) ? (
  <section className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-5">
    <div className="text-[11px] uppercase tracking-[0.3em] text-white/50">Voice</div>
    {lastTranscript ? (
      <p className="mt-3 text-sm text-white/75">
        <span className="text-white/45">Heard: </span>
        {lastTranscript}
      </p>
    ) : null}
    {voiceError ? (
      <p className="mt-2 text-sm text-red-300/85">{voiceError}</p>
    ) : null}
    {voiceResult ? (
      <p className="mt-2 text-sm text-white/75">{voiceResult.summary}</p>
    ) : null}
  </section>
) : null}
```

- [ ] **Step 6: Typecheck renderer**
```bash
npm run typecheck --workspace @flowos/renderer
```
Expected: 0 errors.

- [ ] **Step 7: Commit**
```bash
git add renderer/src/App.tsx
git commit -m "feat: add voice command button and result panel to App"
```

---

## Task 7: End-to-end smoke test (manual)

This task requires the running Electron app with Swift helper and `ANTHROPIC_API_KEY` set. Cannot be automated.

- [ ] **Step 1: Confirm `.env` has `ANTHROPIC_API_KEY` set**
```bash
grep ANTHROPIC_API_KEY /Users/phdpc/Desktop/flowFinal/FlowOS/.env
```
Expected: line with a non-empty key value.

- [ ] **Step 2: Build and launch**
```bash
npm run dev
```
Wait for the Electron window to appear.

- [ ] **Step 3: Simple command — "open terminal"**
1. Click "Voice Command" (button turns red)
2. Say "open terminal"
3. Click "Stop Recording"

Expected:
- Status bar shows `Voice: "open terminal" — processing...`
- Terminal.app becomes active within ~3 seconds
- Voice panel shows: `Heard: open terminal` and a summary like `Activated Terminal.`

- [ ] **Step 4: Complex command — "minimize all windows except vscode"**
1. Click "Voice Command", speak, click "Stop Recording"

Expected: Claude calls `get_system_snapshot`, identifies non-VSCode windows, calls `minimize_window` for each. Summary describes what was done.

- [ ] **Step 5: Error path — missing API key**
1. Comment out `ANTHROPIC_API_KEY` in `.env`
2. Restart the app (`npm run dev`)
3. Try a voice command

Expected: Error shown — "Missing ANTHROPIC_API_KEY in .env". Restore key after.

- [ ] **Step 6: Run full test suite one last time**
```bash
npm test --workspace @flowos/electron
```
Expected: All tests pass.

- [ ] **Step 7: Final commit**
```bash
git add -A
git commit -m "feat: voice command integration — complete"
```
