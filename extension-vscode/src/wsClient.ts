import WebSocket from "ws";

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export class WsClient {
  private ws: WebSocket | null = null;
  private queue: string[] = [];
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private isDestroyed = false;

  constructor(
    private readonly url: string,
    private readonly onMessage: (raw: unknown) => void,
    private readonly log: (msg: string) => void
  ) {}

  connect(): void {
    if (this.isDestroyed) return;
    this.log(`[wsClient] connecting to ${this.url}`);

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on("open", () => {
      this.log("[wsClient] connected");
      this.reconnectAttempt = 0;
      this.flushQueue();
    });

    ws.on("message", (raw) => {
      try {
        const parsed: unknown = JSON.parse(String(raw));
        this.onMessage(parsed);
      } catch {
        this.log("[wsClient] received non-JSON message");
      }
    });

    ws.on("close", () => {
      this.log("[wsClient] disconnected");
      this.ws = null;
      this.scheduleReconnect();
    });

    ws.on("error", (err) => {
      this.log(`[wsClient] error: ${err.message}`);
      // 'close' fires after 'error' — reconnect handled there
    });
  }

  send(data: unknown): void {
    const json = JSON.stringify(data);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(json);
    } else {
      this.queue.push(json);
    }
  }

  destroy(): void {
    this.isDestroyed = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.ws?.close();
    this.ws = null;
    this.queue = [];
  }

  private flushQueue(): void {
    while (this.queue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      const msg = this.queue.shift();
      if (msg !== undefined) this.ws.send(msg);
    }
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed || this.reconnectTimer !== undefined) return;
    const delay = Math.min(
      MIN_BACKOFF_MS * 2 ** this.reconnectAttempt,
      MAX_BACKOFF_MS
    );
    this.reconnectAttempt++;
    this.log(`[wsClient] retrying in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }
}
