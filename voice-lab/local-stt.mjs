import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolveLocalSttConfig } from "./local-config.mjs";

function formatSpawnError(command, error) {
  if (error && typeof error === "object" && error.code === "ENOENT") {
    return `Command not found: ${command}. Install it and/or set its env path correctly.`;
  }

  return error instanceof Error ? error.message : String(error);
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
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

function buildWhisperArgs(inputWavPath, outputBasePath, config) {
  return [
    "-m",
    config.whisperModel,
    "-f",
    inputWavPath,
    "-l",
    config.whisperLanguage,
    "-t",
    String(config.whisperThreads),
    "-otxt",
    "-nt",
    "-of",
    outputBasePath
  ];
}

function parseWhisperText(stdout, textFile) {
  const fromFile = String(textFile ?? "").trim();
  if (fromFile) {
    return fromFile;
  }

  const fromStdout = stdout
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .trim();

  return fromStdout;
}

export async function transcribeWavFile(inputWavPath, outputBasePath) {
  const resolved = resolveLocalSttConfig();
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }

  const config = resolved.value;
  const result = await runProcess(config.whisperBin, buildWhisperArgs(inputWavPath, outputBasePath, config));

  let transcriptFile = "";
  try {
    transcriptFile = await readFile(`${outputBasePath}.txt`, "utf8");
  } catch {
    transcriptFile = "";
  }

  const transcript = parseWhisperText(result.stdout, transcriptFile);
  if (!transcript) {
    throw new Error(
      "Whisper transcription returned empty text. Verify FLOWOS_WHISPER_MODEL points to a valid model file."
    );
  }

  return transcript;
}
