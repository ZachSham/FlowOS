export type FlowMode = "debugging" | "coding" | "research";

export interface ChromeTabContext {
  id?: number;
  title: string;
  url: string;
  active?: boolean;
  pinned?: boolean;
  windowId?: number;
  groupId?: number;
}

export interface ChromeContextPayload {
  activeTab?: {
    title: string;
    url: string;
  };
  tabs: ChromeTabContext[];
  capturedAt?: string;
}

export interface ObjectiveAnalysis {
  objective: string;
  mode: FlowMode;
  confidence: number;
  evidence: string[];
  suggestedFiles: string[];
  suggestedCommands: string[];
  suggestedTabs: string[];
}

export interface BrowserErrorPayload {
  message: string;
  source?: string;
  stack?: string;
  url?: string;
  capturedAt?: string;
}

export interface ChromeCommandEnterFlow {
  action: "ENTER_FLOW";
  objective: string;
  keywords: string[];
}

export interface ChromeCommandOpenTab {
  action: "OPEN_TAB";
  url: string;
}

export interface ChromeCommandExitFlow {
  action: "EXIT_FLOW";
}

export interface ChromeCommandLeaveSession {
  action: "LEAVE_SESSION";
}

export interface ChromeCommandNoop {
  action: "NOOP";
}

export type ChromeCommand =
  | ChromeCommandEnterFlow
  | ChromeCommandOpenTab
  | ChromeCommandExitFlow
  | ChromeCommandLeaveSession
  | ChromeCommandNoop;

export interface SavedFlowSession {
  id: string;
  objective: string;
  mode: FlowMode;
  confidence: number;
  startedAt: string;
  endedAt?: string;
  openFiles: string[];
  usefulTabs: string[];
  commandsRun: string[];
  lastError?: string;
}

export interface AppWindowState {
  appName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasWindow: boolean;
}

export interface WorkspaceSnapshot {
  focusedApp: string;
  trackedApps: AppWindowState[];
}

export interface FlowState {
  isInFlow: boolean;
  analysis: ObjectiveAnalysis;
  chromeContext: ChromeContextPayload;
  lastBrowserError?: BrowserErrorPayload;
  pendingChromeCommand: ChromeCommand;
  activeSession?: SavedFlowSession;
  preFlowWorkspace?: WorkspaceSnapshot;
  sessions: SavedFlowSession[];
}

export const defaultAnalysis: ObjectiveAnalysis = {
  objective: "General coding task",
  mode: "coding",
  confidence: 0.42,
  evidence: ["Collecting workspace signals"],
  suggestedFiles: [],
  suggestedCommands: ["npm run dev", "git diff"],
  suggestedTabs: ["http://localhost:3000"]
};

export const emptyChromeContext: ChromeContextPayload = {
  tabs: [],
  capturedAt: new Date(0).toISOString()
};
