import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { executeTranscript, shutdownExecutor } from "./executor.mjs";

function hasCommand(command) {
  const result = spawnSync("bash", ["-lc", `command -v ${command}`], {
    stdio: "ignore"
  });

  return result.status === 0;
}

function chooseRecorder() {
  const preferred = String(process.env.VOICE_LAB_RECORDER ?? "").trim().toLowerCase();

  if ((preferred === "ffmpeg" || !preferred) && hasCommand("ffmpeg")) {
    const input = String(process.env.VOICE_LAB_AVFOUNDATION_INPUT ?? ":0");
    return {
      name: "ffmpeg",
      buildArgs: (outputPath) => [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "avfoundation",
        "-i",
        input,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-acodec",
        "pcm_s16le",
        outputPath
      ]
    };
  }

  if ((preferred === "rec" || !preferred) && hasCommand("rec")) {
    return {
      name: "rec",
      buildArgs: (outputPath) => ["-q", "-c", "1", "-r", "16000", "-b", "16", outputPath]
    };
  }

  return null;
}

async function transcribeAudio(audioPath) {
  const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const model = String(process.env.VOICE_LAB_STT_MODEL ?? "whisper-1").trim();
  const baseUrl = String(process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");

  const form = new FormData();
  form.append("model", model);
  form.append("file", new Blob([await readFile(audioPath)], { type: "audio/wav" }), "speech.wav");

  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`
    },
    body: form
  });

  const responseText = await response.text();
  let payload = {};

  try {
    payload = JSON.parse(responseText);
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(`Transcription failed (${response.status}): ${responseText}`);
  }

  if (typeof payload.text !== "string" || !payload.text.trim()) {
    throw new Error("Transcription response did not include text.");
  }

  return payload.text.trim();
}

function printHelp() {
  console.log("Usage:");
  console.log('  node voice-lab/push-to-talk-cli.mjs              # interactive push-to-talk');
  console.log('  node voice-lab/push-to-talk-cli.mjs --once "open vscode"');
  console.log("");
  console.log("Environment:");
  console.log("  OPENAI_API_KEY=...                   required for speech transcription");
  console.log("  VOICE_LAB_LLM_ENABLED=1              optional LLM fallback parser");
  console.log("  VOICE_LAB_LLM_MODEL=gpt-4.1-mini     optional parser model");
  console.log("  VOICE_LAB_STT_MODEL=whisper-1        optional transcription model");
  console.log("  VOICE_LAB_RECORDER=ffmpeg|rec        optional recorder override");
  console.log("  VOICE_LAB_AVFOUNDATION_INPUT=:0      ffmpeg input device (macOS)");
}

async function runOnce(transcript) {
  const result = await executeTranscript(transcript);
  console.log(JSON.stringify(result, null, 2));
  await shutdownExecutor();
  process.exit(result.ok ? 0 : 2);
}

function waitForExit(childProcess) {
  return new Promise((resolve, reject) => {
    childProcess.once("error", reject);
    childProcess.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
}

async function runInteractive() {
  const recorder = chooseRecorder();
  if (!recorder) {
    console.error("No supported audio recorder found.");
    console.error("Install one:");
    console.error("  brew install ffmpeg");
    console.error("or");
    console.error("  brew install sox");
    process.exit(1);
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "flowos-voice-"));
  let activeRecording = null;
  let quitting = false;

  const cleanup = async () => {
    if (activeRecording?.process && !activeRecording.process.killed) {
      activeRecording.process.kill("SIGINT");
      await waitForExit(activeRecording.process).catch(() => {});
    }

    await shutdownExecutor();
    await rm(tmpDir, { recursive: true, force: true });
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const showPrompt = () => {
    if (activeRecording) {
      rl.setPrompt("stop> ");
    } else {
      rl.setPrompt("ptt> ");
    }

    rl.prompt();
  };

  console.log(`Push-to-talk ready (recorder: ${recorder.name})`);
  console.log("Press ENTER to start recording, ENTER again to stop and execute.");
  console.log("Type q then ENTER to quit.");
  showPrompt();

  rl.on("line", async (line) => {
    const trimmed = line.trim();

    if (!activeRecording) {
      if (trimmed.toLowerCase() === "q" || trimmed.toLowerCase() === "quit") {
        quitting = true;
        rl.close();
        return;
      }

      const outputPath = path.join(tmpDir, `voice-${Date.now()}.wav`);
      const processRef = spawn(recorder.name, recorder.buildArgs(outputPath), {
        stdio: "ignore"
      });

      activeRecording = {
        process: processRef,
        outputPath
      };

      console.log("Recording... press ENTER to stop.");
      showPrompt();
      return;
    }

    const current = activeRecording;
    activeRecording = null;

    try {
      current.process.kill("SIGINT");
      await waitForExit(current.process);

      console.log("Transcribing...");
      const transcript = await transcribeAudio(current.outputPath);
      console.log(`Transcript: ${transcript}`);
      console.log("Executing...");

      const result = await executeTranscript(transcript);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Voice command failed.");
    } finally {
      showPrompt();
    }
  });

  rl.on("close", async () => {
    await cleanup();
    process.exit(quitting ? 0 : 1);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, async () => {
      quitting = true;
      rl.close();
    });
  }
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

const onceIndex = args.indexOf("--once");
if (onceIndex >= 0) {
  const transcript = args.slice(onceIndex + 1).join(" ").trim();
  if (!transcript) {
    console.error('Usage: node voice-lab/push-to-talk-cli.mjs --once "open vscode"');
    process.exit(1);
  }

  await runOnce(transcript);
} else {
  await runInteractive();
}
