#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT_DIR/src/main.swift"
OUT="$ROOT_DIR/bin/flowos-window-helper"

mkdir -p "$ROOT_DIR/bin"

swiftc "$SRC" -O -o "$OUT"

echo "Built $OUT"
