import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { screen, shell } from "electron";
import type { WorkspaceSnapshot } from "./types.js";

const execFileAsync = promisify(execFile);
const FOCUS_APPS = ["Code", "Google Chrome", "Terminal"];
const DISTRACTION_APPS = ["Discord", "Spotify", "Mail"];
const DISTRACTION_TITLE_TOKENS = [
  "youtube",
  "gmail",
  "reddit",
  "x.com",
  "twitter",
  "netflix",
  "amazon"
];
const FOCUS_KEEP_APPS = ["Code", "Terminal", "Google Chrome", "Codex", "Hammerspoon"];
const COMMAND_TIMEOUT_MS = 2500;
const HAMMERSPOON_ENABLED = process.env.FLOWOS_ENABLE_HAMMERSPOON === "1";
const FLOWOS_HAMMERSPOON_HELPER_PATH = fileURLToPath(
  new URL("../../scripts/flowos-hammerspoon.lua", import.meta.url)
);
const FLOWOS_HS_PORT = Number(process.env.FLOWOS_HS_PORT ?? "7710");
const FLOWOS_HS_BASE_URL = `http://127.0.0.1:${FLOWOS_HS_PORT}`;

interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

async function execFileSafe(
  file: string,
  args: string[],
  timeoutMs = COMMAND_TIMEOUT_MS,
  quiet = false
): Promise<ExecResult> {
  try {
    const result = await execFileAsync(file, args, { timeout: timeoutMs, killSignal: "SIGKILL" });
    return {
      ok: true,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? ""
    };
  } catch (error) {
    if (!quiet) {
      console.error(`[flow] command failed: ${file} ${args.join(" ")}`);
    }
    return {
      ok: false,
      stdout: "",
      stderr: ""
    };
  }
}

async function runAppleScript(script: string): Promise<void> {
  await execFileSafe("osascript", ["-e", script], 2500, true);
}

async function runAppleScriptResult(script: string): Promise<string> {
  const { stdout } = await execFileSafe("osascript", ["-e", script], 2000, true);
  return stdout.trim();
}

function quote(value: string): string {
  return value.replace(/"/g, '\\"');
}

async function moveAppWindow(appName: string, x: number, y: number, width: number, height: number): Promise<void> {
  const script = [
    'tell application "System Events"',
    `if exists process "${quote(appName)}" then`,
    `tell process "${quote(appName)}"`,
    "if exists window 1 then",
    `set position of window 1 to {${x}, ${y}}`,
    `set size of window 1 to {${width}, ${height}}`,
    "set frontmost to true",
    "end if",
    "end tell",
    "end if",
    "end tell"
  ].join("\n");

  await runAppleScript(script);
}

function moveWindowSnippet(appName: string, x: number, y: number, width: number, height: number): string {
  return [
    `if exists process "${quote(appName)}" then`,
    `tell process "${quote(appName)}"`,
    "if exists window 1 then",
    `set position of window 1 to {${x}, ${y}}`,
    `set size of window 1 to {${width}, ${height}}`,
    "end if",
    "end tell",
    "end if"
  ].join("\n");
}

async function hideApp(appName: string): Promise<void> {
  await runAppleScript(`tell application "${quote(appName)}" to hide`);
}

async function showApp(appName: string): Promise<void> {
  await runAppleScript(`tell application "${quote(appName)}" to activate`);
}

async function getFocusedAppName(): Promise<string> {
  return runAppleScriptResult(
    'tell application "System Events" to get name of first application process whose frontmost is true'
  );
}

async function captureAppWindowState(appName: string): Promise<WorkspaceSnapshot["trackedApps"][number]> {
  const script = [
    'tell application "System Events"',
    `if exists process "${quote(appName)}" then`,
    `tell process "${quote(appName)}"`,
    "if exists window 1 then",
    "set p to position of window 1",
    "set s to size of window 1",
    'return (item 1 of p as text) & "," & (item 2 of p as text) & "," & (item 1 of s as text) & "," & (item 2 of s as text)',
    "end if",
    "end tell",
    "end if",
    "end tell",
    'return ""'
  ].join("\n");

  const raw = await runAppleScriptResult(script);
  const parts = raw.split(",").map((part) => Number(part.trim()));

  if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) {
    return {
      appName,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      hasWindow: false
    };
  }

  return {
    appName,
    x: parts[0] ?? 0,
    y: parts[1] ?? 0,
    width: parts[2] ?? 0,
    height: parts[3] ?? 0,
    hasWindow: true
  };
}

async function minimizeAllWindows(appName: string): Promise<void> {
  const script = [
    'tell application "System Events"',
    `if exists process "${quote(appName)}" then`,
    `tell process "${quote(appName)}"`,
    "repeat with w in windows",
    "set miniaturized of w to true",
    "end repeat",
    "end tell",
    "end if",
    "end tell"
  ].join("\n");

  await runAppleScript(script);
}

async function ensureTopFocus(): Promise<void> {
  await showApp("Google Chrome");
  await showApp("Terminal");
  await showApp("Code");
}

async function commandExists(command: string): Promise<boolean> {
  const result = await execFileSafe("sh", ["-lc", `command -v ${command}`], 1000, true);
  return result.ok && result.stdout.trim().length > 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function ensureHammerspoonBridgeReady(): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const health = await fetchWithTimeout(`${FLOWOS_HS_BASE_URL}/health`, { method: "GET" }, 2500);
      if (health.ok) {
        return true;
      }
    } catch {
      // Retry path below.
    }

    if (attempt === 0) {
      await execFileSafe("open", ["-a", "Hammerspoon"], 1200, true);
      await delay(900);
    }
  }
  return false;
}

async function moveDistractingAppsToDesktop2WithHammerspoon(): Promise<boolean> {
  if (!HAMMERSPOON_ENABLED) {
    return false;
  }

  if (!(await commandExists("pgrep"))) {
    return false;
  }
  const runningCheck = await execFileSafe("pgrep", ["-x", "Hammerspoon"], 1200, true);
  if (!runningCheck.ok) {
    console.log("[flow] hammerspoon app is not running; using hide fallback");
    return false;
  }

  const bridgeReady = await ensureHammerspoonBridgeReady();
  if (!bridgeReady) {
    console.log("[flow] hammerspoon bridge is not ready; using hide fallback");
    return false;
  }

  try {
    let response: Response | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await fetchWithTimeout(`${FLOWOS_HS_BASE_URL}/move_distractions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apps: DISTRACTION_APPS,
            titleTokens: DISTRACTION_TITLE_TOKENS,
            keepApps: FOCUS_KEEP_APPS,
            moveNonFocusFallback: true,
            helperPath: FLOWOS_HAMMERSPOON_HELPER_PATH
          })
        }, 6000);
        break;
      } catch (error) {
        if (attempt === 0) {
          await delay(500);
          continue;
        }
        throw error;
      }
    }

    if (!response) {
      return false;
    }

    if (!response.ok) {
      console.log("[flow] hammerspoon bridge returned non-200; using hide fallback");
      return false;
    }

    const parsed = (await response.json()) as {
      ok?: boolean;
      moved?: number;
      reason?: string;
      seenApps?: string[];
      seenTitles?: string[];
      bridgeVersion?: string;
    };
    if (parsed.ok && (parsed.moved ?? 0) > 0) {
      console.log(`[flow] moved ${parsed.moved} distraction window(s) using hammerspoon`);
      return true;
    }
    if (parsed.reason) {
      const seen = parsed.seenApps?.length ? `; seen apps: ${parsed.seenApps.join(", ")}` : "";
      const titles = parsed.seenTitles?.length
        ? `; seen titles: ${parsed.seenTitles.slice(0, 8).join(" | ")}`
        : "";
      const bridge = parsed.bridgeVersion ? `; bridge: ${parsed.bridgeVersion}` : "; bridge: unknown";
      console.log(`[flow] hammerspoon desktop move skipped: ${parsed.reason}${seen}${titles}${bridge}`);
    }
    return false;
  } catch (error) {
    console.log(
      `[flow] hammerspoon bridge unavailable (${error instanceof Error ? error.message : "unknown error"}); using hide fallback`
    );
    return false;
  }
}

async function restoreDistractionsFromDesktop2WithHammerspoon(): Promise<void> {
  if (!HAMMERSPOON_ENABLED) {
    return;
  }

  try {
    const response = await fetchWithTimeout(`${FLOWOS_HS_BASE_URL}/restore_last_move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    }, 4000);

    if (!response.ok) {
      console.log("[flow] hammerspoon restore returned non-200");
      return;
    }

    const parsed = (await response.json()) as {
      ok?: boolean;
      restored?: number;
      reason?: string;
    };

    if (parsed.ok) {
      console.log(`[flow] restored ${parsed.restored ?? 0} window(s) back to original desktop`);
    } else if (parsed.reason) {
      console.log(`[flow] hammerspoon restore skipped: ${parsed.reason}`);
    }
  } catch (error) {
    console.log(
      `[flow] hammerspoon restore unavailable (${error instanceof Error ? error.message : "unknown error"})`
    );
  }
}

export async function captureWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  const focusedApp = await getFocusedAppName();
  const trackedApps = await Promise.all(FOCUS_APPS.map(captureAppWindowState));
  return {
    focusedApp,
    trackedApps
  };
}

export async function enterFlowWorkspace(): Promise<void> {
  const workArea = screen.getPrimaryDisplay().workArea;
  const leftWidth = Math.floor(workArea.width * 0.55);
  const rightWidth = workArea.width - leftWidth;
  const topHeight = Math.floor(workArea.height * 0.55);
  const bottomHeight = workArea.height - topHeight;

  const layoutScript = [
    'tell application "System Events"',
    moveWindowSnippet("Code", workArea.x, workArea.y, leftWidth, workArea.height),
    moveWindowSnippet(
      "Google Chrome",
      workArea.x + leftWidth,
      workArea.y,
      rightWidth,
      topHeight
    ),
    moveWindowSnippet(
      "Terminal",
      workArea.x + leftWidth,
      workArea.y + topHeight,
      rightWidth,
      bottomHeight
    ),
    'if exists process "Code" then tell process "Code" to set frontmost to true',
    'if exists process "Google Chrome" then tell process "Google Chrome" to set frontmost to true',
    'if exists process "Terminal" then tell process "Terminal" to set frontmost to true',
    "end tell"
  ].join("\n");
  await runAppleScript(layoutScript);

  const movedToDesktop2 = await moveDistractingAppsToDesktop2WithHammerspoon();
  if (!movedToDesktop2) {
    await Promise.all(DISTRACTION_APPS.map((appName) => hideApp(appName)));
  }

  await ensureTopFocus();
}

export async function restoreWorkspace(snapshot?: WorkspaceSnapshot): Promise<void> {
  if (!snapshot) {
    await ensureTopFocus();
    return;
  }

  const restoreSnippets = snapshot.trackedApps
    .filter((appState) => appState.hasWindow)
    .map((appState) =>
      moveWindowSnippet(appState.appName, appState.x, appState.y, appState.width, appState.height)
    );
  if (restoreSnippets.length > 0) {
    const restoreScript = ['tell application "System Events"', ...restoreSnippets, "end tell"].join("\n");
    await runAppleScript(restoreScript);
  }

  if (snapshot.focusedApp) {
    await showApp(snapshot.focusedApp);
  }
}

export async function exitFlowWorkspace(snapshot?: WorkspaceSnapshot): Promise<void> {
  await restoreDistractionsFromDesktop2WithHammerspoon();
  await restoreWorkspace(snapshot);
}

export async function openFileInVsCode(filePath: string, line?: number): Promise<void> {
  if (line) {
    await execFileAsync("code", ["-r", "-g", `${filePath}:${line}`]);
    return;
  }
  await execFileAsync("code", ["-r", filePath]);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function runTerminalCommand(command: string): Promise<void> {
  const quoted = shellQuote(command);
  const script = [
    'tell application "Terminal"',
    "activate",
    "if not (exists front window) then do script \"\"",
    `do script ${quoted} in front window`,
    "end tell"
  ].join("\n");

  await runAppleScript(script);
}

export async function openTab(url: string): Promise<void> {
  await shell.openExternal(url);
}
