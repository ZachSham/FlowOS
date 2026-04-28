import { net } from "electron";
import type { LocalInferenceConfig } from "./localInferenceConfig.js";

export interface LocalInferenceMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

export interface LocalChatCompletionRequest {
  model: string;
  messages: LocalInferenceMessage[];
  tools?: unknown;
  temperature?: number;
  max_tokens?: number;
  response_format?: unknown;
}

export interface LocalChatCompletionResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
}

function truncateForError(input: string, maxLength = 500): string {
  const normalized = input.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
}

export async function callLocalChatCompletion(
  config: LocalInferenceConfig,
  request: Omit<LocalChatCompletionRequest, "model"> & { model?: string }
): Promise<LocalChatCompletionResponse> {
  const electronFetch = (net as unknown as { fetch?: typeof fetch } | undefined)?.fetch;
  const activeFetch = electronFetch ?? fetch;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

  try {
    const response = await activeFetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify({
        ...request,
        model: request.model ?? config.model
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = truncateForError(await response.text());
      throw new Error(
        `Local inference request failed (${response.status}) at ${endpoint}: ${errorText}`
      );
    }

    const data = (await response.json()) as LocalChatCompletionResponse;
    if (!Array.isArray(data.choices) || data.choices.length === 0) {
      throw new Error("Local inference returned no choices.");
    }

    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Local inference timed out after ${config.timeoutMs}ms. Is Ollama running at ${endpoint}?`
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
