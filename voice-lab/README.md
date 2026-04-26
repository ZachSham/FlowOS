# Voice Lab (Current Main)

Standalone prototype for:

`voice input -> transcript parser -> command selection -> native execution`

This folder is independent from renderer/Electron UI wiring.

## What It Does

- Captures voice with browser SpeechRecognition API (when available)
- Lets you paste a transcript manually as fallback
- Parses transcript into a command string (deterministic parser first)
- Optional LLM fallback parser for broader natural language matching
- Executes against current Swift helper stdio protocol (`helper.ping`, `system.snapshot`, `window.*`, `app.activate`)
- Shows full parse + execution JSON

## Supported Voice Commands

- `status`
- `request accessibility permission`
- `list windows`
- `list screens`
- `open vscode` (also chrome / terminal / safari)
- `activate app com.microsoft.VSCode`
- `hide this app`
- `hide vscode`
- `unhide vscode`
- `minimize this window`
- `restore this window`
- `minimize terminal`
- `raise this window`
- `move vscode to the right`
- `shift this window left a little`
- `move chrome left a little`
- `move this window to the other screen`
- `move window ax:12345:0 x 120 y 90`
- `resize window ax:12345:0 width 900 height 700`
- `set frame window ax:12345:0 x 80 y 80 width 900 height 700`

## Run Browser Voice Lab

From repo root:

```bash
cd /Users/phdpc/Desktop/flowFinal/FlowOS
npm run build:swift-helper
cd voice-lab
node server.mjs
```

Then open:

- <http://127.0.0.1:4180>

Use **Start Listening** and speak. It executes automatically when listening ends.
Use **Parse Transcript** only for parse-only preview.

## Optional LLM Fallback Parsing

Enable this when you want more free-form phrases to map to existing commands:

```bash
export VOICE_LAB_LLM_ENABLED=1
export OPENAI_API_KEY="<your_api_key>"
export VOICE_LAB_LLM_MODEL="gpt-4.1-mini"
```

Then run the server/CLI as usual. Behavior:

- Rule parser runs first.
- If rule parser cannot map command, LLM parser tries to map it to one of the supported command types.
- LLM output is validated and compiled to known safe command strings only.

## CLI Parse Only

```bash
cd /Users/phdpc/Desktop/flowFinal/FlowOS
node voice-lab/parse-cli.mjs "move vscode to the right"
```

## CLI Execute

```bash
cd /Users/phdpc/Desktop/flowFinal/FlowOS
node voice-lab/execute-cli.mjs "status"
node voice-lab/execute-cli.mjs "list windows"
node voice-lab/execute-cli.mjs "open vscode"
node voice-lab/execute-cli.mjs "move terminal to the right"
node voice-lab/execute-cli.mjs "minimize this window"
```

`move ... to the other screen` requires at least two displays.

## Push-To-Talk CLI (No Web App)

Run voice capture + parse + execute directly in terminal:

```bash
cd /Users/phdpc/Desktop/flowFinal/FlowOS
set -a && source .env && set +a
export VOICE_LAB_LLM_ENABLED=1
node voice-lab/push-to-talk-cli.mjs
```

Controls:

- Press `ENTER` to start recording
- Press `ENTER` again to stop, transcribe, and execute
- Type `q` then `ENTER` to quit

Recorder requirement:

- Install `ffmpeg` or `sox` (`rec` command)
- Example: `brew install ffmpeg`

Quick non-voice test:

```bash
node voice-lab/push-to-talk-cli.mjs --once "open vscode"
```

## Window ID Format

For direct window commands, use current helper IDs in `ax:PID:INDEX` format.
Get IDs with:

```bash
node voice-lab/execute-cli.mjs "list windows"
```

Example: `ax:656:1`

## Files

- `index.html`: standalone UI
- `app.mjs`: browser voice + UI logic
- `parser.mjs`: deterministic parser and command selection
- `llm-parser.mjs`: optional OpenAI fallback parser (strictly validated)
- `helper-client.mjs`: stdio bridge client for FlowStateHelper
- `executor.mjs`: transcript execution engine
- `parse-cli.mjs`: parser tester
- `execute-cli.mjs`: execute transcript in terminal
- `push-to-talk-cli.mjs`: terminal push-to-talk runner
- `server.mjs`: local server + API
