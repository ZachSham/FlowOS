# FlowOS — Voice + Agentic Control Plane for macOS

FlowOS is a voice-first desktop assistant for macOS. Talk to it (or hit one button) and it rearranges your windows, displays, and Chrome tabs around what you're actually working on. An OpenAI tool-calling agent reads a live snapshot of your desktop — every app, every window, every display, every tab — and drives a native Swift helper plus a Chrome extension to act on it.

## What It Does

- **Voice commands**: Hold the mic, speak something like *"split my screen four ways with cursor, chrome, terminal, and slack"* — Whisper transcribes it, the agent plans the moves, the windows tile.
- **Flow Mode**: One click reorganizes your desktop for focused work — dev apps (Cursor, Codex, GitHub Desktop, Terminal) get a 2x2 layout on your primary display, everything else gets pushed to a secondary monitor or hidden.
- **Multi-display window management**: Move, resize, raise, focus, minimize, hide, and unhide windows across every connected display — including Sidecar / iPad — using the per-display *visible* rect (menu bar and Dock excluded).
- **Geometry-aware tiling**: Layouts are computed against the target display's `visibleX/Y/Width/Height` in macOS's global coordinate space, so windows fit cleanly on whichever monitor you point them at — internal Retina, external 4K, Sidecar iPad, all scaled per-display.
- **Chrome tab control**: Focus tabs, group tabs by topic, ungroup, pin, open new tabs — across every Chrome window. Closing tabs is intentionally **not** exposed (safety).
- **Intelligent grouping**: Flow Mode topic-groups Chrome tabs across multiple Chrome windows and consolidates related work without losing anything.
- **Live state context**: A 50-event ring buffer of native events (app launches/quits/activations, display add/remove) and a fresh system + Chrome snapshot are pre-injected into every voice / Flow run so the agent always knows current desktop state.
- **Self-correcting agent loop**: Up to 20 iterations of OpenAI tool calling, automatic re-snapshot after long mutation chains, graceful warnings on macOS Accessibility hiccups (Sidecar, multi-Space) instead of hard failures.

## Requirements

- macOS (Apple Silicon or Intel)
- Node.js 20+ and npm
- Swift toolchain (Xcode command line tools — `xcode-select --install`)
- Google Chrome (for the browser-control extension)
- An OpenAI API key with access to `gpt-4o`, `gpt-4.1`, or `gpt-5`, and the Whisper transcription endpoint
- Granted **Accessibility** and **Screen Recording** permissions for the FlowOS Electron app *and* the Swift helper binary (System Settings → Privacy & Security)

## Setup

### Step 1: Clone and install

```bash
git clone https://github.com/<you>/FlowOS.git
cd FlowOS
npm install
```

### Step 2: Configure environment

Copy `.env.example` to `.env` and fill in your OpenAI key:

```bash
cp .env.example .env
```

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o            # gpt-4o / gpt-4.1 / gpt-5 — anything with >8K context
FLOWOS_WS_PORT=7331
```

> If you set `OPENAI_MODEL=gpt-4` you will hit context-length errors — that legacy model only has 8K tokens and the snapshots we inject are larger than that. Use `gpt-4o` or newer.

### Step 3: Build the Swift native helper

The Swift helper is what actually moves your windows via the macOS Accessibility API.

```bash
./swift-helper/scripts/build.sh
```

This produces `swift-helper/bin/flowos-window-helper`.

### Step 4: Build the Chrome extension and load it

The Chrome extension is what gives FlowOS access to your tabs, windows, and groups. It connects back to Electron over a local WebSocket on port `7331`.

1. Build the extension:

   ```bash
   npm run build --workspace @flowos/extension-chrome
   ```

   This produces `extension-chrome/dist/`.

2. Open Chrome and go to `chrome://extensions`.
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select the `extension-chrome/dist` folder.

The extension will start broadcasting tab snapshots to FlowOS as soon as Electron is running.

### Step 5: Build everything else and launch

The simplest path is the root dev script, which builds shared types + Electron in watch mode, runs Vite for the renderer, and boots Electron once both are ready:

```bash
npm run dev
```

Or, for a one-shot production build of every package:

```bash
npm run build
```

On first launch macOS will prompt for **Accessibility** and **Screen Recording** permissions for both the FlowOS app and `flowos-window-helper`. Grant both — without them the helper cannot read or move windows.

### Quick sanity checks

```bash
npm run typecheck    # full repo typecheck
```

If the voice button greys out with "Voice capture is not available", your Electron build is missing microphone entitlement — restart `npm run dev`. If voice transcribes but the agent never moves windows, check that the Swift helper has Accessibility permission.

## Architecture

```text
                     🎙️ Speech In                🟢 Flow Mode Button
                          │                            │
                          ▼                            │
              MediaRecorder (renderer)                 │
                          │                            │
                          ▼                            │
                OpenAI Whisper (STT)                   │
                  gpt-4o-mini-transcribe               │
                          │                            │
                          └────────────┬───────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────────┐
                        │       OpenAI Agent Loop      │
                        │   GPT-4o / GPT-5 · ≤20 iters │
                        │      function calling        │
                        └──────────────┬───────────────┘
                                       │
       ┌────────────────┬──────────────┼──────────────┬──────────────┐
       │                │              │              │              │
   System          Chrome         Tracking       Tool calls       Tool calls
   Snapshot        Snapshot       Summary
   (apps/windows/  (tabs/windows/ (50-event       │              │
    displays)       groups)       ring buffer)    ▼              ▼
       ▲                ▲              ▲     Swift Native   Chrome Extension
       │                │              │     Helper         (Manifest V3
       │                │              │     (AX API,        + WebSocket)
       │                │              │      AppKit,             │
       │                │              │      CoreGraphics)       │
       │                │              │           │              │
       │                │              │           ▼              ▼
       │                │              │   🖥️ Window         🌐 Tab
       │                │              │      management        management
       │                │              │   move · resize    focus · pin
       │                │              │   raise · focus    open · group
       │                │              │   minimize · hide  ungroup
       │                │              │   per-display      (never close)
       │                │              │   visible-rect
       │                │              │   tiling
       │                │              │
       └─ live ─────────┴──── live ────┘
          snapshots             native events
```

The app follows a multi-process Electron architecture:

```
FlowOS/
├── electron/                     Main process: orchestrator, IPC, helper bridge,
│                                 agent loop, tracking session, Whisper transcribe
│   └── src/services/openaiFlowOrchestrator.ts   ← agent loop + tool definitions
├── renderer/                     React + Vite UI: voice button, Flow Mode button,
│                                 mic capture via MediaRecorder
├── swift-helper/                 Native macOS helper (Swift 5)
│   └── Sources/FlowStateHelper/  AXUIElement, NSScreen, JSON-RPC over stdio
├── extension-chrome/             Manifest V3 extension (tabs, tabGroups APIs)
├── shared/                       Shared TypeScript contracts: SystemSnapshot,
│                                 ChromeSnapshot, NativeEventEnvelope, etc.
└── extension-vscode/             VS Code extension (editor context, future)
```

## Operation Flow

1. User triggers a run by **speaking** (mic → MediaRecorder → IPC → Whisper) or pressing **Flow Mode**.
2. The orchestrator captures fresh context: a `system.snapshot` from the Swift helper (apps + windows + every display's geometry), the latest `chrome.snapshot` from the extension, and the rolling 50-event tracking summary.
3. All of that context is pre-injected into the user prompt alongside the transcript or Flow Mode directive.
4. The agent loop calls OpenAI with the prompt and the tool schema (`get_system_snapshot`, `move_window`, `resize_window`, `focus_window`, `minimize_window`, `hide_app`, `unhide_app`, `raise_window`, `get_chrome_snapshot`, `focus_chrome_tab`, `group_chrome_tabs`, `ungroup_chrome_tabs`, `pin_chrome_tab`, `open_chrome_tab`).
5. Each `tool_use` is dispatched to the right backend — the Swift helper for window/display ops, the Chrome extension over WebSocket for tab ops.
6. Tool results flow back as a `tool_result` message; the agent loops up to 20 iterations, re-snapshotting periodically as state mutates.
7. On AX hiccups (e.g. raising a window on a Sidecar display returns `kAXErrorCannotComplete`), the helper emits a warning instead of failing the action — the move/resize still applies and the agent continues with the rest of the targets.
8. When the agent has nothing left to do it returns a plain-English summary, which the renderer displays.

## Built With

- **Electron 36+** — multi-process desktop shell, IPC via `contextBridge`, always-on-top control window
- **TypeScript** — main process, renderer, Chrome extension, shared contracts
- **React + Vite** — renderer UI (voice button, Flow Mode, status)
- **Swift 5** — native helper using AppKit, Accessibility API (`AXUIElement`, `kAXRaiseAction`, `kAXPosition`, `kAXSize`), CoreGraphics, `NSScreen`
- **OpenAI Chat Completions** — agent loop with function calling on GPT-4o / GPT-4.1 / GPT-5 (configurable via `OPENAI_MODEL`)
- **OpenAI Whisper** — speech-to-text via `gpt-4o-mini-transcribe`
- **MediaRecorder API** — in-renderer audio capture (replaces the `webkitSpeechRecognition` path that does not work in Electron)
- **Chrome Extension (Manifest V3)** — `chrome.tabs`, `chrome.tabGroups`, `chrome.windows`, talking to Electron over a local WebSocket
- **WebSocket** — `ws://localhost:7331` event bus between Electron and the extensions
- **JSON-RPC over stdio** — Electron ↔ Swift helper protocol
- **npm workspaces** — monorepo across `electron`, `renderer`, `extension-chrome`, `extension-vscode`, `shared`

## Roadmap

- VS Code extension surface (active file, diagnostics, recent edits) feeding into the agent context
- Layout memory: remember and replay learned per-task layouts
- Notification muting + Do Not Disturb integration during Flow Mode
- Cross-platform Windows path via `node-window-manager`

## Beautiful Pictures

_Add screenshots of FlowOS arranging windows, the voice UI, and Chrome tab grouping here._

## Beautiful Video

_Add a demo video here. Make sure to unmute._
