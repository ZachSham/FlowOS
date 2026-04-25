import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type {
  BrowserErrorPayload,
  ChromeCommand,
  ChromeContextPayload,
  FlowState,
  ObjectiveAnalysis,
  SavedFlowSession
} from "./types.js";

export interface ApiHooks {
  getState: () => FlowState;
  setChromeContext: (payload: ChromeContextPayload) => void;
  setBrowserError: (payload: BrowserErrorPayload) => void;
  setPendingChromeCommand: (command: ChromeCommand) => void;
  consumePendingChromeCommand: () => ChromeCommand;
  analyzeWorkspace: () => ObjectiveAnalysis;
  enterFlow: () => Promise<void>;
  exitFlow: () => Promise<void>;
  leaveSession: () => Promise<void>;
  saveCurrentSession: () => SavedFlowSession | undefined;
  openFile: (path: string, line?: number) => Promise<void>;
  runCommand: (command: string) => Promise<void>;
}

function applyCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  applyCors(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function readBody<T>(req: IncomingMessage): Promise<T | null> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function createFlowApiServer(port: number, hooks: ApiHooks) {
  const server = createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

      if (method === "OPTIONS") {
        applyCors(res);
        res.statusCode = 204;
        res.end();
        return;
      }

    if (method === "POST" && url.pathname === "/chrome/context") {
      const body = await readBody<ChromeContextPayload>(req);
      if (!body || !Array.isArray(body.tabs)) {
        sendJson(res, 400, { ok: false, error: "Invalid chrome context payload" });
        return;
      }

      hooks.setChromeContext(body);
      const analysis = hooks.analyzeWorkspace();
      sendJson(res, 200, { ok: true, analysis });
      return;
    }

    if (method === "GET" && url.pathname === "/chrome/command") {
      const command = hooks.consumePendingChromeCommand();
      sendJson(res, 200, command);
      return;
    }

    if (method === "POST" && url.pathname === "/chrome/result") {
      const body = await readBody<{ event?: string; payload?: unknown }>(req);
      sendJson(res, 200, { ok: true, received: body ?? {} });
      return;
    }

    if (method === "POST" && url.pathname === "/chrome/error") {
      const body = await readBody<BrowserErrorPayload>(req);
      if (!body || typeof body.message !== "string") {
        sendJson(res, 400, { ok: false, error: "Invalid browser error payload" });
        return;
      }

      hooks.setBrowserError(body);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && url.pathname === "/flow/analyze") {
      const analysis = hooks.analyzeWorkspace();
      sendJson(res, 200, { ok: true, analysis, state: hooks.getState() });
      return;
    }

    if (method === "POST" && url.pathname === "/flow/enter") {
      void hooks.enterFlow().catch((error) => {
        console.error("[flow] enterFlow failed", error);
      });
      sendJson(res, 200, { ok: true, state: hooks.getState() });
      return;
    }

    if (method === "POST" && url.pathname === "/flow/exit") {
      void hooks.exitFlow().catch((error) => {
        console.error("[flow] exitFlow failed", error);
      });
      sendJson(res, 200, { ok: true, state: hooks.getState() });
      return;
    }

    if (method === "POST" && url.pathname === "/flow/leave") {
      void hooks.leaveSession().catch((error) => {
        console.error("[flow] leaveSession failed", error);
      });
      sendJson(res, 200, { ok: true, state: hooks.getState() });
      return;
    }

    if (method === "POST" && url.pathname === "/flow/save") {
      const session = hooks.saveCurrentSession();
      sendJson(res, 200, { ok: true, session });
      return;
    }

    if (method === "GET" && url.pathname === "/flow/sessions") {
      sendJson(res, 200, { ok: true, sessions: hooks.getState().sessions });
      return;
    }

    if (method === "POST" && url.pathname === "/vscode/open-file") {
      const body = await readBody<{ path?: string; line?: number }>(req);
      if (!body?.path) {
        sendJson(res, 400, { ok: false, error: "Missing 'path'" });
        return;
      }

      await hooks.openFile(body.path, body.line);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === "POST" && url.pathname === "/terminal/run-command") {
      const body = await readBody<{ command?: string }>(req);
      if (!body?.command) {
        sendJson(res, 400, { ok: false, error: "Missing 'command'" });
        return;
      }

      await hooks.runCommand(body.command);
      sendJson(res, 200, { ok: true });
      return;
    }

      sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      console.error("[flow] API request failed", error);
      sendJson(res, 500, { ok: false, error: "Internal server error" });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[flow] API listening on http://127.0.0.1:${port}`);
  });

  return server;
}
