import type { NativeMethod, NativeRequestPayloadMap } from "@flowos/shared";
import { startSwiftHelperBridge } from "../bridge/swiftHelper.js";

const [methodArg, payloadArg] = process.argv.slice(2);

if (!methodArg) {
  console.error("Usage: npm run native -- <method> '<json-payload>'");
  console.error("Example: npm run native -- window.raise '{\"windowId\":\"ax:123:0\"}'");
  process.exit(1);
}

const method = methodArg as NativeMethod;
let payload: NativeRequestPayloadMap[NativeMethod];

try {
  payload = payloadArg ? JSON.parse(payloadArg) : {};
} catch {
  console.error(`Invalid JSON payload: ${payloadArg}`);
  process.exit(1);
}

const bridge = await startSwiftHelperBridge();

try {
  const result = await bridge.request(method, payload);
  console.log(JSON.stringify(result, null, 2));
} finally {
  bridge.stop();
}
