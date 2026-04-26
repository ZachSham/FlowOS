import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import type {
  NativeEventEnvelope,
  NativeMethod,
  NativeRequest,
  NativeRequestPayloadMap,
  NativeResponse,
  NativeResponsePayloadMap
} from "@flowos/shared";

export interface SwiftHelperStatus {
  connected: boolean;
  transport: "stdio";
  command: string[];
}

interface PendingRequest {
  method: NativeMethod;
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
}

interface NativeHelperBridge {
  getStatus(): SwiftHelperStatus;
  onEvent(listener: (event: NativeEventEnvelope) => void): () => void;
  request<M extends NativeMethod>(
    method: M,
    payload: NativeRequestPayloadMap[M]
  ): Promise<NativeResponsePayloadMap[M]>;
  stop(): void;
}

export async function startSwiftHelperBridge(): Promise<NativeHelperBridge> {
  const helperCommand = resolveHelperCommand();
  const [command, ...args] = helperCommand;
  const child: ChildProcessWithoutNullStreams = spawn(command, args, {
    cwd: resolve(process.cwd(), "swift-helper"),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: "/tmp/flowos-swift-helper",
      CLANG_MODULE_CACHE_PATH: "/tmp/flowos-swift-helper/clang-cache",
      SWIFTPM_ENABLE_PLUGINS: "0"
    }
  });

  const emitter = new EventEmitter();
  const pending = new Map<string, PendingRequest>();
  let connected = false;
  let requestCounter = 0;

  const stdoutLines = createInterface({ input: child.stdout });
  stdoutLines.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      const parsed = JSON.parse(trimmed) as NativeEventEnvelope | NativeResponse;

      if (parsed.kind === "event") {
        if (parsed.event === "helper.ready") {
          connected = true;
        }

        emitter.emit("event", parsed);
        return;
      }

      const pendingRequest = pending.get(parsed.id);
      if (!pendingRequest) {
        return;
      }

      pending.delete(parsed.id);

      if (parsed.ok) {
        clearTimeout(pendingRequest.timeout);
        pendingRequest.resolve(parsed.payload);
      } else {
        clearTimeout(pendingRequest.timeout);
        pendingRequest.reject(new Error(`${parsed.error.code}: ${parsed.error.message}`));
      }
    } catch (error) {
      console.error("[flowos][native-helper] failed to parse helper stdout line");
      console.error(trimmed);
      console.error(error);
    }
  });

  const stderrLines = createInterface({ input: child.stderr });
  stderrLines.on("line", (line) => {
    if (!line.trim()) {
      return;
    }

    console.error(`[flowos][native-helper][stderr] ${line}`);
  });

  child.on("exit", (code, signal) => {
    connected = false;
    for (const [id, pendingRequest] of pending) {
      clearTimeout(pendingRequest.timeout);
      pendingRequest.reject(
        new Error(`Swift helper exited before responding to ${pendingRequest.method} (${id})`)
      );
      pending.delete(id);
    }

    console.error(
      `[flowos][native-helper] helper exited with code ${String(code)} signal ${String(signal)}`
    );
  });

  child.on("error", (error) => {
    connected = false;
    console.error(`[flowos][native-helper] failed to start helper: ${error.message}`);
  });

  return {
    getStatus() {
      return {
        connected,
        transport: "stdio",
        command: helperCommand
      };
    },
    onEvent(listener) {
      emitter.on("event", listener);
      return () => {
        emitter.off("event", listener);
      };
    },
    request(method, payload) {
      const id = `native_${++requestCounter}`;
      const request: NativeRequest<typeof method> = {
        id,
        kind: "request",
        method,
        payload
      };

      return new Promise((resolveRequest, rejectRequest) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          rejectRequest(new Error(`Timed out waiting for swift helper response to ${method}`));
        }, 10_000);

        pending.set(id, {
          method,
          resolve: resolveRequest,
          reject: rejectRequest,
          timeout
        });

        child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
          if (error) {
            clearTimeout(timeout);
            pending.delete(id);
            rejectRequest(error);
          }
        });
      }) as Promise<NativeResponsePayloadMap[typeof method]>;
    },
    stop() {
      stdoutLines.close();
      stderrLines.close();
      child.kill();
    }
  };
}

function resolveHelperCommand() {
  const builtBinary = resolve(
    process.cwd(),
    "swift-helper",
    ".build",
    "arm64-apple-macosx",
    "debug",
    "FlowStateHelper"
  );

  if (existsSync(builtBinary)) {
    return [builtBinary, "--stdio"] as [string, ...string[]];
  }

  return [
    "swift",
    "run",
    "--package-path",
    resolve(process.cwd(), "swift-helper"),
    "FlowStateHelper",
    "--stdio"
  ] as [string, ...string[]];
}
