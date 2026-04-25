import * as vscode from "vscode";
import { WsClient } from "./wsClient.js";
import { buildSnapshot, toSharedSnapshot } from "./snapshot.js";
import { getGitContext } from "./git.js";
import { buildContextPack } from "./contextPack.js";
import type { FlowState, IncomingCommand } from "./types.js";

const DEBOUNCE_MS = 300;
const MAX_RECENT_EDITS = 10;
const VERSION = "0.1.0";

let client: WsClient | undefined;
let statusBar: vscode.StatusBarItem | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

const flowState: FlowState = {
  recentEdits: [],
  focusedFile: undefined,
};

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(ctx: vscode.ExtensionContext): void {
  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBar.text = "$(circle-slash) FlowOS";
  statusBar.show();
  ctx.subscriptions.push(statusBar);

  const cfg = vscode.workspace.getConfiguration("flowos");
  const host = cfg.get<string>("wsHost", "localhost");
  const port = cfg.get<number>("wsPort", 7331);
  const url = `ws://${host}:${port}`;

  client = new WsClient(url, handleIncoming, (msg) => console.log(msg));
  client.connect();

  // Queued immediately — flushed once socket opens
  client.send({
    type: "extension.handshake",
    source: "vscode-extension",
    version: VERSION,
  });

  registerEvents(ctx);
  registerCommands(ctx);
}

export function deactivate(): void {
  client?.destroy();
  client = undefined;
}

// ─── Event Engine ────────────────────────────────────────────────────────────

function registerEvents(ctx: vscode.ExtensionContext): void {
  const schedule = (): void => scheduleSnapshot();

  ctx.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) trackRecentEdit(editor.document.uri.fsPath);
      schedule();
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => schedule()),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!e.document.isUntitled) trackRecentEdit(e.document.uri.fsPath);
      schedule();
    }),
    vscode.workspace.onDidSaveTextDocument(() => schedule()),
    vscode.languages.onDidChangeDiagnostics(() => schedule())
  );
}

function scheduleSnapshot(): void {
  if (debounceTimer !== undefined) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    void sendSnapshot();
  }, DEBOUNCE_MS);
}

async function sendSnapshot(): Promise<void> {
  const snapshot = buildSnapshot();
  const git = await getGitContext();
  snapshot.gitBranch = git.branch;
  snapshot.gitChangedFiles = git.changedFiles;
  snapshot.recentCommands = flowState.recentEdits.slice(0, 5);

  const errorFiles = new Set(
    snapshot.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => d.file)
  );
  // focusedFile = most recently edited file that isn't error-noise
  flowState.focusedFile =
    flowState.recentEdits.find((f) => !errorFiles.has(f)) ??
    flowState.recentEdits[0];

  client?.send({ type: "vscode.snapshot", payload: toSharedSnapshot(snapshot) });
  setStatus("connected");
}

// ─── Flow-State Tracking ─────────────────────────────────────────────────────

function trackRecentEdit(filePath: string): void {
  flowState.recentEdits = [
    filePath,
    ...flowState.recentEdits.filter((f) => f !== filePath),
  ].slice(0, MAX_RECENT_EDITS);
}

// ─── Command Listener (Electron → VS Code) ───────────────────────────────────

function handleIncoming(raw: unknown): void {
  const msg = raw as IncomingCommand;
  if (!msg?.type) return;

  switch (msg.type) {
    case "vscode.openFile": {
      const path = msg.payload?.path;
      if (path) void vscode.window.showTextDocument(vscode.Uri.file(path));
      break;
    }
    case "vscode.runCommand": {
      const command = msg.payload?.command;
      const args = msg.payload?.args ?? [];
      if (command) void vscode.commands.executeCommand(command, ...args);
      break;
    }
    case "vscode.focusTerminal": {
      void vscode.commands.executeCommand("workbench.action.terminal.focus");
      break;
    }
    case "flowos.ping": {
      client?.send({ type: "flowos.pong" });
      break;
    }
    default:
      break;
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────

function registerCommands(ctx: vscode.ExtensionContext): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand(
      "flowos.generateContextPack",
      async () => {
        const pack = await buildContextPack(flowState);
        client?.send({ type: "vscode.contextPack", payload: pack });
        void vscode.window.showInformationMessage("FlowOS: Context pack sent.");
      }
    ),
    vscode.commands.registerCommand("flowos.enterCodingMode", () => {
      void sendSnapshot();
    }),
    vscode.commands.registerCommand(
      "flowos.openProjectAndEnterCodingMode",
      async () => {
        const uris = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          openLabel: "Open Project",
        });
        if (uris?.[0]) {
          await vscode.commands.executeCommand("vscode.openFolder", uris[0]);
        }
      }
    )
  );
}

// ─── Status Bar ──────────────────────────────────────────────────────────────

function setStatus(state: "connected" | "disconnected" | "retrying"): void {
  if (!statusBar) return;
  const icons: Record<typeof state, string> = {
    connected: "$(broadcast)",
    disconnected: "$(circle-slash)",
    retrying: "$(sync~spin)",
  };
  statusBar.text = `${icons[state]} FlowOS`;
}
