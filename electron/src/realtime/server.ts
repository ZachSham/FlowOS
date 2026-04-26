import { randomUUID } from "node:crypto";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type {
  ChromeCommand,
  ChromeCommandPayloadMap,
  ChromeCommandRequest,
  ChromeCommandResult,
  ChromeCommandResultMap,
  ChromeSnapshot,
  RealtimeMessage,
  SignalSource
} from "@flowos/shared";

const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;
const COMMAND_TIMEOUT_MS = 12_000;
const EXTENSION_SOURCES: ReadonlySet<SignalSource> = new Set(["chrome-extension"]);

interface ConnectedClient {
  id: string;
  source: SignalSource;
  version: string;
  socket: WebSocket;
  connectedAt: string;
  lastHeartbeatAt: number;
}

interface PendingCommand {
  command: ChromeCommand;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
}

interface RealtimeServerOptions {
  authToken?: string;
  onChromeSnapshot?: (snapshot: ChromeSnapshot) => void;
}

export interface RealtimeServerHandle {
  stop(): void;
  getConnectedClients(): Array<{
    id: string;
    source: SignalSource;
    version: string;
    connectedAt: string;
    lastHeartbeatAt: string;
  }>;
  requestChromeCommand<C extends ChromeCommand>(
    command: C,
    payload: ChromeCommandPayloadMap[C]
  ): Promise<ChromeCommandResultMap[C]>;
}

export function createRealtimeServer(port: number, options: RealtimeServerOptions = {}): RealtimeServerHandle {
  const wss = new WebSocketServer({ port, host: "127.0.0.1" });
  const clients = new Map<WebSocket, ConnectedClient>();
  const pendingCommands = new Map<string, PendingCommand>();

  const heartbeatSweep = setInterval(() => {
    const now = Date.now();
    for (const [socket, client] of clients) {
      if (now - client.lastHeartbeatAt <= HEARTBEAT_TIMEOUT_MS) {
        continue;
      }

      console.warn(`[realtime] stale client ${client.id} (${client.source}), closing socket`);
      socket.close();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("connection", (socket: WebSocket) => {
    console.log(`[realtime] client socket connected on :${port}`);

    socket.on("message", (raw: RawData) => {
      try {
        const parsed = JSON.parse(String(raw)) as RealtimeMessage;
        handleMessage(socket, parsed);
      } catch (error) {
        console.error("[realtime] invalid message", error);
      }
    });

    socket.on("close", () => {
      const disconnected = clients.get(socket);
      if (disconnected) {
        console.log(`[realtime] client disconnected ${disconnected.id} (${disconnected.source})`);
      } else {
        console.log("[realtime] anonymous socket disconnected");
      }
      clients.delete(socket);
    });
  });

  function stop() {
    clearInterval(heartbeatSweep);

    for (const pending of pendingCommands.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Realtime server stopped before command completed"));
    }
    pendingCommands.clear();

    for (const socket of clients.keys()) {
      socket.close();
    }
    clients.clear();

    wss.close();
  }

  function getConnectedClients() {
    return Array.from(clients.values()).map((client) => ({
      id: client.id,
      source: client.source,
      version: client.version,
      connectedAt: client.connectedAt,
      lastHeartbeatAt: new Date(client.lastHeartbeatAt).toISOString()
    }));
  }

  async function requestChromeCommand<C extends ChromeCommand>(
    command: C,
    payload: ChromeCommandPayloadMap[C]
  ): Promise<ChromeCommandResultMap[C]> {
    const chromeClient = pickChromeClient(clients);
    if (!chromeClient) {
      throw new Error("No authenticated chrome-extension client connected");
    }

    const request: ChromeCommandRequest<C> = {
      requestId: `chrome_${randomUUID()}`,
      command,
      payload,
      issuedAt: new Date().toISOString()
    };

    const outbound: RealtimeMessage = {
      type: "chrome.command.request",
      payload: request
    };

    return await new Promise<ChromeCommandResultMap[C]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingCommands.delete(request.requestId);
        reject(new Error(`Timed out waiting for ${command} (${request.requestId})`));
      }, COMMAND_TIMEOUT_MS);

      pendingCommands.set(request.requestId, {
        command,
        resolve: (result) => resolve(result as ChromeCommandResultMap[C]),
        reject,
        timeout
      });

      chromeClient.socket.send(JSON.stringify(outbound));
    });
  }

  function handleMessage(socket: WebSocket, message: RealtimeMessage) {
    if (message.type === "extension.handshake") {
      handleHandshake(socket, message);
      return;
    }

    const client = clients.get(socket);
    if (!client) {
      console.warn("[realtime] dropping pre-handshake message");
      socket.close();
      return;
    }

    if (message.type === "extension.heartbeat") {
      client.lastHeartbeatAt = Date.now();
      const heartbeatAck: RealtimeMessage = {
        type: "extension.heartbeat.ack",
        clientId: client.id,
        source: "electron",
        serverTime: new Date().toISOString()
      };
      socket.send(JSON.stringify(heartbeatAck));
      return;
    }

    switch (message.type) {
      case "chrome.snapshot":
        options.onChromeSnapshot?.(message.payload);
        return;
      case "chrome.command.result":
        handleCommandResult(message.payload);
        return;
      default:
        console.log("[realtime] event", message.type, message);
    }
  }

  function handleHandshake(socket: WebSocket, message: Extract<RealtimeMessage, { type: "extension.handshake" }>) {
    if (!EXTENSION_SOURCES.has(message.source)) {
      console.warn(`[realtime] rejecting handshake from unsupported source ${message.source}`);
      socket.close();
      return;
    }

    if (options.authToken && message.token !== options.authToken) {
      console.warn(`[realtime] rejecting handshake from ${message.source}, invalid token`);
      socket.close();
      return;
    }

    const clientId = message.clientId ?? `${message.source}_${randomUUID()}`;
    const connectedClient: ConnectedClient = {
      id: clientId,
      source: message.source,
      version: message.version,
      socket,
      connectedAt: new Date().toISOString(),
      lastHeartbeatAt: Date.now()
    };

    clients.set(socket, connectedClient);
    console.log(`[realtime] handshake accepted ${clientId} (${message.source}@${message.version})`);

    const ack: RealtimeMessage = {
      type: "extension.handshake.ack",
      clientId,
      source: "electron",
      serverTime: new Date().toISOString(),
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      authRequired: Boolean(options.authToken)
    };
    socket.send(JSON.stringify(ack));
  }

  function handleCommandResult(result: ChromeCommandResult) {
    const pending = pendingCommands.get(result.requestId);
    if (!pending) {
      console.warn(`[realtime] unexpected chrome command result ${result.requestId}`);
      return;
    }

    pendingCommands.delete(result.requestId);
    clearTimeout(pending.timeout);

    if (!result.ok) {
      pending.reject(new Error(`${result.error.code}: ${result.error.message}`));
      return;
    }

    pending.resolve(result.result);
  }

  return {
    stop,
    getConnectedClients,
    requestChromeCommand
  };
}

function pickChromeClient(
  clients: Map<WebSocket, ConnectedClient>
): ConnectedClient | undefined {
  const chromeClients = Array.from(clients.values()).filter(
    (client) => client.source === "chrome-extension"
  );

  if (chromeClients.length === 0) {
    return undefined;
  }

  chromeClients.sort((a, b) => b.lastHeartbeatAt - a.lastHeartbeatAt);
  return chromeClients[0];
}
