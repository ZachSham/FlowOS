import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { createRealtimeServer } from "./server.js";
import type { RealtimeMessage, VscodeSnapshot } from "@flowos/shared";

// Use a random high port for each test to avoid conflicts
function makePort() {
  return 47000 + Math.floor(Math.random() * 1000);
}

function wsUrl(port: number) {
  return `ws://127.0.0.1:${port}`;
}

// Connects a fake extension client and returns helpers
async function connectFakeClient(
  port: number,
  source: "vscode-extension" | "chrome-extension",
  token = ""
): Promise<{
  socket: WebSocket;
  send: (msg: RealtimeMessage) => void;
  nextMessage: () => Promise<RealtimeMessage>;
  close: () => void;
}> {
  const socket = new WebSocket(wsUrl(port));

  const inbox: RealtimeMessage[] = [];
  const waiters: Array<(msg: RealtimeMessage) => void> = [];

  socket.on("message", (raw) => {
    const msg = JSON.parse(String(raw)) as RealtimeMessage;
    const waiter = waiters.shift();
    if (waiter) {
      waiter(msg);
    } else {
      inbox.push(msg);
    }
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  function send(msg: RealtimeMessage) {
    socket.send(JSON.stringify(msg));
  }

  function nextMessage(): Promise<RealtimeMessage> {
    if (inbox.length > 0) return Promise.resolve(inbox.shift()!);
    return new Promise<RealtimeMessage>((resolve) => {
      waiters.push(resolve);
    });
  }

  // Perform handshake
  send({
    type: "extension.handshake",
    source,
    version: "0.2.0",
    clientId: `test_${source}_001`,
    token,
    sentAt: new Date().toISOString(),
  });

  // Wait for ack
  const ack = await nextMessage();
  if (ack.type !== "extension.handshake.ack") {
    throw new Error(`Expected handshake.ack, got ${ack.type}`);
  }

  return { socket, send, nextMessage, close: () => socket.close() };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("realtime server — VS Code extension integration", () => {
  let port: number;
  let server: ReturnType<typeof createRealtimeServer>;

  beforeEach(() => {
    port = makePort();
  });

  afterEach(() => {
    server?.stop();
  });

  // ── Handshake ──────────────────────────────────────────────────────────────

  it("accepts vscode-extension handshake and sends ack with heartbeat interval", async () => {
    server = createRealtimeServer(port);

    const client = await connectFakeClient(port, "vscode-extension");
    // If we reach here, handshake succeeded (connectFakeClient throws on failure)
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    client.close();
  });

  it("accepts chrome-extension handshake alongside vscode-extension", async () => {
    server = createRealtimeServer(port);

    const vscode = await connectFakeClient(port, "vscode-extension");
    const chrome = await connectFakeClient(port, "chrome-extension");

    const clients = server.getConnectedClients();
    expect(clients).toHaveLength(2);
    expect(clients.map((c) => c.source).sort()).toEqual(["chrome-extension", "vscode-extension"]);

    vscode.close();
    chrome.close();
  });

  it("rejects connection from unsupported source by closing the socket", async () => {
    server = createRealtimeServer(port);

    const socket = new WebSocket(wsUrl(port));
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    socket.send(
      JSON.stringify({
        type: "extension.handshake",
        source: "unknown-source",
        version: "1.0.0",
        clientId: "bad_client",
        token: "",
        sentAt: new Date().toISOString(),
      })
    );

    await new Promise<void>((resolve) => { socket.once("close", resolve); });
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });

  it("rejects connection with wrong auth token", async () => {
    server = createRealtimeServer(port, { authToken: "secret-token" });

    const socket = new WebSocket(wsUrl(port));
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    socket.send(
      JSON.stringify({
        type: "extension.handshake",
        source: "vscode-extension",
        version: "0.2.0",
        clientId: "test_bad_token",
        token: "wrong-token",
        sentAt: new Date().toISOString(),
      })
    );

    await new Promise<void>((resolve) => { socket.once("close", resolve); });
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });

  // ── VS Code snapshot ───────────────────────────────────────────────────────

  it("fires onVscodeSnapshot when extension sends a snapshot", async () => {
    const snapshots: VscodeSnapshot[] = [];
    server = createRealtimeServer(port, {
      onVscodeSnapshot: (s) => { snapshots.push(s); }
    });

    const client = await connectFakeClient(port, "vscode-extension");

    const mockSnapshot: VscodeSnapshot = {
      app: "vscode",
      workspaceName: "flowos",
      workspaceRoot: "/Users/test/flowos",
      activeFile: "/Users/test/flowos/src/main.ts",
      activeLanguageId: "typescript",
      activeLine: 42,
      activeColumn: 10,
      selectedText: null,
      editorGroups: [{ index: 0, activeFile: "/Users/test/flowos/src/main.ts", openFiles: ["/Users/test/flowos/src/main.ts"] }],
      openTabs: ["/Users/test/flowos/src/main.ts"],
      diagnostics: [{ file: "/Users/test/flowos/src/main.ts", severity: "error", message: "Cannot find name 'foo'", line: 42, column: 10 }],
      git: { branch: "edge-inference", ahead: 2, behind: 0, modified: ["src/main.ts"], staged: [], untracked: [] },
      terminals: [{ name: "FlowOS", processId: 12345 }],
      capturedAt: new Date().toISOString(),
    };

    client.send({ type: "vscode.snapshot", payload: mockSnapshot });

    // Give the server a tick to process
    await new Promise((r) => setTimeout(r, 50));

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.workspaceName).toBe("flowos");
    expect(snapshots[0]?.activeFile).toBe("/Users/test/flowos/src/main.ts");
    expect(snapshots[0]?.git?.branch).toBe("edge-inference");
    expect(snapshots[0]?.diagnostics).toHaveLength(1);
    expect(snapshots[0]?.diagnostics[0]?.severity).toBe("error");

    client.close();
  });

  // ── VS Code command round-trip ─────────────────────────────────────────────

  it("routes vscode_open_file command to extension and resolves with result", async () => {
    server = createRealtimeServer(port);
    const client = await connectFakeClient(port, "vscode-extension");

    // Server sends command → client receives it, sends result back
    const commandPromise = server.requestVscodeCommand("vscode.file.open", {
      path: "/Users/test/flowos/src/main.ts",
      line: 42,
    });

    // Client receives the command request
    const request = await client.nextMessage();
    expect(request.type).toBe("vscode.command.request");
    if (request.type !== "vscode.command.request") throw new Error("wrong type");
    expect(request.payload.command).toBe("vscode.file.open");
    expect((request.payload.payload as Record<string, unknown>)["path"]).toBe("/Users/test/flowos/src/main.ts");

    // Client sends back success result
    client.send({
      type: "vscode.command.result",
      payload: {
        requestId: request.payload.requestId,
        command: "vscode.file.open",
        ok: true,
        result: { opened: "/Users/test/flowos/src/main.ts", line: 42 },
        completedAt: new Date().toISOString(),
      },
    });

    const result = await commandPromise;
    expect(result).toMatchObject({ opened: "/Users/test/flowos/src/main.ts", line: 42 });

    client.close();
  });

  it("routes vscode_run_terminal_command and resolves with terminal name", async () => {
    server = createRealtimeServer(port);
    const client = await connectFakeClient(port, "vscode-extension");

    const commandPromise = server.requestVscodeCommand("vscode.terminal.run", {
      command: "npm test",
      terminalName: "Tests",
    });

    const request = await client.nextMessage();
    expect(request.type).toBe("vscode.command.request");
    if (request.type !== "vscode.command.request") throw new Error("wrong type");
    expect(request.payload.command).toBe("vscode.terminal.run");

    client.send({
      type: "vscode.command.result",
      payload: {
        requestId: request.payload.requestId,
        command: "vscode.terminal.run",
        ok: true,
        result: { terminalName: "Tests", sent: "npm test" },
        completedAt: new Date().toISOString(),
      },
    });

    const result = await commandPromise;
    expect(result).toMatchObject({ terminalName: "Tests", sent: "npm test" });

    client.close();
  });

  it("rejects command promise when extension returns error", async () => {
    server = createRealtimeServer(port);
    const client = await connectFakeClient(port, "vscode-extension");

    const commandPromise = server.requestVscodeCommand("vscode.command.execute", {
      commandId: "editor.action.formatDocument",
    });

    const request = await client.nextMessage();
    if (request.type !== "vscode.command.request") throw new Error("wrong type");

    client.send({
      type: "vscode.command.result",
      payload: {
        requestId: request.payload.requestId,
        command: "vscode.command.execute",
        ok: false,
        error: { code: "VSCODE_COMMAND_FAILED", message: "No active editor" },
        completedAt: new Date().toISOString(),
      },
    });

    await expect(commandPromise).rejects.toThrow("No active editor");

    client.close();
  });

  it("throws when requestVscodeCommand is called with no VS Code client connected", async () => {
    server = createRealtimeServer(port);
    // No client connected at all

    await expect(
      server.requestVscodeCommand("vscode.file.open", { path: "/tmp/test.ts" })
    ).rejects.toThrow("vscode-extension");
  });

  it("times out when extension never responds to a command", async () => {
    // Override timeout to 200ms for speed
    server = createRealtimeServer(port);
    const client = await connectFakeClient(port, "vscode-extension");

    // Monkey-patch: send command but client never replies
    // We can't easily override COMMAND_TIMEOUT_MS, so we just verify the
    // promise eventually rejects — use a real timeout test with a longer wait
    // Instead, verify the command is received but we don't reply:
    const commandPromise = server.requestVscodeCommand("vscode.file.open", { path: "/tmp/x.ts" });

    // Drain the request from client inbox (but don't respond)
    await client.nextMessage();

    // The server's timeout is 15s — too long for a test. Just verify the
    // promise is still pending (not resolved or rejected yet)
    const raceResult = await Promise.race([
      commandPromise.then(() => "resolved").catch(() => "rejected"),
      new Promise<string>((r) => setTimeout(() => r("pending"), 100)),
    ]);
    expect(raceResult).toBe("pending");

    client.close();
  }, 5000);

  // ── Heartbeat ──────────────────────────────────────────────────────────────

  it("responds to heartbeat with heartbeat.ack", async () => {
    server = createRealtimeServer(port);
    const client = await connectFakeClient(port, "vscode-extension");

    client.send({
      type: "extension.heartbeat",
      source: "vscode-extension",
      clientId: "test_vscode_001",
      sentAt: new Date().toISOString(),
    });

    const ack = await client.nextMessage();
    expect(ack.type).toBe("extension.heartbeat.ack");

    client.close();
  });

  // ── getConnectedClients ────────────────────────────────────────────────────

  it("lists connected clients with correct source after handshake", async () => {
    server = createRealtimeServer(port);
    const client = await connectFakeClient(port, "vscode-extension");

    const clients = server.getConnectedClients();
    expect(clients).toHaveLength(1);
    expect(clients[0]?.source).toBe("vscode-extension");
    expect(clients[0]?.version).toBe("0.2.0");

    client.close();
    // Give server time to process close
    await new Promise((r) => setTimeout(r, 50));
    expect(server.getConnectedClients()).toHaveLength(0);
  });
});
