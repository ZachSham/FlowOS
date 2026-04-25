import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SavedFlowSession } from "./types.js";

interface SessionFile {
  sessions: SavedFlowSession[];
}

export function loadSessions(filePath: string): SavedFlowSession[] {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as SessionFile;
    return parsed.sessions ?? [];
  } catch {
    return [];
  }
}

export function saveSessions(filePath: string, sessions: SavedFlowSession[]): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const payload: SessionFile = { sessions };
  writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}
