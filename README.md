# FlowOS (Minimal Menubar MVP)

FlowOS is now rebuilt as a **minimal macOS menubar app** with one core surface:

- A top-bar `FlowOS` menu with:
  - detected objective
  - `Enter Flow Mode`
  - `Exit Flow Mode`
  - suggested next actions (open file, run command, open tab)
  - save/rejoin session
- Local API server on `http://127.0.0.1:4789`
- Chrome extension bridge for tab context, tab grouping, and browser error capture

No heavy desktop window UI is required for this MVP.

## What It Does

1. Detects likely objective using local heuristics from:
   - active front app/window title
   - recent terminal history (`~/.zsh_history`)
   - Chrome tabs/context from extension
2. Suggests entering flow mode via menu and notifications.
3. On `Enter Flow Mode`, it:
   - moves VS Code left (55%)
   - moves Chrome top-right
   - moves Terminal bottom-right
   - hides distracting apps (Discord, Spotify, Mail)
   - asks extension to group tabs into `Flow` and collapsed `Later`
4. On `Leave Session & Restore`, it:
   - restores tracked app window positions and focus
   - fully ungroups Chrome tabs created during flow
   - restores tab pinning and previously active tab
4. Captures frontend browser errors (`window.onerror`, `unhandledrejection`) and shows them in FlowOS state.
5. Saves and rejoins flow sessions.

## Repo Layout

```text
FlowOS/
  electron/            # Menubar app + local API + objective detection + macOS automation
  extension-chrome/    # MV3 extension for tab context, grouping, and error capture
```

## Requirements

- macOS
- Node.js 20+
- Google Chrome
- VS Code CLI on PATH (`code` command)
- Accessibility permission for FlowOS/Electron to move windows
- Optional: `Hammerspoon` for moving distraction apps to Desktop 2
  - Disabled by default to avoid persistent side effects
  - Enable only if you explicitly set `FLOWOS_ENABLE_HAMMERSPOON=1`

## Install

```bash
npm install
```

## Guided Hammerspoon Setup (Desktop 2 Support)

Run:

```bash
npm run setup:hammerspoon
```

Or from the menubar app:

- `FlowOS` -> `Run Guided Hammerspoon Setup`

This guided setup installs/configures Hammerspoon, wires the FlowOS helper, and walks through required permissions.

## Run FlowOS

```bash
npm run dev
```

That starts the Electron menubar app.

You should see `FlowOS` in the macOS top bar.

To enable Desktop-2 moves with Hammerspoon (opt-in only):

```bash
FLOWOS_ENABLE_HAMMERSPOON=1 npm run dev
```

## Build

```bash
npm run build
```

## Load Chrome Extension

1. Build extension:

```bash
npm run build:extension
```

2. Open Chrome: `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select:

```text
/Users/ayan/Desktop/FlowOS/extension-chrome/dist
```

## Test End-to-End

1. Start FlowOS with `npm run dev`
2. Ensure apps are open: VS Code, Chrome, Terminal, Discord (optional)
3. Open noisy Chrome tabs (localhost, React docs, Stack Overflow, YouTube, Gmail)
4. Click top bar `FlowOS` menu
5. Click `Analyze Workspace`
6. Click `Enter Flow Mode`

Expected:

- VS Code moved left
- Chrome moved top-right
- Terminal moved bottom-right
- Discord/Spotify/Mail hidden
- Chrome tabs grouped into `Flow` and collapsed `Later`
- `Exit Flow Mode (Restore)` should ungroup tabs and restore your prior active tab/pins

Browser error test:

1. Open a localhost page
2. Trigger an error in DevTools console:

```js
setTimeout(() => {
  throw new Error('TypeError: user is null');
}, 0)
```

3. FlowOS menu should reflect a captured browser error.

Session test:

1. In menubar menu, click `Save Session`
2. Exit flow mode
3. Use `Rejoin Session` submenu

## Local API (for manual checks)

- `POST /flow/analyze`
- `POST /flow/enter`
- `POST /flow/exit`
- `POST /flow/leave`
- `POST /flow/save`
- `GET /flow/sessions`
- `POST /chrome/context`
- `GET /chrome/command`
- `POST /chrome/result`
- `POST /chrome/error`
- `POST /vscode/open-file`
- `POST /terminal/run-command`

Example:

```bash
curl -X POST http://127.0.0.1:4789/flow/analyze
```

## Notes

- This is intentionally minimal and hackathon-oriented.
- Objective detection is heuristic-first and easy to replace with AI later.
- If window movement fails, grant Accessibility permissions and relaunch the app.
