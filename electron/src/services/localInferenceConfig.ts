export interface LocalInferenceConfig {
  provider: "ollama";
  baseUrl: string;
  model: string;
  timeoutMs: number;
  strictLocal: boolean;
  apiKey?: string;
}

export interface LocalSttConfig {
  whisperBin: string;
  whisperModel: string;
  whisperThreads: number;
  whisperLanguage: string;
  ffmpegBin: string;
}

interface ResolveSuccess<T> {
  ok: true;
  value: T;
}

interface ResolveFailure {
  ok: false;
  error: string;
}

export type ResolveResult<T> = ResolveSuccess<T> | ResolveFailure;

const DEFAULT_INFERENCE_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_INFERENCE_MODEL = "qwen2.5:14b-instruct";
const DEFAULT_INFERENCE_TIMEOUT_MS = 12_000;
const DEFAULT_WHISPER_THREADS = 4;
const DEFAULT_WHISPER_LANGUAGE = "en";
const DEFAULT_FFMPEG_BIN = "ffmpeg";

function readTrimmedEnv(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function parseBooleanEnv(value: string, fallback: boolean): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parsePositiveIntegerEnv(value: string, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

export function resolveLocalInferenceConfig(): ResolveResult<LocalInferenceConfig> {
  const provider = readTrimmedEnv("FLOWOS_INFERENCE_PROVIDER") || "ollama";
  if (provider !== "ollama") {
    return {
      ok: false,
      error: `Unsupported FLOWOS_INFERENCE_PROVIDER: ${provider}. Expected \"ollama\".`
    };
  }

  const baseUrl = (readTrimmedEnv("FLOWOS_INFERENCE_BASE_URL") || DEFAULT_INFERENCE_BASE_URL).replace(/\/$/, "");
  const model = readTrimmedEnv("FLOWOS_INFERENCE_MODEL") || DEFAULT_INFERENCE_MODEL;
  const timeoutMs = parsePositiveIntegerEnv(
    readTrimmedEnv("FLOWOS_INFERENCE_TIMEOUT_MS"),
    DEFAULT_INFERENCE_TIMEOUT_MS
  );
  const strictLocal = parseBooleanEnv(readTrimmedEnv("FLOWOS_INFERENCE_STRICT_LOCAL"), true);
  const apiKey = readTrimmedEnv("FLOWOS_INFERENCE_API_KEY") || undefined;

  if (!baseUrl) {
    return {
      ok: false,
      error: "FLOWOS_INFERENCE_BASE_URL must be a non-empty URL."
    };
  }

  if (!model) {
    return {
      ok: false,
      error: "FLOWOS_INFERENCE_MODEL must be set to a local model name."
    };
  }

  return {
    ok: true,
    value: {
      provider: "ollama",
      baseUrl,
      model,
      timeoutMs,
      strictLocal,
      apiKey
    }
  };
}

export function resolveLocalSttConfig(): ResolveResult<LocalSttConfig> {
  const whisperBin = readTrimmedEnv("FLOWOS_WHISPER_BIN");
  if (!whisperBin) {
    return {
      ok: false,
      error:
        "FLOWOS_WHISPER_BIN is required. Point it to your whisper.cpp binary (for example: /opt/homebrew/bin/whisper-cli)."
    };
  }

  const whisperModel = readTrimmedEnv("FLOWOS_WHISPER_MODEL");
  if (!whisperModel) {
    return {
      ok: false,
      error:
        "FLOWOS_WHISPER_MODEL is required. Point it to your local whisper.cpp model file (for example: /path/to/ggml-base.en.bin)."
    };
  }

  const whisperThreads = parsePositiveIntegerEnv(
    readTrimmedEnv("FLOWOS_WHISPER_THREADS"),
    DEFAULT_WHISPER_THREADS
  );
  const whisperLanguage = readTrimmedEnv("FLOWOS_WHISPER_LANGUAGE") || DEFAULT_WHISPER_LANGUAGE;
  const ffmpegBin = readTrimmedEnv("FLOWOS_FFMPEG_BIN") || DEFAULT_FFMPEG_BIN;

  return {
    ok: true,
    value: {
      whisperBin,
      whisperModel,
      whisperThreads,
      whisperLanguage,
      ffmpegBin
    }
  };
}

export const localInferenceDefaults = {
  baseUrl: DEFAULT_INFERENCE_BASE_URL,
  model: DEFAULT_INFERENCE_MODEL,
  timeoutMs: DEFAULT_INFERENCE_TIMEOUT_MS,
  whisperThreads: DEFAULT_WHISPER_THREADS,
  whisperLanguage: DEFAULT_WHISPER_LANGUAGE,
  ffmpegBin: DEFAULT_FFMPEG_BIN
};
