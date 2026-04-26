import type { NativeMethod, NativeRequestPayloadMap } from "@flowos/shared";
import { startSwiftHelperBridge } from "../bridge/swiftHelper.js";
import { applySplitLayout, type ApplySplitLayoutInput } from "./splitLayout.js";
import { createWindowEditor } from "./windowEditor.js";

const [methodArg, payloadArg] = process.argv.slice(2);

if (!methodArg) {
  console.error("Usage: npm run native -- <method> '<json-payload>'");
  console.error("Example: npm run native -- window.raise '{\"windowId\":\"ax:123:0\"}'");
  process.exit(1);
}

type LocalMethod = NativeMethod | "layout.applySplit";

const method = methodArg as LocalMethod;
let payload: NativeRequestPayloadMap[NativeMethod] | ApplySplitLayoutInput;

try {
  payload = payloadArg ? JSON.parse(payloadArg) : {};
} catch {
  console.error(`Invalid JSON payload: ${payloadArg}`);
  process.exit(1);
}

const bridge = await startSwiftHelperBridge();

try {
  const editor = createWindowEditor(bridge);
  const result =
    method === "layout.applySplit"
      ? await applySplitLayout(editor, payload as ApplySplitLayoutInput)
      : await bridge.request(method, payload as NativeRequestPayloadMap[NativeMethod]);
  console.log(JSON.stringify(result, null, 2));
} finally {
  bridge.stop();
}
