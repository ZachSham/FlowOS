import {
  Menu,
  Notification,
  Tray,
  app,
  nativeImage,
  shell
} from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  captureWorkspaceSnapshot,
  enterFlowWorkspace,
  exitFlowWorkspace,
  openFileInVsCode,
  runTerminalCommand
} from "./actions.js";
import { analyzeObjective, collectLocalSignals } from "./detector.js";
import { createFlowApiServer } from "./server.js";
import { loadSessions, saveSessions } from "./sessionStore.js";
import {
  defaultAnalysis,
  emptyChromeContext,
  type BrowserErrorPayload,
  type ChromeCommand,
  type ChromeContextPayload,
  type FlowState,
  type SavedFlowSession
} from "./types.js";

const FLOW_SERVER_PORT = 4789;
const DISTRACTION_KEYWORDS = ["youtube", "gmail", "discord", "amazon", "reddit", "x.com"];

const NOOP_COMMAND: ChromeCommand = { action: "NOOP" };
const REPO_ROOT = join(process.cwd(), "..");
const HAMMERSPOON_SETUP_SCRIPT = join(REPO_ROOT, "scripts", "setup-hammerspoon.sh");

let tray: Tray | null = null;
let lastNotificationAt = 0;
let heartbeat: NodeJS.Timeout | null = null;

const sessionsPath = join(app.getPath("userData"), "sessions.json");
const loadedSessions = loadSessions(sessionsPath);

const state: FlowState = {
  isInFlow: false,
  analysis: defaultAnalysis,
  chromeContext: emptyChromeContext,
  pendingChromeCommand: NOOP_COMMAND,
  sessions: loadedSessions
};

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T | undefined
): Promise<T | undefined> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T | undefined>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

process.on("uncaughtException", (error) => {
  console.error("[flow] uncaughtException", error);
});

process.on("unhandledRejection", (error) => {
  console.error("[flow] unhandledRejection", error);
});

function appIcon(): Electron.NativeImage {
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAfElEQVR4AWP4z8DwnxEwYKS2trbhP4MphgkGBgaG/4R8QGJjY2Mz/GfABLFyMjIyfAciRn///g3E6MuXL4D4j4GBgYHxH8QYGRn5D4hPSEj4j8QfKMmNHz8e5GNgYGBgYAQiyMjI+P8fRikQwMxA8Q8SEhL+Q8QfJOUYGRkZGBj+AQDkpR7nryK5HgAAAABJRU5ErkJggg==";
  return nativeImage.createFromDataURL(`data:image/png;base64,${png}`);
}

function saveAllSessions(): void {
  saveSessions(sessionsPath, state.sessions);
}

function createSessionFromState(): SavedFlowSession {
  return {
    id: randomUUID(),
    objective: state.analysis.objective,
    mode: state.analysis.mode,
    confidence: state.analysis.confidence,
    startedAt: new Date().toISOString(),
    openFiles: [...state.analysis.suggestedFiles],
    usefulTabs: [...state.analysis.suggestedTabs],
    commandsRun: [],
    lastError: state.lastBrowserError?.message
  };
}

async function enterFlow(reason: string): Promise<void> {
  if (state.isInFlow) {
    return;
  }

  state.preFlowWorkspace = await withTimeout(captureWorkspaceSnapshot(), 1200, undefined);
  await withTimeout(enterFlowWorkspace(), 3000, undefined);
  state.isInFlow = true;
  state.activeSession = createSessionFromState();
  state.pendingChromeCommand = {
    action: "ENTER_FLOW",
    objective: state.analysis.objective,
    keywords: ["react", "auth", "login", "localhost", "stackoverflow", "docs"]
  };

  updateTrayMenu();
  console.log(`[flow] Entered flow state (${reason})`);
}

async function exitFlow(): Promise<void> {
  if (!state.isInFlow) {
    return;
  }

  await withTimeout(exitFlowWorkspace(state.preFlowWorkspace), 3000, undefined);
  state.isInFlow = false;
  state.pendingChromeCommand = { action: "LEAVE_SESSION" };
  state.preFlowWorkspace = undefined;

  if (state.activeSession) {
    state.activeSession.endedAt = new Date().toISOString();
    state.sessions = [state.activeSession, ...state.sessions].slice(0, 30);
    saveAllSessions();
    state.activeSession = undefined;
  }

  updateTrayMenu();
}

async function leaveSessionAndRestore(): Promise<void> {
  await exitFlow();
}

function pushCommandToSession(command: string): void {
  if (!state.activeSession) {
    return;
  }
  state.activeSession.commandsRun = [...state.activeSession.commandsRun, command].slice(-20);
}

function analyzeNow(): void {
  const signals = collectLocalSignals();
  state.analysis = analyzeObjective(state.chromeContext, signals);
  updateTrayMenu();

  const shouldNotify = !state.isInFlow && state.analysis.confidence >= 0.75;
  const now = Date.now();
  if (shouldNotify && now - lastNotificationAt > 180000) {
    lastNotificationAt = now;
    const notification = new Notification({
      title: "FlowOS suggestion",
      body: `${state.analysis.objective} (${Math.round(state.analysis.confidence * 100)}% confidence). Click to enter flow mode.`
    });
    notification.on("click", () => {
      void enterFlow("notification");
    });
    notification.show();
  }
}

function consumePendingChromeCommand(): ChromeCommand {
  const command = state.pendingChromeCommand;
  state.pendingChromeCommand = NOOP_COMMAND;
  return command;
}

function setChromeContext(payload: ChromeContextPayload): void {
  state.chromeContext = payload;

  if (state.isInFlow) {
    const active = payload.activeTab?.url ?? "";
    const lower = active.toLowerCase();
    if (DISTRACTION_KEYWORDS.some((token) => lower.includes(token))) {
      state.pendingChromeCommand = {
        action: "ENTER_FLOW",
        objective: state.analysis.objective,
        keywords: ["localhost", "react", "auth", "stack", "docs"]
      };

      new Notification({
        title: "FlowOS moved a distraction",
        body: "That tab looked unrelated to your active objective and was moved to Later."
      }).show();
    }
  }
}

function setBrowserError(payload: BrowserErrorPayload): void {
  state.lastBrowserError = payload;
  if (state.activeSession) {
    state.activeSession.lastError = payload.message;
  }

  new Notification({
    title: "FlowOS captured browser error",
    body: payload.message
  }).show();

  updateTrayMenu();
}

async function rejoinSession(sessionId: string): Promise<void> {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) {
    return;
  }

  state.analysis = {
    ...state.analysis,
    objective: session.objective,
    mode: session.mode,
    confidence: session.confidence,
    suggestedFiles: session.openFiles,
    suggestedCommands: ["npm run dev", "npm test -- auth", "git diff"],
    suggestedTabs: session.usefulTabs
  };

  await enterFlow("rejoin-session");

  for (const filePath of session.openFiles.slice(0, 2)) {
    await openFileInVsCode(filePath);
  }

  for (const tabUrl of session.usefulTabs.slice(0, 2)) {
    await shell.openExternal(tabUrl);
  }
}

function updateTrayMenu(): void {
  if (!tray) {
    return;
  }

  tray.setTitle(state.isInFlow ? "FlowOS • In Flow" : "FlowOS");

  const savedSessions = state.sessions.slice(0, 5);

  const sessionItems = savedSessions.length
    ? savedSessions.map((session) => ({
        label: `Rejoin: ${session.objective}`,
        click: () => {
          void rejoinSession(session.id);
        }
      }))
    : [{ label: "No saved sessions yet", enabled: false }];

  const suggestedFile = state.analysis.suggestedFiles[0];
  const suggestedCommand = state.analysis.suggestedCommands[0];
  const suggestedTab = state.analysis.suggestedTabs[0];

  const menu = Menu.buildFromTemplate([
    {
      label: `Objective: ${state.analysis.objective}`,
      enabled: false
    },
    {
      label: `Confidence: ${Math.round(state.analysis.confidence * 100)}%`,
      enabled: false
    },
    {
      label: state.isInFlow ? "Exit Flow Mode (Restore)" : "Enter Flow Mode",
      click: () => {
        void (state.isInFlow ? exitFlow() : enterFlow("menu"));
      }
    },
    {
      label: "Analyze Workspace",
      click: () => analyzeNow()
    },
    { type: "separator" },
    {
      label: suggestedFile ? `Open ${suggestedFile}` : "Open Suggested File",
      enabled: Boolean(suggestedFile),
      click: () => {
        if (suggestedFile) {
          void openFileInVsCode(suggestedFile);
        }
      }
    },
    {
      label: suggestedCommand ? `Run: ${suggestedCommand}` : "Run Suggested Command",
      enabled: Boolean(suggestedCommand),
      click: () => {
        if (suggestedCommand) {
          pushCommandToSession(suggestedCommand);
          void runTerminalCommand(suggestedCommand);
        }
      }
    },
    {
      label: suggestedTab ? `Open: ${suggestedTab}` : "Open Suggested Tab",
      enabled: Boolean(suggestedTab),
      click: () => {
        if (suggestedTab) {
          void shell.openExternal(suggestedTab);
        }
      }
    },
    { type: "separator" },
    {
      label: "Save Session",
      enabled: Boolean(state.activeSession),
      click: () => {
        if (!state.activeSession) {
          return;
        }

        state.sessions = [state.activeSession, ...state.sessions].slice(0, 30);
        saveAllSessions();
        updateTrayMenu();
      }
    },
    {
      label: "Rejoin Session",
      submenu: sessionItems
    },
    { type: "separator" },
    {
      label: "Run Guided Hammerspoon Setup",
      click: () => {
        void runTerminalCommand(`bash '${HAMMERSPOON_SETUP_SCRIPT}'`);
      }
    },
    {
      label: "Open Hammerspoon Docs",
      click: () => {
        void shell.openExternal("https://www.hammerspoon.org/docs/");
      }
    },
    { type: "separator" },
    {
      label: state.lastBrowserError
        ? `Last browser error: ${state.lastBrowserError.message}`
        : "No browser error captured",
      enabled: false
    },
    { type: "separator" },
    {
      label: "Quit FlowOS",
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);
}

function bootstrap(): void {
  if (process.platform === "darwin") {
    app.dock?.hide();
  }

  tray = new Tray(appIcon());
  tray.setToolTip("FlowOS");

  analyzeNow();
  updateTrayMenu();

  createFlowApiServer(FLOW_SERVER_PORT, {
    getState: () => state,
    setChromeContext,
    setBrowserError,
    setPendingChromeCommand: (command) => {
      state.pendingChromeCommand = command;
    },
    consumePendingChromeCommand,
    analyzeWorkspace: () => {
      analyzeNow();
      return state.analysis;
    },
    enterFlow: () => enterFlow("api"),
    exitFlow,
    leaveSession: leaveSessionAndRestore,
    saveCurrentSession: () => {
      if (!state.activeSession) {
        return undefined;
      }
      state.sessions = [state.activeSession, ...state.sessions].slice(0, 30);
      saveAllSessions();
      return state.activeSession;
    },
    openFile: openFileInVsCode,
    runCommand: async (command: string) => {
      pushCommandToSession(command);
      await runTerminalCommand(command);
    }
  });

  heartbeat = setInterval(() => {
    analyzeNow();
  }, 20000);
}

app.whenReady().then(() => {
  bootstrap();
});

app.on("before-quit", () => {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
});
