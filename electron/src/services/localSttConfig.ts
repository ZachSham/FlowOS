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

const DEFAULT_WHISPER_THREADS = 4;
const DEFAULT_WHISPER_LANGUAGE = "en";
const DEFAULT_FFMPEG_BIN = "ffmpeg";

function readTrimmedEnv(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function parsePositiveIntegerEnv(value: string, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export function resolveLocalSttConfig(): ResolveResult<LocalSttConfig> {
  const whisperBin = readTrimmedEnv("FLOWOS_WHISPER_BIN");
  if (!whisperBin) {
    return {
      ok: false,
      error:
        "FLOWOS_WHISPER_BIN is required for local STT. Point it to your whisper.cpp binary (e.g. /opt/homebrew/bin/whisper-cli)."
    };
  }

  const whisperModel = readTrimmedEnv("FLOWOS_WHISPER_MODEL");
  if (!whisperModel) {
    return {
      ok: false,
      error:
        "FLOWOS_WHISPER_MODEL is required for local STT. Point it to your .bin model file (e.g. /path/to/ggml-base.en.bin)."
    };
  }

  return {
    ok: true,
    value: {
      whisperBin,
      whisperModel,
      whisperThreads: parsePositiveIntegerEnv(readTrimmedEnv("FLOWOS_WHISPER_THREADS"), DEFAULT_WHISPER_THREADS),
      whisperLanguage: readTrimmedEnv("FLOWOS_WHISPER_LANGUAGE") || DEFAULT_WHISPER_LANGUAGE,
      ffmpegBin: readTrimmedEnv("FLOWOS_FFMPEG_BIN") || DEFAULT_FFMPEG_BIN
    }
  };
}

export function isLocalSttConfigured(): boolean {
  return Boolean(
    process.env["FLOWOS_WHISPER_BIN"]?.trim() &&
    process.env["FLOWOS_WHISPER_MODEL"]?.trim()
  );
}
