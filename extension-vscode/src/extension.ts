import * as vscode from "vscode";
import type { RealtimeMessage, VsCodeSnapshot } from "@flowos/shared";
import WebSocket, { type RawData } from "ws";

let socket: WebSocket | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let clientId = "";
let currentContext: vscode.ExtensionContext | null = null;
type DiagnosticSeverity = VsCodeSnapshot["diagnostics"][number]["severity"];

export function activate(context: vscode.ExtensionContext) {
  currentContext = context;
  void connect(context);
  const command = vscode.commands.registerCommand("flowos.pushSnapshot", async () => {
    await pushSnapshot();
  });

  const activeEditorWatcher = vscode.window.onDidChangeActiveTextEditor(() => {
    void pushSnapshot();
  });
  const diagnosticsWatcher = vscode.languages.onDidChangeDiagnostics(() => {
    void pushSnapshot();
  });
  const tabsWatcher = vscode.window.tabGroups.onDidChangeTabs(() => {
    void pushSnapshot();
  });

  context.subscriptions.push(command, activeEditorWatcher, diagnosticsWatcher, tabsWatcher);
}

export function deactivate() {
  stopHeartbeat();
  socket?.close();
}

async function connect(context: vscode.ExtensionContext) {
  clientId = await getOrCreateClientId(context);
  socket = new WebSocket("ws://127.0.0.1:7331");

  socket.on("open", () => {
    const token = readTokenFromSettings();
    const handshake: RealtimeMessage = {
      type: "extension.handshake",
      source: "vscode-extension",
      version: context.extension.packageJSON.version,
      clientId,
      token,
      sentAt: new Date().toISOString()
    };

    socket?.send(JSON.stringify(handshake));
  });

  socket.on("message", (raw) => {
    handleMessage(raw);
  });

  socket.on("close", () => {
    stopHeartbeat();
    setTimeout(() => {
      if (currentContext) {
        void connect(currentContext);
      }
    }, 2000);
  });
}

async function pushSnapshot() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const activeEditor = vscode.window.activeTextEditor;
  const diagnostics = vscode.languages
    .getDiagnostics()
    .slice(0, 20)
    .flatMap(([uri, items]) =>
      items.slice(0, 5).map((item) => {
        const severity: DiagnosticSeverity =
          item.severity === vscode.DiagnosticSeverity.Error
            ? "error"
            : item.severity === vscode.DiagnosticSeverity.Warning
              ? "warning"
              : "info";

        return {
          file: uri.fsPath,
          severity,
          message: item.message
        };
      })
    );

  const snapshot: VsCodeSnapshot = {
    app: "vscode",
    workspaceName: vscode.workspace.workspaceFolders?.[0]?.name,
    activeFile: activeEditor?.document.uri.fsPath,
    openTabs: vscode.window.tabGroups.all.flatMap((group) =>
      group.tabs
        .map((tab) => {
          if (tab.input instanceof vscode.TabInputText) {
            return tab.input.uri.fsPath;
          }

          return undefined;
        })
        .filter((value): value is string => Boolean(value))
    ),
    diagnostics,
    recentCommands: [],
    capturedAt: new Date().toISOString()
  };

  const message: RealtimeMessage = {
    type: "vscode.snapshot",
    payload: snapshot
  };

  socket.send(JSON.stringify(message));
}

function handleMessage(raw: RawData) {
  try {
    const message = JSON.parse(String(raw)) as RealtimeMessage;
    if (message.type === "extension.handshake.ack") {
      startHeartbeat(message.heartbeatIntervalMs);
      void pushSnapshot();
    }
  } catch (error) {
    console.error("[flowos][vscode] failed to process message", error);
  }
}

function startHeartbeat(intervalMs: number) {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const heartbeat: RealtimeMessage = {
      type: "extension.heartbeat",
      source: "vscode-extension",
      clientId,
      sentAt: new Date().toISOString()
    };
    socket.send(JSON.stringify(heartbeat));
  }, intervalMs);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

async function getOrCreateClientId(context: vscode.ExtensionContext) {
  const existing = context.globalState.get<string>("flowosClientId");
  if (existing) {
    return existing;
  }

  const next = `vscode_${crypto.randomUUID()}`;
  await context.globalState.update("flowosClientId", next);
  return next;
}

function readTokenFromSettings() {
  const configuration = vscode.workspace.getConfiguration("flowos");
  return configuration.get<string>("token", "");
}
