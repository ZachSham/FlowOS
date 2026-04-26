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

export interface VsCodeSnapshot {
  app: "vscode";
  workspaceName?: string;
  activeFile?: string;
  openTabs: string[];
  diagnostics: Array<{
    file: string;
    severity: "error" | "warning" | "info";
    message: string;
  }>;
  recentCommands: string[];
  capturedAt: string;
}

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
      type: "vscode.snapshot";
      payload: VsCodeSnapshot;
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
      source: "vscode-extension",
      label: "Active file",
      value: "src/features/auth/callback.tsx",
      weight: 0.9
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

export * from "./native-protocol.js";
export * from "./native-snapshots.js";
export * from "./native-events.js";
export * from "./native-actions.js";
