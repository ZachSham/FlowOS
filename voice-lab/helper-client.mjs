import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

let singletonClient = null;

function resolveHelperCommand() {
  const candidates = [
    path.join(repoRoot, "swift-helper", ".build", "arm64-apple-macosx", "debug", "FlowStateHelper"),
    path.join(repoRoot, "swift-helper", ".build", "debug", "FlowStateHelper")
  ];

  const binary = candidates.find((candidate) => existsSync(candidate));
  if (binary) {
    return [binary, "--stdio"];
  }

  return [
    "swift",
    "run",
    "--package-path",
    path.join(repoRoot, "swift-helper"),
    "FlowStateHelper",
    "--stdio"
  ];
}

class NativeHelperClient {
  constructor() {
    this.command = resolveHelperCommand();
    this.child = null;
    this.pending = new Map();
    this.requestCounter = 0;
    this.ready = false;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
  }

  async start() {
    if (this.child) {
      return;
    }

    const [command, ...args] = this.command;
    this.child = spawn(command, args, {
      cwd: path.join(repoRoot, "swift-helper"),
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        HOME: "/tmp/flowos-swift-helper",
        CLANG_MODULE_CACHE_PATH: "/tmp/flowos-swift-helper/clang-cache",
        SWIFTPM_ENABLE_PLUGINS: "0"
      }
    });

    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    const stdoutLines = createInterface({ input: this.child.stdout });
    stdoutLines.on("line", (line) => this.handleStdoutLine(line));

    const stderrLines = createInterface({ input: this.child.stderr });
    stderrLines.on("line", (line) => {
      if (!line.trim()) {
        return;
      }

      console.error(`[voice-lab][helper][stderr] ${line}`);
    });

    this.child.on("error", (error) => {
      this.rejectAll(new Error(`[voice-lab] failed to start helper: ${error.message}`));
      if (this.readyReject) {
        this.readyReject(error);
      }
    });

    this.child.on("exit", (code, signal) => {
      this.ready = false;
      this.child = null;
      this.rejectAll(
        new Error(`[voice-lab] helper exited before response (code=${String(code)}, signal=${String(signal)})`)
      );
      if (this.readyReject) {
        this.readyReject(new Error("Helper exited before ready"));
      }
    });

    await this.readyPromise;
  }

  handleStdoutLine(line) {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (parsed.kind === "event") {
      if (parsed.event === "helper.ready") {
        this.ready = true;
        if (this.readyResolve) {
          this.readyResolve();
        }
      }

      return;
    }

    if (parsed.kind !== "response" || typeof parsed.id !== "string") {
      return;
    }

    const pending = this.pending.get(parsed.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(parsed.id);

    if (parsed.ok) {
      pending.resolve(parsed.payload);
      return;
    }

    const message = parsed?.error?.message || "Unknown helper error";
    const code = parsed?.error?.code || "unknown";
    pending.reject(new Error(`${code}: ${message}`));
  }

  rejectAll(error) {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }

    this.pending.clear();
  }

  async request(method, payload = {}) {
    await this.start();

    if (!this.child || !this.child.stdin.writable) {
      throw new Error("Native helper stdin is not writable");
    }

    const id = `voice_${++this.requestCounter}`;
    const requestEnvelope = {
      id,
      kind: "request",
      method,
      payload
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 10_000);

      this.pending.set(id, { resolve, reject, timeout });

      this.child.stdin.write(`${JSON.stringify(requestEnvelope)}\n`, (error) => {
        if (error) {
          clearTimeout(timeout);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  stop() {
    if (!this.child) {
      return;
    }

    this.child.kill();
    this.child = null;
    this.ready = false;
    this.rejectAll(new Error("Native helper stopped"));
  }
}

export function getNativeHelperClient() {
  if (!singletonClient) {
    singletonClient = new NativeHelperClient();
  }

  return singletonClient;
}

export function stopNativeHelperClient() {
  singletonClient?.stop();
  singletonClient = null;
}
