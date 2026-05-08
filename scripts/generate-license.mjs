#!/usr/bin/env node
// Usage:
//   node scripts/generate-license.mjs           → generates 1 PRO key
//   node scripts/generate-license.mjs team 5    → generates 5 TEAM keys
//   node scripts/generate-license.mjs lifetime  → generates 1 LIFETIME key
//
// Set FLOWOS_LICENSE_SECRET env var to match the one in your app (default: flowos-dev-secret-2026)

import { createHmac } from "node:crypto";

const SECRET = process.env.FLOWOS_LICENSE_SECRET ?? "flowos-dev-secret-2026";

const PLAN_MAP = {
  pro:      "PRO1",
  team:     "TEAM",
  lifetime: "LTME",
  demo:     "DEMO",
};

const arg1 = process.argv[2]?.toLowerCase() ?? "pro";
const count = parseInt(process.argv[3] ?? "1", 10);
const planCode = PLAN_MAP[arg1] ?? "PRO1";
const planName = arg1;

function randomHex(bytes) {
  return Array.from({ length: bytes }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0")
  ).join("").toUpperCase();
}

function computeCheck(payload) {
  return createHmac("sha256", SECRET).update(payload).digest("hex").slice(0, 8).toUpperCase();
}

function generateKey() {
  const rand1 = randomHex(4);
  const rand2 = randomHex(4);
  const payload = `${planCode}-${rand1}-${rand2}`;
  const check = computeCheck(payload);
  return `FLOWOS-${payload}-${check}`;
}

console.log(`\nFlowOS License Key Generator`);
console.log(`Plan: ${planName.toUpperCase()} (${planCode})`);
console.log(`Count: ${count}`);
console.log(`Secret: ${SECRET.slice(0, 8)}...\n`);

for (let i = 0; i < count; i++) {
  console.log(generateKey());
}
