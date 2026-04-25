import * as vscode from "vscode";
import type { VsCodeSnapshot } from "@flowos/shared";
import type { ExtendedSnapshot } from "./types.js";

export function buildSnapshot(): ExtendedSnapshot {
  const editor = vscode.window.activeTextEditor;
  const activeFile = editor?.document.uri.fsPath;
  const selectedText =
    editor === undefined || editor.selection.isEmpty
      ? undefined
      : editor.document.getText(editor.selection);

  const openTabs = vscode.window.visibleTextEditors
    .map((e) => e.document.uri.fsPath)
    .filter(
      (p) =>
        !p.startsWith("output:") && !p.startsWith("extension-output:")
    );

  const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map(
    (f) => f.uri.fsPath
  );

  const allDiagnostics = vscode.languages.getDiagnostics();
  const diagnostics: VsCodeSnapshot["diagnostics"] = [];
  for (const [uri, diags] of allDiagnostics) {
    for (const d of diags) {
      if (d.severity > vscode.DiagnosticSeverity.Warning) continue;
      diagnostics.push({
        file: uri.fsPath,
        severity:
          d.severity === vscode.DiagnosticSeverity.Error
            ? "error"
            : d.severity === vscode.DiagnosticSeverity.Warning
            ? "warning"
            : "info",
        message: d.message,
      });
    }
  }

  return {
    app: "vscode",
    workspaceName: vscode.workspace.name,
    workspaceFolders,
    activeFile,
    openTabs,
    selectedText,
    diagnostics,
    gitBranch: undefined,
    gitChangedFiles: [],
    recentCommands: [],
    capturedAt: new Date().toISOString(),
  };
}

export function toSharedSnapshot(s: ExtendedSnapshot): VsCodeSnapshot {
  return {
    app: "vscode",
    workspaceName: s.workspaceName,
    activeFile: s.activeFile,
    openTabs: s.openTabs,
    diagnostics: s.diagnostics,
    recentCommands: s.recentCommands,
    capturedAt: s.capturedAt,
  };
}
