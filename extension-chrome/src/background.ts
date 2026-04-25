import type { ChromeSnapshot, RealtimeMessage } from "@flowos/shared";

const websocketUrl = "ws://127.0.0.1:7331";
let socket: WebSocket | null = null;

function connect() {
  socket = new WebSocket(websocketUrl);

  socket.addEventListener("open", () => {
    const handshake: RealtimeMessage = {
      type: "extension.handshake",
      source: "chrome-extension",
      version: chrome.runtime.getManifest().version
    };
    socket?.send(JSON.stringify(handshake));
    void pushSnapshot();
  });

  socket.addEventListener("close", () => {
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
      windowId: tab.windowId
    })),
    capturedAt: new Date().toISOString()
  };

  const message: RealtimeMessage = {
    type: "chrome.snapshot",
    payload
  };

  socket.send(JSON.stringify(message));
}

chrome.tabs.onActivated.addListener(() => {
  void pushSnapshot();
});

chrome.tabs.onUpdated.addListener(() => {
  void pushSnapshot();
});

connect();

