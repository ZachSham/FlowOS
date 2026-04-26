import { parseVoiceTranscript } from "./parser.mjs";

const transcript = process.argv.slice(2).join(" ").trim();

if (!transcript) {
  console.error("Usage: node parse-cli.mjs \"open vscode\"");
  process.exit(1);
}

const result = parseVoiceTranscript(transcript);
console.log(JSON.stringify(result, null, 2));

if (result.commandString) {
  console.log("\nCommand String:");
  console.log(result.commandString);
}
