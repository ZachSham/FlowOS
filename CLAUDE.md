# FlowOS — Claude Context

## Project Overview
FlowOS is a macOS AI desktop orchestrator. It lives in the menu bar, listens for voice commands via ⌘⇧K, and uses an AI agent loop to move windows, manage Chrome tabs, and apply focus layouts (Coding / Research / Auto) across multiple displays.

## Repo Structure
```
electron/        Main process: IPC, agent loop, Swift bridge, tracking, memory
renderer/        React + Vite UI: compact 340×420px frameless popover
swift-helper/    Native macOS binary (AXUIElement window control)
extension-chrome/ Manifest V3 Chrome extension (tabs/groups via WebSocket)
shared/          TypeScript contracts shared across all packages
```

## Branch Conventions
| Branch | Purpose |
|--------|---------|
| `main` | Stable base — currently cloud inference (OPENAI_API_KEY) |
| `edge-inference` | Active dev branch — cloud inference + memory injection + bug fixes |
| `backup/main-before-sync-2026-04-28` | Local inference version (Ollama + whisper.cpp) — preserved here |
| `cloud-inference` | Original cloud branch — do not modify |

**Default working branch: `edge-inference`**. Always confirm branch before committing.

## Inference Architecture
- **edge-inference / main**: Uses `OPENAI_API_KEY` + `OPENAI_MODEL` (default `gpt-4.1-mini`). Configured via `.env`.
- **backup/main-before-sync**: Uses Ollama (`FLOWOS_INFERENCE_MODEL=qwen2.5:1.5b`) + local whisper.cpp for STT. No API key needed but requires Ollama running.

## Running the App
```bash
# Start Ollama if on local inference branch
ollama serve

# Run dev server (builds everything + boots Electron)
npm run dev
```
Requires: Swift helper built (`npm run build:swift-helper`), Chrome extension loaded from `extension-chrome/dist/`.

## Key Files
- `electron/src/main.ts` — bootstrap, IPC handlers, tray, global shortcut
- `electron/src/services/openaiFlowOrchestrator.ts` — agent loop, tool definitions, prompt builders
- `electron/src/services/contextTriggerService.ts` — auto-layout on app focus (8s debounce)
- `electron/src/services/persistentMemoryStore.ts` — append-only markdown memory log
- `renderer/src/App.tsx` — popover UI (Linear-style, frameless)
- `electron/src/preload.cts` — contextBridge IPC surface

## Coding Preferences
- TypeScript strict mode — no `any`, use `unknown` with guards
- No comments unless the WHY is non-obvious
- No unused state, imports, or dead code
- Tests use Vitest — run with `npm run test --workspace @flowos/electron`
- Typecheck with `npx tsc --noEmit --project electron/tsconfig.json`
- Always run tests + typecheck before committing
- Commit messages: `feat:`, `fix:`, `refactor:` prefixes

## Token Budget (local inference)
- `MAX_TOTAL_TOKENS = 4000`, `MAX_OUTPUT_TOKENS = 512`
- `trimToBudget()` in orchestrator: always keeps first message + most recent history
- Tool results capped at 1,200 chars each

## Global Shortcut
⌘⇧K toggles mic from anywhere. `app.setActivationPolicy("accessory")` must be called at module level (before `app.whenReady()`) — moving it breaks the shortcut on macOS Sequoia.

## Memory System
Persistent memory lives at `~/Desktop/flowos-memory.md` (configurable via `FLOWOS_MEMORY_PATH`).
Only log meaningful outcomes — not per-command chrome operations.
Injected into LLM prompts as recent context for the last 5 successful runs.

## What NOT to Do
- Never commit to `main` directly without checking with the user
- Never skip `npm run test` before a commit
- Never add `console.log` for debugging without removing it
- Never use `net` from electron without the optional-chain fallback: `(net as unknown as { fetch?: typeof fetch } | undefined)?.fetch ?? fetch`
