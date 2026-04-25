import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const outDir = resolve("dist");
mkdirSync(outDir, { recursive: true });
copyFileSync(resolve("public/manifest.json"), resolve(outDir, "manifest.json"));

