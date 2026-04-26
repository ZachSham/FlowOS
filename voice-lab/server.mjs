import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeTranscript, shutdownExecutor } from "./executor.mjs";
import { parseVoiceTranscriptWithFallback } from "./llm-parser.mjs";

const voiceLabDir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.VOICE_LAB_PORT ?? "4180");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8"
  });
  response.end(message);
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }

  return JSON.parse(raw);
}

async function serveStatic(requestPath, response) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const safePath = path.normalize(normalizedPath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(voiceLabDir, safePath);

  if (!absolutePath.startsWith(voiceLabDir)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const file = await readFile(absolutePath);
    const extension = path.extname(absolutePath);
    const contentType = contentTypes[extension] ?? "application/octet-stream";

    response.writeHead(200, {
      "content-type": contentType
    });
    response.end(file);
  } catch {
    sendText(response, 404, "Not found");
  }
}

const server = createServer(async (request, response) => {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  const requestPath = url.pathname;

  if (method === "POST" && requestPath === "/api/parse") {
    try {
      const body = await readJsonBody(request);
      const transcript = String(body.transcript ?? "");
      const parsed = await parseVoiceTranscriptWithFallback(transcript);
      sendJson(response, 200, {
        ok: parsed.ok,
        parsed
      });
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        message: error instanceof Error ? error.message : "Invalid parse request body"
      });
    }

    return;
  }

  if (method === "POST" && requestPath === "/api/execute") {
    try {
      const body = await readJsonBody(request);
      const transcript = String(body.transcript ?? "");
      const executed = await executeTranscript(transcript);
      sendJson(response, executed.ok ? 200 : 422, executed);
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        message: error instanceof Error ? error.message : "Execution failed unexpectedly"
      });
    }

    return;
  }

  if (method === "GET") {
    await serveStatic(requestPath, response);
    return;
  }

  sendText(response, 405, "Method not allowed");
});

server.listen(port, () => {
  console.log(`Voice Lab running at http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    server.close();
    await shutdownExecutor();
    process.exit(0);
  });
}
