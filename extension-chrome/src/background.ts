import type {
  ChromeCommandPayloadMap,
  ChromeCommandRequest,
  ChromeCommandResult,
  ChromeSnapshot,
  RealtimeMessage
} from "@flowos/shared";

const websocketUrl = "ws://127.0.0.1:7331";
let socket: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let clientId = "";
let extensionToken = "";

async function connect() {
  clientId = await getOrCreateClientId();
  extensionToken = await getExtensionToken();
  socket = new WebSocket(websocketUrl);

  socket.addEventListener("open", () => {
    const handshake: RealtimeMessage = {
      type: "extension.handshake",
      source: "chrome-extension",
      version: chrome.runtime.getManifest().version,
      clientId,
      token: extensionToken,
      sentAt: new Date().toISOString()
    };
    socket?.send(JSON.stringify(handshake));
  });

  socket.addEventListener("message", (event) => {
    handleMessage(event.data);
  });

  socket.addEventListener("close", () => {
    clearHeartbeat();
    setTimeout(connect, 2000);
  });
}

async function pushSnapshot() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const tabs = await chrome.tabs.query({});
  const payload: ChromeSnapshot = {
    app: "chrome",
    tabs: tabs.map((tab) => ({
      id: tab.id ?? -1,
      title: tab.title ?? "Untitled Tab",
      url: tab.url ?? "",
      active: Boolean(tab.active),
      pinned: Boolean(tab.pinned),
      windowId: tab.windowId,
      index: tab.index,
      highlighted: Boolean(tab.highlighted),
      groupId: tab.groupId !== undefined && tab.groupId >= 0 ? tab.groupId : null,
      openerTabId: tab.openerTabId ?? null,
      status:
        tab.status === "loading" || tab.status === "complete" || tab.status === "unloaded"
          ? tab.status
          : "unknown",
      audible: Boolean(tab.audible),
      muted: Boolean(tab.mutedInfo?.muted),
      discarded: Boolean(tab.discarded),
      autoDiscardable: Boolean(tab.autoDiscardable),
      incognito: Boolean(tab.incognito),
      favIconUrl: tab.favIconUrl ?? "",
      lastAccessed: tab.lastAccessed ?? null
    })),
    capturedAt: new Date().toISOString()
  };

  const message: RealtimeMessage = {
    type: "chrome.snapshot",
    payload
  };

  socket.send(JSON.stringify(message));
}

async function handleMessage(raw: unknown) {
  try {
    const message = JSON.parse(String(raw)) as RealtimeMessage;

    if (message.type === "extension.handshake.ack") {
      startHeartbeat(message.heartbeatIntervalMs);
      void pushSnapshot();
      return;
    }

    if (message.type === "chrome.command.request") {
      const result = await executeChromeCommand(message.payload);
      const outbound: RealtimeMessage = {
        type: "chrome.command.result",
        payload: result
      };
      socket?.send(JSON.stringify(outbound));
      return;
    }
  } catch (error) {
    console.error("[flowos][chrome] failed to process incoming message", error);
  }
}

function startHeartbeat(intervalMs: number) {
  clearHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const heartbeat: RealtimeMessage = {
      type: "extension.heartbeat",
      clientId,
      source: "chrome-extension",
      sentAt: new Date().toISOString()
    };
    socket.send(JSON.stringify(heartbeat));
  }, intervalMs);
}

function clearHeartbeat() {
  if (!heartbeatTimer) {
    return;
  }

  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

async function executeChromeCommand(
  request: ChromeCommandRequest
): Promise<ChromeCommandResult> {
  try {
    switch (request.command) {
      case "chrome.tab.focus": {
        const payload = request.payload as ChromeCommandPayloadMap["chrome.tab.focus"];
        const tab = await chrome.tabs.get(payload.tabId);
        await chrome.tabs.update(payload.tabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return {
          requestId: request.requestId,
          command: request.command,
          ok: true,
          completedAt: new Date().toISOString(),
          result: {
            focusedTabId: payload.tabId,
            windowId: tab.windowId
          }
        };
      }
      case "chrome.tabs.group": {
        const payload = request.payload as ChromeCommandPayloadMap["chrome.tabs.group"];
        const groupId = await chrome.tabs.group({
          tabIds: payload.tabIds,
          createProperties: payload.windowId
            ? { windowId: payload.windowId }
            : undefined
        });
        await chrome.tabGroups.update(groupId, {
          title: payload.title,
          color: payload.color
        });
        return {
          requestId: request.requestId,
          command: request.command,
          ok: true,
          completedAt: new Date().toISOString(),
          result: {
            groupId,
            tabIds: payload.tabIds
          }
        };
      }
      case "chrome.tabs.ungroup": {
        const payload = request.payload as ChromeCommandPayloadMap["chrome.tabs.ungroup"];
        await chrome.tabs.ungroup(payload.tabIds);
        return {
          requestId: request.requestId,
          command: request.command,
          ok: true,
          completedAt: new Date().toISOString(),
          result: {
            tabIds: payload.tabIds
          }
        };
      }
      case "chrome.tab.pin": {
        const payload = request.payload as ChromeCommandPayloadMap["chrome.tab.pin"];
        await chrome.tabs.update(payload.tabId, {
          pinned: payload.pinned
        });
        return {
          requestId: request.requestId,
          command: request.command,
          ok: true,
          completedAt: new Date().toISOString(),
          result: {
            tabId: payload.tabId,
            pinned: payload.pinned
          }
        };
      }
      case "chrome.tabs.close": {
        const payload = request.payload as ChromeCommandPayloadMap["chrome.tabs.close"];
        await chrome.tabs.remove(payload.tabIds);
        return {
          requestId: request.requestId,
          command: request.command,
          ok: true,
          completedAt: new Date().toISOString(),
          result: {
            closedTabIds: payload.tabIds
          }
        };
      }
      case "chrome.tab.open": {
        const payload = request.payload as ChromeCommandPayloadMap["chrome.tab.open"];
        const tab = await chrome.tabs.create({
          url: payload.url,
          active: payload.active,
          pinned: payload.pinned,
          windowId: payload.windowId
        });
        return {
          requestId: request.requestId,
          command: request.command,
          ok: true,
          completedAt: new Date().toISOString(),
          result: {
            tabId: tab.id ?? -1,
            windowId: tab.windowId,
            url: tab.url ?? payload.url
          }
        };
      }
    }

    return {
      requestId: request.requestId,
      command: request.command,
      ok: false,
      completedAt: new Date().toISOString(),
      error: {
        code: "UNKNOWN_COMMAND",
        message: `Unsupported command: ${request.command}`
      }
    };
  } catch (error) {
    return {
      requestId: request.requestId,
      command: request.command,
      ok: false,
      completedAt: new Date().toISOString(),
      error: {
        code: "CHROME_COMMAND_FAILED",
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

async function getOrCreateClientId() {
  const existing = await chrome.storage.local.get("flowosClientId");
  const clientIdFromStorage = existing.flowosClientId as string | undefined;
  if (clientIdFromStorage) {
    return clientIdFromStorage;
  }

  const generated = `chrome_${crypto.randomUUID()}`;
  await chrome.storage.local.set({ flowosClientId: generated });
  return generated;
}

async function getExtensionToken() {
  const existing = await chrome.storage.local.get("flowosToken");
  return (existing.flowosToken as string | undefined) ?? "";
}

chrome.tabs.onActivated.addListener(() => {
  void pushSnapshot();
});

chrome.tabs.onUpdated.addListener(() => {
  void pushSnapshot();
});

chrome.tabs.onCreated.addListener(() => {
  void pushSnapshot();
});

chrome.tabs.onRemoved.addListener(() => {
  void pushSnapshot();
});

chrome.tabs.onMoved.addListener(() => {
  void pushSnapshot();
});

chrome.tabs.onDetached.addListener(() => {
  void pushSnapshot();
});

chrome.tabs.onAttached.addListener(() => {
  void pushSnapshot();
});

chrome.tabs.onHighlighted.addListener(() => {
  void pushSnapshot();
});

void connect();
