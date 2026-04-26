# FlowOS

FlowOS is a desktop orchestration app for getting a user into flow state fast and keeping them there.

The app watches the current working context across windows, browser tabs, terminal activity, and editor state, figures out the user's likely objective, and offers a one-click transition into a focused workspace. On entry, it reorganizes the desktop, minimizes distractions, opens a persistent sidebar with context-aware suggestions, and starts tracking focus quality over the session.

## Core Product

### Main flow

1. The system detects the user's likely current objective from open apps, active files, browser tabs, terminal output, and window focus changes.
2. FlowOS asks whether the user wants to enter flow state.
3. On confirmation, FlowOS applies a layout for the current task:
   - VS Code on the left
   - terminal on the bottom right
   - localhost or browser preview on the top right
4. Distracting windows and tabs are hidden, minimized, parked, or moved out of the way.
5. A persistent sidebar stays open with suggested files, commands, and tabs.
6. The app tracks session quality, interruptions, and learned layout preferences over time.

### Product features

- Enter / exit flow state
- Auto-detect likely task and working mode
- Reorganize windows and desktops for the current task
- Reduce distraction by minimizing or parking irrelevant windows and tabs
- Sidebar suggestions for files, commands, and browser tabs
- Flow memory so user layout adjustments can be learned and reused
- Flow score and interruption cost tracking
- Context pack generation for Codex / Claude / Cursor style agents
- Session replay and handoff
- Command bar entry point
- Multiple base modes:
  - coding
  - debugging
  - design
  - writing
  - researching
  - meeting
  - study

### Planned integrations

- macOS Accessibility APIs
- Swift helper for native window and desktop control
- Chrome extension
- VS Code extension
- terminal integration
- notification muting
- Notion / Figma / Spotify integrations
- multi-monitor support

## Tech Stack

### Desktop shell

- Electron: application shell, always-on-top sidebar window, IPC, permissions, app lifecycle
- TypeScript: shared language across Electron, renderer, extensions, and shared packages
- Swift helper: native macOS sidecar for AXUIElement, AXObserver, Spaces/Desktop state, and monitor geometry

### OS integration

- AXUIElement: move, resize, focus, minimize, and inspect windows
- AXObserver: focused-window and app-switch event streams
- AppleScript / `osascript`: prototype layer for window control before Swift helper takes over
- `node-pty`: terminal attachment and output capture for task inference
- `node-window-manager`: optional Windows path later if cross-platform support is explored

### Browser control

- Chrome Extension (MV3): read tabs, active tab, pinned state, and eventually grouping / parking behavior
- have a server always runnign listeining for get requests (request sends info about data on users laptops and gets a response if it should change anythign and what tabs to group together)

### AI layer

- Claude API (vision): activation-time or major context-shift inference from screenshots and window context
- Claude API (text): event-driven updates from structured signals such as file changes, command results, and app switches
- Task-state engine: sits between raw events and model calls, decides current objective and whether an inference call is needed
- screenshot capture: feeds the vision path when needed

### Editor integration

- VS Code extension: active file, open tabs, diagnostics, git context, active symbol, recent edits, open-on-click commands from the sidebar

### Notification control

- macOS Do Not Disturb APIs
- Slack / Discord mute hooks during active focus sessions

### Sidebar UI

- React
- Tailwind CSS
- Framer Motion

### Distribution

- `electron-builder`: signed and notarized `.dmg`
- Electron updater
- direct download distribution instead of App Store because Accessibility-heavy apps do not fit App Store sandbox constraints well

### Build

- Vite for renderer development and production build
- npm workspaces for the monorepo

## Repository Layout

```text
FlowOS/
  electron/          # Electron main process, IPC, websocket server, window/bootstrap logic
  renderer/          # React sidebar and shell UI
  extension-chrome/  # Chrome MV3 extension
  extension-vscode/  # VS Code extension
  swift-helper/      # Native macOS helper
  shared/            # Shared TypeScript contracts
  types/             # Local declaration shims used by the scaffold
```

## Current Main Branch Setup

The current main branch is the bootstrap layer that lets the full app be built in parallel without interface drift.

### Root workspace

- npm workspaces configured at the repo root
- shared TypeScript base config
- `.env.example` with:
  - `ANTHROPIC_API_KEY`
  - `FLOWOS_WS_PORT`
  - `FLOWOS_DB_PATH`

### Shared contracts

`shared/src/index.ts` contains the shared app contracts used across packages, including:

- `TaskState`
- `Suggestion`
- `SessionLayout`
- `WindowConfig`
- `ChromeSnapshot`
- `VsCodeSnapshot`
- `RealtimeMessage`

These contracts are the backbone of the repo. Electron, the renderer, the Chrome extension, and the VS Code extension all pass the same object shapes.

### Electron

The Electron package currently provides:

- app startup
- a main shell window
- an always-on-top sidebar window
- preload bridge setup
- IPC bootstrap state loading
- local WebSocket server on port `7331`
- placeholder Swift helper bridge

Electron is the central orchestrator. It owns runtime coordination between the UI, native helper, AI layer, and external extensions.

### Renderer

The renderer package currently provides:

- Vite + React app
- main shell view
- sidebar view
- mock suggestion rendering
- styling and motion setup

Right now it is using typed demo state from the shared package so the UI can be built before live inference is connected.

### Chrome extension

The Chrome extension scaffold currently:

- uses MV3
- reads open tabs via `chrome.tabs.query`
- opens a local WebSocket connection to Electron
- sends tab snapshots into the local event bus

### VS Code extension

The VS Code extension scaffold currently:

- activates on startup
- opens a local WebSocket connection to Electron
- reports active file, open tabs, and diagnostics
- exposes a command for pushing a fresh snapshot

### Swift helper

The Swift helper is currently a package scaffold only. It exists now so native macOS automation can be added without restructuring the repo later.

Its future responsibilities are:

- AXUIElement window manipulation
- AXObserver event streams
- Spaces/Desktop awareness
- monitor geometry
- reliable native communication back to Electron

## How The App Works Together

At runtime, the app is intended to work like this:

1. Electron boots the app, starts the local WebSocket server, and creates the main window plus sidebar window.
2. The Chrome extension connects to Electron and sends browser tab state.
3. The VS Code extension connects to Electron and sends editor context.
4. The Swift helper provides native macOS window events and eventually window-control commands.
5. The task-state engine inside Electron combines those signals with terminal and system context.
6. If the current context changes enough, Electron decides whether to call the model layer.
7. The model returns structured outputs such as:
   - detected task
   - current mode
   - suggested files
   - suggested commands
   - suggested tabs
8. Electron pushes the latest state into the renderer through IPC so the sidebar stays current.
9. User actions in the sidebar trigger actions back through Electron, such as opening a file, running a command, focusing a window, or applying a layout.

## Local Development

### Requirements

- Node.js 20+
- npm
- macOS for the intended native automation path
- Xcode command line tools for future Swift helper work

### Install

```bash
npm install
```

### Run checks

```bash
npm run typecheck
npm run build
```

### Start development

```bash
npm run dev
```

Current dev behavior:

- the renderer runs on Vite
- Electron starts the shell and sidebar windows
- demo task state and suggestion data are loaded into the UI
- the local WebSocket server starts on port `7331`

## Features To Implement

1. Window and workspace orchestration
   - Build the real macOS window management layer.
   - Support layout presets for coding, debugging, writing, research, and meetings.
   - Move distracting windows or tabs out of the main desktop so switching context stays clean.
   - Add multi-monitor support and eventually learned layouts.

2. Task-state inference and AI suggestion engine
   - Build the task-state engine inside Electron.
   - Add structured event ingestion from browser, editor, terminal, and window-focus changes.
   - Call Claude only when needed and parse results into shared contracts.
   - Generate suggestions for files, commands, and tabs from live context.

3. Sidebar interaction layer
   - Replace mock data with live state.
   - Add actionable suggestion cards.
   - Add flow-state controls, session status, interruption cost, and flow score UI.
   - Add context-pack generation and session handoff surfaces.

4. External context integrations
   - Expand the Chrome extension to classify useful vs distracting tabs and perform tab actions.
   - Expand the VS Code extension to report richer coding context.
   - Add terminal integration, notification muting, and later optional third-party integrations.

## Notes

- The main branch should stay focused on shared contracts, runtime seams, and stable scaffolding.
- Shared types are the highest-priority integration boundary in the repo.
- The model layer should return typed JSON that maps directly into the shared package contracts.
