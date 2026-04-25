import * as vscode from "vscode";
import type { RealtimeMessage, VsCodeSnapshot } from "@flowos/shared";
import WebSocket from "ws";

let socket: WebSocket | null = null;
type DiagnosticSeverity = VsCodeSnapshot["diagnostics"][number]["severity"];

export function activate(context: vscode.ExtensionContext) {
  socket = new WebSocket("ws://127.0.0.1:7331");

  socket.on("open", () => {
    const handshake: RealtimeMessage = {
      type: "extension.handshake",
      source: "vscode-extension",
      version: context.extension.packageJSON.version
    };

    socket?.send(JSON.stringify(handshake));
    void pushSnapshot();
  });

  const command = vscode.commands.registerCommand("flowos.pushSnapshot", async () => {
    await pushSnapshot();
  });

  context.subscriptions.push(command);
}

export function deactivate() {
  socket?.close();
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
