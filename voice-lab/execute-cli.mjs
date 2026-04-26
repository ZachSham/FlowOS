import { executeTranscript } from "./executor.mjs";

const transcript = process.argv.slice(2).join(" ").trim();

if (!transcript) {
  console.error('Usage: node execute-cli.mjs "move vscode to the right"');
  process.exit(1);
}

const result = await executeTranscript(transcript);
console.log(JSON.stringify(result, null, 2));

process.exit(result.ok ? 0 : 2);

