import type {
  ChromeCommand,
  ChromeCommandPayloadMap,
  ChromeCommandResultMap
} from "@flowos/shared";

type ChromeCommandExecutor = <C extends ChromeCommand>(
  command: C,
  payload: ChromeCommandPayloadMap[C]
) => Promise<ChromeCommandResultMap[C]>;

export class ChromeEditor {
  constructor(private readonly execute: ChromeCommandExecutor) {}

  focusTab(tabId: number) {
    return this.execute("chrome.tab.focus", { tabId });
  }

  groupTabs(input: ChromeCommandPayloadMap["chrome.tabs.group"]) {
    return this.execute("chrome.tabs.group", input);
  }

  ungroupTabs(tabIds: number[]) {
    return this.execute("chrome.tabs.ungroup", { tabIds });
  }

  pinTab(tabId: number, pinned: boolean) {
    return this.execute("chrome.tab.pin", { tabId, pinned });
  }

  closeTabs(tabIds: number[]) {
    return this.execute("chrome.tabs.close", { tabIds });
  }

  openTab(input: ChromeCommandPayloadMap["chrome.tab.open"]) {
    return this.execute("chrome.tab.open", input);
  }
}

export function createChromeEditor(executor: ChromeCommandExecutor) {
  return new ChromeEditor(executor);
}
