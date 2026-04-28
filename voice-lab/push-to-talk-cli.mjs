import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { executeTranscript, shutdownExecutor } from "./executor.mjs";
import { localDefaults } from "./local-config.mjs";
import { transcribeWavFile } from "./local-stt.mjs";

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
  const outputBase = `${audioPath}.transcript`;
  return await transcribeWavFile(audioPath, outputBase);
}

function printHelp() {
  console.log("Usage:");
  console.log('  node voice-lab/push-to-talk-cli.mjs              # interactive push-to-talk');
  console.log('  node voice-lab/push-to-talk-cli.mjs --once "open vscode"');
  console.log("");
  console.log("Environment:");
  console.log("  VOICE_LAB_LLM_ENABLED=1              optional LLM fallback parser");
  console.log(`  FLOWOS_INFERENCE_BASE_URL=${localDefaults.inferenceBaseUrl}`);
  console.log(`  FLOWOS_INFERENCE_MODEL=${localDefaults.inferenceModel}`);
  console.log("  FLOWOS_INFERENCE_STRICT_LOCAL=1");
  console.log("  FLOWOS_WHISPER_BIN=/path/to/whisper-cli");
  console.log("  FLOWOS_WHISPER_MODEL=/path/to/ggml-base.en.bin");
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
