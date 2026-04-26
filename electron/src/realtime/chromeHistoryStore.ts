import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ChromeSnapshot } from "@flowos/shared";

const DEFAULT_MAX_IN_MEMORY = 300;

export interface ChromeHistoryStore {
  getLatest(): ChromeSnapshot | null;
  getRecent(limit?: number): ChromeSnapshot[];
  append(snapshot: ChromeSnapshot): Promise<void>;
}

export async function createChromeHistoryStore(
  filePath: string,
  maxInMemory = DEFAULT_MAX_IN_MEMORY
): Promise<ChromeHistoryStore> {
  await mkdir(dirname(filePath), { recursive: true });
  const snapshots = await loadExistingSnapshots(filePath, maxInMemory);

  return {
    getLatest() {
      return snapshots[snapshots.length - 1] ?? null;
    },
    getRecent(limit = 20) {
      return snapshots.slice(Math.max(0, snapshots.length - limit));
    },
    async append(snapshot) {
      snapshots.push(snapshot);
      if (snapshots.length > maxInMemory) {
        snapshots.shift();
      }

      await appendFile(filePath, `${JSON.stringify(snapshot)}\n`, "utf8");
    }
  };
}

async function loadExistingSnapshots(filePath: string, maxInMemory: number) {
  try {
    const raw = await readFile(filePath, "utf8");
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const parsed = lines
      .slice(Math.max(0, lines.length - maxInMemory))
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as ChromeSnapshot];
        } catch {
          return [];
        }
      });
    return parsed;
  } catch {
    return [] as ChromeSnapshot[];
  }
}
