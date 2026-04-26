# Voice Lab (Standalone)

Standalone prototype for:

`voice input -> transcript parser -> command string -> helper execution`

This folder is intentionally independent from Electron/main app wiring.

## What It Does

- Captures voice with browser SpeechRecognition API (when available)
- Lets you paste a transcript manually as fallback
- Parses transcript into a canonical command string
- Executes commands via `FlowStateHelper`
- Shows full parse + execution JSON

## Supported Dictated Commands

These map to `FlowStateHelper` commands in `swift-helper/Sources/FlowStateHelper/main.swift`.

- `status`
- `request accessibility permission`
- `list windows`
- `open vscode` (also chrome / terminal / safari)
- `minimize this window`
- `minimize terminal`
- `activate app com.microsoft.VSCode`
- `move vscode to the right`
- `move chrome left a little`
- `move this window to the other screen`
- `raise window pid 37904 index 0`
- `move window pid 37904 index 0 x 120 y 90`
- `resize window pid 37904 index 0 width 900 height 700`
- `set frame window pid 37904 index 0 x 80 y 80 width 900 height 700`

## Command String Output Examples

- `swift-helper/.build/debug/FlowStateHelper status`
- `swift-helper/.build/debug/FlowStateHelper list-windows`
- `swift-helper/.build/debug/FlowStateHelper run-action '{"type":"native.app.activate","bundleId":"com.microsoft.VSCode"}'`
- `swift-helper/.build/debug/FlowStateHelper run-action '{"type":"native.window.setFrame","windowId":"pid:37904:index:0","frame":{"x":80,"y":80,"width":900,"height":700}}'`
- `FLOW_COMMAND type=window.move_relative target=app:com.microsoft.VSCode direction=right amount=medium`
- `FLOW_COMMAND type=window.move_to_other_screen target=frontmost`
- `FLOW_COMMAND type=window.minimize target=frontmost`

## Run The Browser Voice Prototype

From repo root:

```bash
cd /Users/phdpc/Desktop/flowFinal/FlowOS/voice-lab
node server.mjs
```

Then open:

- <http://127.0.0.1:4180>

Use **Start Listening** and speak; command execution starts automatically when listening ends.
Use **Parse Transcript** only if you want parse-only preview without execution.

Important:
- Build helper first: `npm run build:swift-helper` (from repo root)
- Grant Accessibility once: `swift-helper/.build/debug/FlowStateHelper request-accessibility`

## Run Parser In CLI (No Mic)

From repo root:

```bash
node /Users/phdpc/Desktop/flowFinal/FlowOS/voice-lab/parse-cli.mjs "open vscode"
node /Users/phdpc/Desktop/flowFinal/FlowOS/voice-lab/parse-cli.mjs "move this window to the other screen"
```

## Run Execute In CLI (No Mic UI)

```bash
node /Users/phdpc/Desktop/flowFinal/FlowOS/voice-lab/execute-cli.mjs "open vscode"
node /Users/phdpc/Desktop/flowFinal/FlowOS/voice-lab/execute-cli.mjs "minimize this window"
node /Users/phdpc/Desktop/flowFinal/FlowOS/voice-lab/execute-cli.mjs "move vscode to the right"
node /Users/phdpc/Desktop/flowFinal/FlowOS/voice-lab/execute-cli.mjs "move this window to the other screen"
```

`move ... to the other screen` requires at least two connected displays.

## Window ID Format

For window actions, include one of:

- `pid 37904 index 0`
- `pid:37904:index:0`
- `pid 37904 window 12345`

## LLM Parsing (Optional)

Yes, you can connect an LLM.

- Option 1: Speech-to-text first, then parse text with an LLM.
- Option 2: Audio directly to a speech-capable LLM, returning structured JSON.

Recommended integration:

1. Keep `app.mjs` voice capture.
2. Send transcript/audio to your LLM endpoint.
3. Ask model to return strict JSON:
   - `intent`
   - `target`
   - `direction`
   - `amount`
4. Convert that JSON into the same `commandString` format used in this lab.

## Files

- `index.html`: standalone UI
- `app.mjs`: browser voice + UI logic
- `parser.mjs`: deterministic parser and command-string generation
- `parse-cli.mjs`: quick parser tester for terminal
- `executor.mjs`: transcript execution engine (calls helper commands/actions)
- `execute-cli.mjs`: execute transcripts directly from terminal
- `server.mjs`: local server for UI + `/api/execute`
