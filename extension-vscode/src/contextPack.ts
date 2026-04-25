import * as vscode from "vscode";
import type { ContextPackPayload, FlowState } from "./types.js";
import { buildSnapshot } from "./snapshot.js";
import { getGitContext } from "./git.js";

export async function buildContextPack(
  flowState: FlowState
): Promise<ContextPackPayload> {
  const snapshot = buildSnapshot();
  const git = await getGitContext();

  const editor = vscode.window.activeTextEditor;
  let activeFileContents: string | undefined;
  if (editor !== undefined && !editor.document.isUntitled) {
    activeFileContents = editor.document.getText();
  }

  return {
    activeFile: snapshot.activeFile,
    activeFileContents,
    selectedText: snapshot.selectedText,
    openTabs: snapshot.openTabs,
    diagnostics: snapshot.diagnostics,
    gitBranch: git.branch,
    gitChangedFiles: git.changedFiles,
    recentEdits: flowState.recentEdits,
    capturedAt: snapshot.capturedAt,
  };
}
