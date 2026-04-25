interface ChromeTabContext {
  id?: number;
  title: string;
  url: string;
  active?: boolean;
  pinned?: boolean;
  windowId?: number;
  groupId?: number;
}

interface EnterFlowCommand {
  action: "ENTER_FLOW";
  objective: string;
  keywords: string[];
}

interface OpenTabCommand {
  action: "OPEN_TAB";
  url: string;
}

interface ExitFlowCommand {
  action: "EXIT_FLOW";
}

interface LeaveSessionCommand {
  action: "LEAVE_SESSION";
}

interface NoopCommand {
  action: "NOOP";
}

type FlowCommand =
  | EnterFlowCommand
  | OpenTabCommand
  | ExitFlowCommand
  | LeaveSessionCommand
  | NoopCommand;

const API_BASE = "http://127.0.0.1:4789";
const POLL_INTERVAL_MS = 1000;
const CONTEXT_INTERVAL_MS = 2000;
const DISTRACTION_KEYWORDS = ["youtube", "gmail", "discord", "amazon", "netflix", "x.com", "reddit"];

let flowGroupId: number | null = null;
let laterGroupId: number | null = null;
let flowActive = false;
let currentObjective = "";

interface PreFlowSnapshot {
  activeTabId?: number;
  tabs: Array<{
    id: number;
    pinned: boolean;
  }>;
}

const PREFLOW_SNAPSHOT_KEY = "flowos.preFlowSnapshot";

function log(...args: unknown[]): void {
  console.log("[flowos-extension]", ...args);
}

function isUsefulTab(tab: ChromeTabContext, keywords: string[]): boolean {
  const text = `${tab.title} ${tab.url}`.toLowerCase();
  const keyHit = keywords.some((keyword) => text.includes(keyword.toLowerCase()));
  const essentialHit = ["localhost", "react.dev", "stack", "github"].some((token) => text.includes(token));
  return keyHit || essentialHit;
}

async function collectContext(): Promise<{ activeTab?: ChromeTabContext; tabs: ChromeTabContext[] }> {
  const tabs = await chrome.tabs.query({});
  const formatted = tabs.map((tab) => ({
    id: tab.id,
    title: tab.title ?? "Untitled tab",
    url: tab.url ?? "",
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    windowId: tab.windowId,
    groupId: tab.groupId
  }));

  return {
    activeTab: formatted.find((tab) => tab.active),
    tabs: formatted
  };
}

async function postChromeContext(): Promise<void> {
  try {
    const payload = await collectContext();
    await fetch(`${API_BASE}/chrome/context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, capturedAt: new Date().toISOString() })
    });
  } catch (error) {
    log("Context push failed", error);
  }
}

async function moveTabsToGroup(tabIds: number[], title: string, collapse: boolean): Promise<number | null> {
  if (tabIds.length === 0) {
    return null;
  }

  try {
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, { title, collapsed: collapse });
    return groupId;
  } catch (error) {
    log("Tab grouping failed", error);
    return null;
  }
}

async function applyEnterFlow(command: EnterFlowCommand): Promise<void> {
  flowActive = true;
  currentObjective = command.objective;

  const context = await collectContext();
  const snapshot: PreFlowSnapshot = {
    activeTabId: context.activeTab?.id,
    tabs: context.tabs
      .filter((tab): tab is ChromeTabContext & { id: number } => typeof tab.id === "number")
      .map((tab) => ({ id: tab.id, pinned: Boolean(tab.pinned) }))
  };
  await chrome.storage.local.set({ [PREFLOW_SNAPSHOT_KEY]: snapshot });

  const useful = context.tabs.filter((tab) => isUsefulTab(tab, command.keywords));
  const later = context.tabs.filter((tab) => !isUsefulTab(tab, command.keywords));

  const usefulIds = useful.map((tab) => tab.id).filter((id): id is number => typeof id === "number");
  const laterIds = later.map((tab) => tab.id).filter((id): id is number => typeof id === "number");

  flowGroupId = await moveTabsToGroup(usefulIds, "Flow", false);
  laterGroupId = await moveTabsToGroup(laterIds, "Later", true);

  const important = useful.find((tab) => tab.url.includes("localhost") || tab.url.includes("react.dev"));
  if (important?.id !== undefined) {
    await chrome.tabs.update(important.id, { active: true, pinned: true });
  }

  await fetch(`${API_BASE}/chrome/result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "ENTER_FLOW_APPLIED",
      payload: {
        objective: command.objective,
        flowTabs: useful.length,
        laterTabs: later.length
      }
    })
  });
}

async function applyExitFlow(): Promise<void> {
  flowActive = false;
  currentObjective = "";
  await restoreTabsFromSnapshot();
  flowGroupId = null;
  laterGroupId = null;
}

async function restoreTabsFromSnapshot(): Promise<void> {
  const storage = await chrome.storage.local.get(PREFLOW_SNAPSHOT_KEY);
  const snapshot = storage[PREFLOW_SNAPSHOT_KEY] as PreFlowSnapshot | undefined;
  if (!snapshot) {
    return;
  }

  const liveTabs = await chrome.tabs.query({});
  const liveTabIds = liveTabs
    .map((tab) => tab.id)
    .filter((id): id is number => typeof id === "number");

  if (liveTabIds.length > 0) {
    try {
      await chrome.tabs.ungroup(liveTabIds);
    } catch {
      // Best effort.
    }
  }

  const pinnedById = new Map(snapshot.tabs.map((tab) => [tab.id, tab.pinned]));
  for (const tab of liveTabs) {
    if (typeof tab.id !== "number") {
      continue;
    }
    const pinned = pinnedById.get(tab.id);
    if (typeof pinned === "boolean" && tab.pinned !== pinned) {
      await chrome.tabs.update(tab.id, { pinned });
    }
  }

  if (typeof snapshot.activeTabId === "number") {
    try {
      await chrome.tabs.update(snapshot.activeTabId, { active: true });
    } catch {
      // Best effort.
    }
  }

  await chrome.storage.local.remove(PREFLOW_SNAPSHOT_KEY);
}

async function applyLeaveSession(): Promise<void> {
  await applyExitFlow();
}

async function applyOpenTab(command: OpenTabCommand): Promise<void> {
  await chrome.tabs.create({ url: command.url, active: true });
}

async function pollCommand(): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/chrome/command`);
    if (!response.ok) {
      return;
    }

    const command = (await response.json()) as FlowCommand;

    if (command.action === "NOOP") {
      return;
    }

    if (command.action === "ENTER_FLOW") {
      await applyEnterFlow(command);
      return;
    }

    if (command.action === "EXIT_FLOW") {
      await applyExitFlow();
      return;
    }

    if (command.action === "LEAVE_SESSION") {
      await applyLeaveSession();
      return;
    }

    if (command.action === "OPEN_TAB") {
      await applyOpenTab(command);
    }
  } catch (error) {
    log("Command poll failed", error);
  }
}

async function moveDistractingTabToLater(tabId: number): Promise<void> {
  if (!flowActive) {
    return;
  }

  const tab = await chrome.tabs.get(tabId);
  const text = `${tab.title ?? ""} ${tab.url ?? ""}`.toLowerCase();
  const isDistracting = DISTRACTION_KEYWORDS.some((token) => text.includes(token));

  if (!isDistracting) {
    return;
  }

  const groupId = await chrome.tabs.group({ tabIds: [tabId], groupId: laterGroupId ?? undefined });
  laterGroupId = groupId;
  await chrome.tabGroups.update(groupId, { title: "Later", collapsed: true });

  await fetch(`${API_BASE}/chrome/result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "DISTRACTION_MOVED_TO_LATER",
      payload: {
        objective: currentObjective,
        tabTitle: tab.title,
        tabUrl: tab.url
      }
    })
  });
}

chrome.runtime.onMessage.addListener((message: { type?: string; payload?: unknown }) => {
  if (message.type !== "FLOWOS_PAGE_ERROR") {
    return;
  }

  void fetch(`${API_BASE}/chrome/error`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message.payload)
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id !== undefined) {
    void moveDistractingTabToLater(tab.id);
  }
  void postChromeContext();
});

chrome.tabs.onUpdated.addListener((tabId) => {
  void moveDistractingTabToLater(tabId);
  void postChromeContext();
});

chrome.tabs.onActivated.addListener(() => {
  void postChromeContext();
});

chrome.runtime.onInstalled.addListener(() => {
  log("Installed");
});

setInterval(() => {
  void postChromeContext();
}, CONTEXT_INTERVAL_MS);

setInterval(() => {
  void pollCommand();
}, POLL_INTERVAL_MS);

void postChromeContext();
void pollCommand();
