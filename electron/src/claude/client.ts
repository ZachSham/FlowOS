import OpenAI from "openai";
import type { TaskState, Suggestion, FlowMode } from "@flowos/shared";

const SYSTEM_PROMPT = `You are FlowOS, an AI that observes a developer's VS Code state and infers what they are working on.

Given a snapshot of their editor state, respond with ONLY valid JSON — no markdown fences, no prose, no explanation outside the JSON object.

The JSON must match this exact shape:
{
  "title": "short task title (max 8 words)",
  "mode": "coding|debugging|design|writing|researching|meeting|study",
  "substate": "one sentence describing current focus",
  "confidence": 0.85,
  "reasoning": "2-3 sentences explaining why you inferred this from the given context",
  "suggestions": [
    {
      "kind": "file|command|tab",
      "title": "short action title",
      "description": "one sentence explaining why this is relevant",
      "payload": "file path, shell command, or URL",
      "confidence": 0.88
    }
  ]
}

Return exactly 3 suggestions. Prefer file suggestions when errors are present. Use lower confidence when context is ambiguous.`;

let _client: OpenAI | null = null;

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[ai] OPENAI_API_KEY not set — skipping analysis");
    return null;
  }
  if (!_client) _client = new OpenAI({ apiKey });
  return _client;
}

export interface SnapshotInput {
  activeFile?: string;
  openTabs: string[];
  diagnostics: Array<{ file: string; severity: string; message: string }>;
  recentEdits: string[];
}

export interface ClaudeInsight {
  taskState: TaskState;
  suggestions: Suggestion[];
  reasoning: string;
}

interface RawResponse {
  title: string;
  mode: FlowMode;
  substate: string;
  confidence: number;
  reasoning: string;
  suggestions: Array<{
    kind: "file" | "command" | "tab";
    title: string;
    description: string;
    payload: string;
    confidence: number;
  }>;
}

export async function analyzeSnapshot(
  snapshot: SnapshotInput
): Promise<ClaudeInsight | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserContent(snapshot) },
      ],
    });

    const text = response.choices[0]?.message.content ?? "";
    if (!text) {
      console.warn("[ai] empty response content");
      return null;
    }
    const parsed = JSON.parse(text) as RawResponse;
    if (
      typeof parsed.title !== "string" ||
      !Array.isArray(parsed.suggestions) ||
      typeof parsed.reasoning !== "string"
    ) {
      console.error("[ai] response failed shape validation", parsed);
      return null;
    }

    const taskState: TaskState = {
      id: `task-${Date.now()}`,
      title: parsed.title,
      mode: parsed.mode,
      substate: parsed.substate,
      confidence: parsed.confidence,
      updatedAt: new Date().toISOString(),
      signals: [],
    };

    const suggestions: Suggestion[] = parsed.suggestions.map((s) => ({
      id: crypto.randomUUID(),
      kind: s.kind,
      title: s.title,
      description: s.description,
      payload: s.payload,
      confidence: s.confidence,
      source: "model" as const,
    }));

    return { taskState, suggestions, reasoning: parsed.reasoning };
  } catch (error) {
    console.error("[ai] error:", error);
    return null;
  }
}

function buildUserContent(s: SnapshotInput): string {
  const lines: string[] = [];
  if (s.activeFile) lines.push(`Active file: ${s.activeFile}`);
  if (s.openTabs.length > 0)
    lines.push(`Open tabs: ${s.openTabs.slice(0, 10).join(", ")}`);
  if (s.recentEdits.length > 0)
    lines.push(`Recent edits: ${s.recentEdits.slice(0, 5).join(", ")}`);
  if (s.diagnostics.length > 0) {
    lines.push(`Diagnostics:`);
    for (const d of s.diagnostics.slice(0, 10)) {
      lines.push(`  [${d.severity}] ${d.file}: ${d.message}`);
    }
  }
  if (lines.length === 0) lines.push("No context available yet.");
  return lines.join("\n");
}
