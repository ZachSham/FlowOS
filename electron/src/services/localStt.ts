import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveLocalSttConfig } from "./localInferenceConfig.js";

interface ProcessResult {
  stdout: string;
  stderr: string;
}

function formatSpawnError(command: string, error: unknown): string {
  if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") {
    return `Command not found: ${command}. Install it and/or set its env path correctly.`;
  }

  return error instanceof Error ? error.message : String(error);
}

async function runProcess(command: string, args: string[]): Promise<ProcessResult> {
  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.once("error", (error) => {
      reject(new Error(formatSpawnError(command, error)));
    });

    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const signalText = signal ? ` signal=${signal}` : "";
      reject(
        new Error(
          `${command} failed (code=${String(code)}${signalText}). stderr: ${stderr.trim() || "<empty>"}`
        )
      );
    });
  });
}

function whisperOutputPaths(tmpDir: string) {
  const base = path.join(tmpDir, "transcript");
  return {
    base,
    txt: `${base}.txt`
  };
}

export function buildFfmpegArgs(inputWebmPath: string, outputWavPath: string): string[] {
  return [
    "-y",
    "-i",
    inputWebmPath,
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    outputWavPath
  ];
}

export function buildWhisperArgs(inputWavPath: string, outputBasePath: string, input: {
  modelPath: string;
  language: string;
  threads: number;
}): string[] {
  return [
    "-m",
    input.modelPath,
    "-f",
    inputWavPath,
    "-l",
    input.language,
    "-t",
    String(input.threads),
    "-otxt",
    "-nt",
    "-of",
    outputBasePath
  ];
}

function parseWhisperText(stdout: string, fileText: string | null): string {
  const fileTranscript = fileText?.trim() ?? "";
  if (fileTranscript) {
    return fileTranscript;
  }

  const stdoutTranscript = stdout
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .trim();

  return stdoutTranscript;
}

export async function transcribeWebmAudio(audioData: Uint8Array): Promise<string> {
  const sttConfigResult = resolveLocalSttConfig();
  if (!sttConfigResult.ok) {
    throw new Error(sttConfigResult.error);
  }

  const sttConfig = sttConfigResult.value;
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "flowos-local-stt-"));
  const webmPath = path.join(tmpDir, "input.webm");
  const wavPath = path.join(tmpDir, "input.wav");
  const outputPaths = whisperOutputPaths(tmpDir);

  try {
    await writeFile(webmPath, audioData);

    await runProcess(sttConfig.ffmpegBin, buildFfmpegArgs(webmPath, wavPath));

    const whisperResult = await runProcess(
      sttConfig.whisperBin,
      buildWhisperArgs(wavPath, outputPaths.base, {
        modelPath: sttConfig.whisperModel,
        language: sttConfig.whisperLanguage,
        threads: sttConfig.whisperThreads
      })
    );

    let whisperFileText: string | null = null;
    try {
      whisperFileText = await readFile(outputPaths.txt, "utf8");
    } catch {
      whisperFileText = null;
    }

    const transcript = parseWhisperText(whisperResult.stdout, whisperFileText);
    if (!transcript) {
      throw new Error(
        "Whisper transcription returned empty text. Verify FLOWOS_WHISPER_MODEL points to a valid model file."
      );
    }

    return transcript;
  } catch (error) {
    throw new Error(
      `[local-stt] ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
