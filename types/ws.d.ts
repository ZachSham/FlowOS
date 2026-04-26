declare module "ws" {
  export type RawData = string | Buffer | ArrayBuffer | Buffer[];

  export class WebSocket {
    static readonly OPEN: number;

    constructor(address: string);

    readyState: number;

    send(data: string): void;
    close(): void;

    on(event: "open" | "close", listener: () => void): this;
    on(event: "message", listener: (data: RawData) => void): this;
  }

  export class WebSocketServer {
    constructor(options: { port: number; host?: string });

    on(event: "connection", listener: (socket: WebSocket) => void): this;
    close(): void;
  }

  export default WebSocket;
}
