const DEFAULTS = {
  inferenceProvider: "ollama",
  inferenceBaseUrl: "http://127.0.0.1:11434/v1",
  inferenceModel: "qwen2.5:14b-instruct",
  inferenceTimeoutMs: 12000,
  whisperThreads: 4,
  whisperLanguage: "en",
  ffmpegBin: "ffmpeg"
};

function readTrimmedEnv(name) {
  return String(process.env[name] ?? "").trim();
}

function parsePositiveInteger(input, fallback) {
  if (!input) {
    return fallback;
  }

  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function parseBoolean(input, fallback) {
  const normalized = String(input ?? "").trim().toLowerCase();
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

export function resolveLocalInferenceConfig() {
  const provider = readTrimmedEnv("FLOWOS_INFERENCE_PROVIDER") || DEFAULTS.inferenceProvider;
  if (provider !== "ollama") {
    return {
      ok: false,
      error: `Unsupported FLOWOS_INFERENCE_PROVIDER: ${provider}. Expected \"ollama\".`
    };
  }

  const baseUrl = (readTrimmedEnv("FLOWOS_INFERENCE_BASE_URL") || DEFAULTS.inferenceBaseUrl).replace(/\/$/, "");
  const model = readTrimmedEnv("FLOWOS_INFERENCE_MODEL") || DEFAULTS.inferenceModel;
  const timeoutMs = parsePositiveInteger(
    readTrimmedEnv("FLOWOS_INFERENCE_TIMEOUT_MS"),
    DEFAULTS.inferenceTimeoutMs
  );
  const strictLocal = parseBoolean(readTrimmedEnv("FLOWOS_INFERENCE_STRICT_LOCAL"), true);
  const apiKey = readTrimmedEnv("FLOWOS_INFERENCE_API_KEY") || undefined;

  if (!strictLocal) {
    return {
      ok: false,
      error:
        "FLOWOS_INFERENCE_STRICT_LOCAL must be enabled for Voice Lab local mode. Set FLOWOS_INFERENCE_STRICT_LOCAL=1."
    };
  }

  return {
    ok: true,
    value: {
      provider,
      baseUrl,
      model,
      timeoutMs,
      strictLocal,
      apiKey
    }
  };
}

export function resolveLocalSttConfig() {
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

  return {
    ok: true,
    value: {
      whisperBin,
      whisperModel,
      whisperThreads: parsePositiveInteger(
        readTrimmedEnv("FLOWOS_WHISPER_THREADS"),
        DEFAULTS.whisperThreads
      ),
      whisperLanguage: readTrimmedEnv("FLOWOS_WHISPER_LANGUAGE") || DEFAULTS.whisperLanguage,
      ffmpegBin: readTrimmedEnv("FLOWOS_FFMPEG_BIN") || DEFAULTS.ffmpegBin
    }
  };
}

export const localDefaults = {
  inferenceBaseUrl: DEFAULTS.inferenceBaseUrl,
  inferenceModel: DEFAULTS.inferenceModel,
  inferenceTimeoutMs: DEFAULTS.inferenceTimeoutMs,
  whisperThreads: DEFAULTS.whisperThreads,
  whisperLanguage: DEFAULTS.whisperLanguage,
  ffmpegBin: DEFAULTS.ffmpegBin
};
