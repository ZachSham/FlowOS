export type FlowMode =
  | "coding"
  | "debugging"
  | "design"
  | "writing"
  | "researching"
  | "meeting"
  | "study";

export type SignalSource =
  | "system"
  | "chrome-extension"
  | "vscode-extension"
  | "electron"
  | "swift-helper"
  | "user";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NativeWindowPosition {
  x: number;
  y: number;
}

export interface NativeWindowSize {
  width: number;
  height: number;
}

export interface NativeWindowFrame extends NativeWindowPosition, NativeWindowSize {}

export interface NativeWindowSetFrameAction {
  type: "native.window.setFrame";
  windowId: string;
  frame: NativeWindowFrame;
}

export interface NativeWindowMoveAction {
  type: "native.window.move";
  windowId: string;
  position: NativeWindowPosition;
}

export interface NativeWindowResizeAction {
  type: "native.window.resize";
  windowId: string;
  size: NativeWindowSize;
}

export interface NativeWindowRaiseAction {
  type: "native.window.raise";
  windowId: string;
}

export interface NativeAppActivateAction {
  type: "native.app.activate";
  bundleId: string;
}

export type NativeAction =
  | NativeWindowSetFrameAction
  | NativeWindowMoveAction
  | NativeWindowResizeAction
  | NativeWindowRaiseAction
  | NativeAppActivateAction;

export interface WindowConfig {
  id: string;
  appName: string;
  titlePattern?: string;
  bounds: WindowBounds;
  displayId?: string;
  spaceId?: string;
  action: "focus" | "move" | "resize" | "minimize" | "hide" | "show";
}

export interface SessionLayout {
  id: string;
  name: string;
  mode: FlowMode;
  learned: boolean;
  windows: WindowConfig[];
  notes?: string;
}

export interface TaskSignal {
  source: SignalSource;
  label: string;
  value: string;
  weight: number;
}

export interface TaskState {
  id: string;
  title: string;
  mode: FlowMode;
  substate: string;
  confidence: number;
  updatedAt: string;
  signals: TaskSignal[];
}

export type SuggestionKind = "file" | "command" | "tab";

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  title: string;
  description: string;
  payload: string;
  confidence: number;
  source: "heuristic" | "model" | "user-memory";
}

export interface ChromeTabSnapshot {
  id: number;
  title: string;
  url: string;
  active: boolean;
  pinned: boolean;
  windowId: number;
  index: number;
  highlighted: boolean;
  groupId: number | null;
  openerTabId: number | null;
  status: "loading" | "complete" | "unloaded" | "unknown";
  audible: boolean;
  muted: boolean;
  discarded: boolean;
  autoDiscardable: boolean;
  incognito: boolean;
  favIconUrl: string;
  lastAccessed: number | null;
}

export interface ChromeSnapshot {
  app: "chrome";
  tabs: ChromeTabSnapshot[];
  capturedAt: string;
}

export type ChromeTabGroupColor =
  | "grey"
  | "blue"
  | "red"
  | "yellow"
  | "green"
  | "pink"
  | "purple"
  | "cyan"
  | "orange";

export interface ChromeCommandPayloadMap {
  "chrome.tab.focus": {
    tabId: number;
  };
  "chrome.tabs.group": {
    tabIds: number[];
    title?: string;
    color?: ChromeTabGroupColor;
    windowId?: number;
  };
  "chrome.tabs.ungroup": {
    tabIds: number[];
  };
  "chrome.tab.pin": {
    tabId: number;
    pinned: boolean;
  };
  "chrome.tabs.close": {
    tabIds: number[];
  };
  "chrome.tab.open": {
    url: string;
    active?: boolean;
    pinned?: boolean;
    windowId?: number;
  };
}

export interface ChromeCommandResultMap {
  "chrome.tab.focus": {
    focusedTabId: number;
    windowId: number;
  };
  "chrome.tabs.group": {
    groupId: number;
    tabIds: number[];
  };
  "chrome.tabs.ungroup": {
    tabIds: number[];
  };
  "chrome.tab.pin": {
    tabId: number;
    pinned: boolean;
  };
  "chrome.tabs.close": {
    closedTabIds: number[];
  };
  "chrome.tab.open": {
    tabId: number;
    windowId: number;
    url: string;
  };
}

export type ChromeCommand = keyof ChromeCommandPayloadMap;

export interface ChromeCommandRequest<C extends ChromeCommand = ChromeCommand> {
  requestId: string;
  command: C;
  payload: ChromeCommandPayloadMap[C];
  issuedAt: string;
}

export interface ChromeCommandSuccessResult<C extends ChromeCommand = ChromeCommand> {
  requestId: string;
  command: C;
  ok: true;
  result: ChromeCommandResultMap[C];
  completedAt: string;
}

export interface ChromeCommandFailureResult<C extends ChromeCommand = ChromeCommand> {
  requestId: string;
  command: C;
  ok: false;
  error: {
    code: string;
    message: string;
  };
  completedAt: string;
}

export type ChromeCommandResult<C extends ChromeCommand = ChromeCommand> =
  | ChromeCommandSuccessResult<C>
  | ChromeCommandFailureResult<C>;

// ─── VS Code types ────────────────────────────────────────────────────────────

export interface VscodeDiagnostic {
  file: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
}

export interface VscodeGitStatus {
  branch: string;
  ahead: number;
  behind: number;
  modified: string[];
  staged: string[];
  untracked: string[];
}

export interface VscodeEditorGroup {
  index: number;
  activeFile: string | null;
  openFiles: string[];
}

export interface VscodeTerminal {
  name: string;
  processId: number | null;
}

export interface VscodeSnapshot {
  app: "vscode";
  workspaceName: string | null;
  workspaceRoot: string | null;
  activeFile: string | null;
  activeLanguageId: string | null;
  activeLine: number | null;
  activeColumn: number | null;
  selectedText: string | null;
  editorGroups: VscodeEditorGroup[];
  openTabs: string[];
  diagnostics: VscodeDiagnostic[];
  git: VscodeGitStatus | null;
  terminals: VscodeTerminal[];
  capturedAt: string;
}

export type VscodeCommand =
  | "vscode.file.open"
  | "vscode.text.search"
  | "vscode.terminal.run"
  | "vscode.command.execute"
  | "vscode.editor.split"
  | "vscode.panel.focus"
  | "vscode.symbol.search";

export interface VscodeCommandPayloadMap {
  "vscode.file.open": {
    path: string;
    line?: number;
    column?: number;
    preview?: boolean;
  };
  "vscode.text.search": {
    query: string;
    caseSensitive?: boolean;
    includePattern?: string;
    excludePattern?: string;
  };
  "vscode.terminal.run": {
    command: string;
    terminalName?: string;
    cwd?: string;
  };
  "vscode.command.execute": {
    commandId: string;
    args?: unknown[];
  };
  "vscode.editor.split": {
    direction: "right" | "down";
  };
  "vscode.panel.focus": {
    panel: "terminal" | "problems" | "output" | "explorer" | "source-control";
  };
  "vscode.symbol.search": {
    query: string;
  };
}

export interface VscodeCommandResultMap {
  "vscode.file.open": { opened: string; line?: number };
  "vscode.text.search": { matches: Array<{ file: string; line: number; preview: string }> };
  "vscode.terminal.run": { terminalName: string; sent: string };
  "vscode.command.execute": { commandId: string; executed: true };
  "vscode.editor.split": { direction: string };
  "vscode.panel.focus": { panel: string };
  "vscode.symbol.search": { symbols: Array<{ name: string; file: string; line: number; kind: string }> };
}

export interface VscodeCommandRequest<C extends VscodeCommand = VscodeCommand> {
  requestId: string;
  command: C;
  payload: VscodeCommandPayloadMap[C];
  issuedAt: string;
}

export interface VscodeCommandSuccessResult<C extends VscodeCommand = VscodeCommand> {
  requestId: string;
  command: C;
  ok: true;
  result: VscodeCommandResultMap[C];
  completedAt: string;
}

export interface VscodeCommandFailureResult<C extends VscodeCommand = VscodeCommand> {
  requestId: string;
  command: C;
  ok: false;
  error: { code: string; message: string };
  completedAt: string;
}

export type VscodeCommandResult<C extends VscodeCommand = VscodeCommand> =
  | VscodeCommandSuccessResult<C>
  | VscodeCommandFailureResult<C>;

// ─── Realtime messages ────────────────────────────────────────────────────────

export type RealtimeMessage =
  | {
      type: "extension.handshake";
      source: SignalSource;
      version: string;
      clientId?: string;
      token?: string;
      sentAt?: string;
    }
  | {
      type: "extension.handshake.ack";
      clientId: string;
      serverTime: string;
      source: SignalSource;
      heartbeatIntervalMs: number;
      authRequired: boolean;
    }
  | {
      type: "extension.heartbeat";
      clientId?: string;
      source: SignalSource;
      sentAt: string;
    }
  | {
      type: "extension.heartbeat.ack";
      clientId: string;
      serverTime: string;
      source: SignalSource;
    }
  | {
      type: "chrome.snapshot";
      payload: ChromeSnapshot;
    }
  | {
      type: "task-state.updated";
      payload: TaskState;
    }
  | {
      type: "suggestions.updated";
      payload: Suggestion[];
    }
  | {
      type: "chrome.command.request";
      payload: ChromeCommandRequest;
    }
  | {
      type: "chrome.command.result";
      payload: ChromeCommandResult;
    }
  | {
      type: "vscode.snapshot";
      payload: VscodeSnapshot;
    }
  | {
      type: "vscode.command.request";
      payload: VscodeCommandRequest;
    }
  | {
      type: "vscode.command.result";
      payload: VscodeCommandResult;
    };

export const demoTaskState: TaskState = {
  id: "task-debug-react-auth",
  title: "Debugging auth redirect loop",
  mode: "debugging",
  substate: "Investigating localhost callback flow",
  confidence: 0.78,
  updatedAt: new Date("2026-04-25T17:00:00.000Z").toISOString(),
  signals: [
    {
      source: "chrome-extension",
      label: "Active tab",
      value: "Auth flow docs",
      weight: 0.72
    },
    {
      source: "system",
      label: "Foreground app",
      value: "Google Chrome",
      weight: 0.52
    }
  ]
};

export const demoSuggestions: Suggestion[] = [
  {
    id: "file-auth-callback",
    kind: "file",
    title: "Open auth callback handler",
    description: "Likely next edit based on recent errors and active task.",
    payload: "src/features/auth/callback.tsx",
    confidence: 0.89,
    source: "model"
  },
  {
    id: "command-run-tests",
    kind: "command",
    title: "Run auth integration tests",
    description: "Validate redirect and token persistence before another edit.",
    payload: "npm run test -- auth",
    confidence: 0.82,
    source: "heuristic"
  },
  {
    id: "tab-open-docs",
    kind: "tab",
    title: "Open OAuth callback docs",
    description: "Supporting reference inferred from task state.",
    payload: "https://example.com/oauth-callback-docs",
    confidence: 0.61,
    source: "model"
  }
];

export * from "./native-actions.js";
export * from "./native-events.js";
export * from "./native-protocol.js";
export * from "./native-snapshots.js";
