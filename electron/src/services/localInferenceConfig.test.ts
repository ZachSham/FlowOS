import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  localInferenceDefaults,
  resolveLocalInferenceConfig,
  resolveLocalSttConfig
} from "./localInferenceConfig.js";

describe("localInferenceConfig", () => {
  const savedEnv = { ...process.env };
  const scopedKeys = [
    "FLOWOS_INFERENCE_PROVIDER",
    "FLOWOS_INFERENCE_BASE_URL",
    "FLOWOS_INFERENCE_MODEL",
    "FLOWOS_INFERENCE_TIMEOUT_MS",
    "FLOWOS_INFERENCE_STRICT_LOCAL",
    "FLOWOS_INFERENCE_API_KEY",
    "FLOWOS_WHISPER_BIN",
    "FLOWOS_WHISPER_MODEL",
    "FLOWOS_WHISPER_THREADS",
    "FLOWOS_WHISPER_LANGUAGE",
    "FLOWOS_FFMPEG_BIN"
  ];

  beforeEach(() => {
    for (const key of scopedKeys) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of scopedKeys) {
      if (key in savedEnv) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("returns local inference defaults", () => {
    const resolved = resolveLocalInferenceConfig();
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    expect(resolved.value.baseUrl).toBe(localInferenceDefaults.baseUrl);
    expect(resolved.value.model).toBe(localInferenceDefaults.model);
    expect(resolved.value.timeoutMs).toBe(localInferenceDefaults.timeoutMs);
    expect(resolved.value.strictLocal).toBe(true);
  });

  it("allows optional API key", () => {
    process.env["FLOWOS_INFERENCE_API_KEY"] = "local-token";
    const resolved = resolveLocalInferenceConfig();
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    expect(resolved.value.apiKey).toBe("local-token");
  });

  it("fails when whisper binary is missing", () => {
    const resolved = resolveLocalSttConfig();
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;

    expect(resolved.error).toContain("FLOWOS_WHISPER_BIN");
  });

  it("parses whisper defaults when required vars are set", () => {
    process.env["FLOWOS_WHISPER_BIN"] = "/usr/local/bin/whisper-cli";
    process.env["FLOWOS_WHISPER_MODEL"] = "/models/ggml-base.en.bin";

    const resolved = resolveLocalSttConfig();
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    expect(resolved.value.ffmpegBin).toBe(localInferenceDefaults.ffmpegBin);
    expect(resolved.value.whisperThreads).toBe(localInferenceDefaults.whisperThreads);
    expect(resolved.value.whisperLanguage).toBe(localInferenceDefaults.whisperLanguage);
  });
});
