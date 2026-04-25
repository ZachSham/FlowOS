import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { RealtimeMessage } from "@flowos/shared";

export function createRealtimeServer(port: number) {
  const wss = new WebSocketServer({ port });

  wss.on("connection", (socket: WebSocket) => {
    console.log(`[realtime] client connected on :${port}`);

    socket.on("message", (raw: RawData) => {
      try {
        const parsed = JSON.parse(String(raw)) as RealtimeMessage;
        console.log("[realtime] event", parsed.type, parsed);
      } catch (error) {
        console.error("[realtime] invalid message", error);
      }
    });

    socket.on("close", () => {
      console.log("[realtime] client disconnected");
    });
  });

  return wss;
}
