import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { BrowserWindow } from "electron";
import type { RealtimeMessage, VsCodeSnapshot } from "@flowos/shared";
import { analyzeSnapshot } from "../claude/client.js";
import { ipcChannels } from "../ipc/channels.js";

const DEBOUNCE_MS = 5_000;

export function createRealtimeServer(port: number) {
  const wss = new WebSocketServer({ port });
  let lastSnapshot: VsCodeSnapshot | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let isProcessing = false;

  function pushToWindows(channel: string, payload?: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  }

  async function processSnapshot(snapshot: VsCodeSnapshot): Promise<void> {
    if (isProcessing) return;
    isProcessing = true;
    try {
      pushToWindows(ipcChannels.stateLoading);

      const insight = await analyzeSnapshot({
        activeFile: snapshot.activeFile,
        openTabs: snapshot.openTabs,
        diagnostics: snapshot.diagnostics,
        recentEdits: snapshot.recentCommands,
      });

      if (insight) {
        pushToWindows(ipcChannels.stateUpdated, {
          taskState: insight.taskState,
          suggestions: insight.suggestions,
          reasoning: insight.reasoning,
          hasError: false,
        });
      } else {
        pushToWindows(ipcChannels.stateUpdated, { hasError: true });
      }
    } finally {
      isProcessing = false;
    }
  }

  wss.on("connection", (socket: WebSocket) => {
    console.log(`[realtime] client connected on :${port}`);

    socket.on("message", (raw: RawData) => {
      try {
        const parsed = JSON.parse(String(raw)) as RealtimeMessage;
        console.log("[realtime] event", parsed.type);

        if (parsed.type === "vscode.snapshot") {
          lastSnapshot = parsed.payload;
          if (debounceTimer !== undefined) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            debounceTimer = undefined;
            if (lastSnapshot !== null) void processSnapshot(lastSnapshot);
          }, DEBOUNCE_MS);
        }
      } catch (error) {
        console.error("[realtime] invalid message", error);
      }
    });

    socket.on("close", () => {
      console.log("[realtime] client disconnected");
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
    });
  });

  return wss;
}
