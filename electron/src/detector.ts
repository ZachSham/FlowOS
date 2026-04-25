import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { ChromeContextPayload, ObjectiveAnalysis } from "./types.js";

export interface LocalSignals {
  activeApp: string;
  activeWindowTitle: string;
  recentCommands: string[];
}

function runOsa(script: string): string {
  try {
    return execFileSync("osascript", ["-e", script], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

export function collectLocalSignals(): LocalSignals {
  const activeApp = runOsa(
    'tell application "System Events" to get name of first application process whose frontmost is true'
  );

  const activeWindowTitle = runOsa(
    'tell application "System Events" to tell (first process whose frontmost is true) to if exists window 1 then get name of window 1'
  );

  const historyPath = join(homedir(), ".zsh_history");
  let recentCommands: string[] = [];

  try {
    const history = readFileSync(historyPath, "utf8");
    const lines = history.split("\n").slice(-400);
    recentCommands = lines
      .map((line) => {
        const parts = line.split(";");
        const command = parts[1] ?? parts[0] ?? "";
        return command.trim();
      })
      .filter((line) => line.length > 0)
      .slice(-20);
  } catch {
    recentCommands = [];
  }

  return {
    activeApp,
    activeWindowTitle,
    recentCommands
  };
}

function includesAny(value: string, tokens: string[]): boolean {
  const normalized = value.toLowerCase();
  return tokens.some((token) => normalized.includes(token));
}

export function analyzeObjective(context: ChromeContextPayload, signals: LocalSignals): ObjectiveAnalysis {
  const titles = context.tabs.map((tab) => `${tab.title} ${tab.url}`.toLowerCase());
  const tabText = titles.join(" \n");
  const activeText = `${signals.activeApp} ${signals.activeWindowTitle}`.toLowerCase();
  const commandText = signals.recentCommands.join(" \n").toLowerCase();

  const authTokens = ["auth", "login", "signin", "token", "usecontext", "user is null"];
  const reactTokens = ["react", "jsx", "localhost:3000", "vite", "npm run dev", "stack overflow"];

  let score = 0;
  const evidence: string[] = [];

  if (includesAny(tabText, authTokens)) {
    score += 0.35;
    evidence.push("Chrome tabs mention auth/login related terms");
  }

  if (includesAny(tabText, reactTokens)) {
    score += 0.25;
    evidence.push("React/localhost/debug references found in tabs");
  }

  if (includesAny(activeText, ["code", "login", "auth", "jsx"])) {
    score += 0.2;
    evidence.push(`Active window suggests coding focus (${signals.activeWindowTitle || "unknown window"})`);
  }

  if (includesAny(commandText, ["npm test", "npm run dev", "pnpm test", "vitest"])) {
    score += 0.2;
    evidence.push("Recent terminal history includes dev/test commands");
  }

  const confidence = Math.max(0.35, Math.min(0.95, score));

  if (score >= 0.65) {
    return {
      objective: "Debugging React auth/login issue",
      mode: "debugging",
      confidence,
      evidence,
      suggestedFiles: [
        "src/Login.jsx",
        "src/AuthContext.jsx",
        "src/api/auth.js",
        "src/Login.test.jsx"
      ],
      suggestedCommands: ["npm test -- auth", "npm run dev", "git diff"],
      suggestedTabs: [
        "http://localhost:3000",
        "https://react.dev/reference/react/useContext",
        "https://stackoverflow.com"
      ]
    };
  }

  return {
    objective: "General coding task",
    mode: "coding",
    confidence,
    evidence: evidence.length > 0 ? evidence : ["No strong objective signal yet"],
    suggestedFiles: ["src/main.ts", "src/App.tsx"],
    suggestedCommands: ["npm run dev", "git status"],
    suggestedTabs: ["http://localhost:3000"]
  };
}
