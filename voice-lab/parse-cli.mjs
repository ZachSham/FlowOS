import { parseVoiceTranscriptWithFallback } from "./llm-parser.mjs";

const transcript = process.argv.slice(2).join(" ").trim();

if (!transcript) {
  console.error('Usage: node parse-cli.mjs "move vscode to the right"');
  process.exit(1);
}

const result = await parseVoiceTranscriptWithFallback(transcript);
console.log(JSON.stringify(result, null, 2));

if (result.commandString) {
  console.log("\nCommand String:");
  console.log(result.commandString);
}
