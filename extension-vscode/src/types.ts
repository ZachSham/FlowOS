import type { VsCodeSnapshot } from "@flowos/shared";

// Extends shared VsCodeSnapshot with richer fields for internal use only.
// When sending over WebSocket, strip to VsCodeSnapshot shape.
export interface ExtendedSnapshot extends VsCodeSnapshot {
  selectedText?: string;
  workspaceFolders: string[];
  gitBranch?: string;
  gitChangedFiles: string[];
}

export interface ContextPackPayload {
  activeFile?: string;
  activeFileContents?: string;
  selectedText?: string;
  openTabs: string[];
  diagnostics: VsCodeSnapshot["diagnostics"];
  gitBranch?: string;
  gitChangedFiles: string[];
  recentEdits: string[];
  capturedAt: string;
}

export interface IncomingCommand {
  type: string;
  payload?: {
    path?: string;
    command?: string;
    args?: string[];
  };
}

// Tracks "flow state" — which files the user is actively focused on
export interface FlowState {
  recentEdits: string[]; // last 10 edited files, most recent first
  focusedFile: string | undefined;
}
