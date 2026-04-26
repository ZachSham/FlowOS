import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_RECENT_ENTRY_LIMIT = 200;

export interface PersistentMemoryEntry {
  timestamp: string;
  title: string;
  summary?: string;
  data?: unknown;
}

export interface PersistentMemorySnapshot {
  filePath: string;
  recentEntries: PersistentMemoryEntry[];
}

export interface PersistentMemoryStore {
  getSnapshot(): PersistentMemorySnapshot;
  appendEntry(entry: Omit<PersistentMemoryEntry, "timestamp">): Promise<void>;
}

export async function createPersistentMemoryStore(
  filePath: string,
  recentEntryLimit = DEFAULT_RECENT_ENTRY_LIMIT
): Promise<PersistentMemoryStore> {
  await mkdir(dirname(filePath), { recursive: true });
  await ensureFile(filePath);
  const recentEntries = await loadRecentEntries(filePath, recentEntryLimit);

  return {
    getSnapshot() {
      return {
        filePath,
        recentEntries: [...recentEntries]
      };
    },
    async appendEntry(entry) {
      const timestamp = new Date().toISOString();
      const normalized: PersistentMemoryEntry = {
        timestamp,
        title: entry.title,
        summary: entry.summary,
        data: entry.data
      };

      recentEntries.unshift(normalized);
      if (recentEntries.length > recentEntryLimit) {
        recentEntries.length = recentEntryLimit;
      }

      await appendFile(filePath, formatEntry(normalized), "utf8");
    }
  };
}

async function ensureFile(filePath: string) {
  try {
    await readFile(filePath, "utf8");
  } catch {
    const now = new Date().toISOString();
    await writeFile(
      filePath,
      [
        "# FlowOS Persistent Memory",
        "",
        "This file keeps durable context from key FlowOS actions.",
        "It is append-only so an agent can reuse it as historical context.",
        "",
        `Initialized: ${now}`,
        ""
      ].join("\n"),
      "utf8"
    );
  }
}

async function loadRecentEntries(filePath: string, limit: number) {
  try {
    const raw = await readFile(filePath, "utf8");
    const chunks = raw.split("\n## ").map((chunk, index) => (index === 0 ? chunk : `## ${chunk}`));
    const parsed = chunks
      .map((chunk) => parseEntry(chunk))
      .filter((entry): entry is PersistentMemoryEntry => entry !== null);
    return parsed.reverse().slice(0, Math.max(0, limit));
  } catch {
    return [] as PersistentMemoryEntry[];
  }
}

function parseEntry(chunk: string): PersistentMemoryEntry | null {
  const headerMatch = chunk.match(/^## \[(.+?)\] (.+)$/m);
  if (!headerMatch) {
    return null;
  }

  const timestamp = headerMatch[1];
  const title = headerMatch[2];
  if (!timestamp || !title) {
    return null;
  }
  const lines = chunk.split("\n");
  const summaryLine = lines.find((line) => line.startsWith("- Summary: "));
  const summary = summaryLine ? summaryLine.replace("- Summary: ", "").trim() : undefined;

  return {
    timestamp,
    title: title.trim(),
    summary
  };
}

function formatEntry(entry: PersistentMemoryEntry) {
  const parts: string[] = [`## [${entry.timestamp}] ${entry.title}`];

  if (entry.summary) {
    parts.push(`- Summary: ${entry.summary}`);
  }

  if (entry.data !== undefined) {
    parts.push("", "```json", safeJson(entry.data), "```");
  }

  parts.push("", "");
  return parts.join("\n");
}

function safeJson(value: unknown) {
  try {
    const serialized = JSON.stringify(value, null, 2) ?? "null";
    if (serialized.length <= 6000) {
      return serialized;
    }

    return JSON.stringify(
      {
        truncated: true,
        preview: serialized.slice(0, 6000)
      },
      null,
      2
    );
  } catch {
    return JSON.stringify({ serializationError: true }, null, 2);
  }
}
