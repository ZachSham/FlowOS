import { describe, expect, it } from "vitest";
import { buildFfmpegArgs, buildWhisperArgs } from "./localStt.js";

describe("localStt command builders", () => {
  it("builds ffmpeg wav conversion args", () => {
    const args = buildFfmpegArgs("/tmp/input.webm", "/tmp/output.wav");
    expect(args).toEqual([
      "-y",
      "-i",
      "/tmp/input.webm",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      "/tmp/output.wav"
    ]);
  });

  it("builds whisper.cpp args for transcript output", () => {
    const args = buildWhisperArgs("/tmp/input.wav", "/tmp/transcript", {
      modelPath: "/models/ggml-base.en.bin",
      language: "en",
      threads: 4
    });

    expect(args).toEqual([
      "-m",
      "/models/ggml-base.en.bin",
      "-f",
      "/tmp/input.wav",
      "-l",
      "en",
      "-t",
      "4",
      "-otxt",
      "-nt",
      "-of",
      "/tmp/transcript"
    ]);
  });
});
