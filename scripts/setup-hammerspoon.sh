#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

say() { printf "%b\n" "$1"; }
step() { say "${BLUE}==>${NC} $1"; }
ok() { say "${GREEN}✓${NC} $1"; }
warn() { say "${YELLOW}!${NC} $1"; }

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FLOWOS_HS_HELPER="$REPO_ROOT/scripts/flowos-hammerspoon.lua"
HS_DIR="$HOME/.hammerspoon"
HS_INIT="$HS_DIR/init.lua"

ensure_brew() {
  if command -v brew >/dev/null 2>&1; then
    ok "Homebrew found"
    return
  fi

  warn "Homebrew not found. Install Homebrew first."
  exit 1
}

install_hammerspoon() {
  if brew list --cask hammerspoon >/dev/null 2>&1; then
    ok "Hammerspoon already installed"
    return
  fi

  step "Installing Hammerspoon"
  brew install --cask hammerspoon
  ok "Hammerspoon installed"
}

ensure_init_loader() {
  mkdir -p "$HS_DIR"
  touch "$HS_INIT"

  if grep -q "flowos-hammerspoon.lua" "$HS_INIT"; then
    ok "FlowOS loader already present in ~/.hammerspoon/init.lua"
    return
  fi

  step "Adding FlowOS helper loader to ~/.hammerspoon/init.lua"
  {
    echo ""
    echo "-- FlowOS helper"
    echo "local ok, err = pcall(dofile, \"$FLOWOS_HS_HELPER\")"
    echo "if not ok then print(\"[FlowOS] helper load failed: \" .. tostring(err)) end"
  } >> "$HS_INIT"
  ok "FlowOS helper loader added"
}

start_hammerspoon() {
  step "Launching Hammerspoon"
  local app_path=""
  if [[ -d "/Applications/Hammerspoon.app" ]]; then
    app_path="/Applications/Hammerspoon.app"
  elif [[ -d "$HOME/Applications/Hammerspoon.app" ]]; then
    app_path="$HOME/Applications/Hammerspoon.app"
  fi

  if [[ -n "$app_path" ]]; then
    if open "$app_path"; then
      ok "Hammerspoon launch requested"
      return
    fi
  fi

  warn "Unable to auto-launch Hammerspoon. Open it manually from Applications."
}

show_permissions() {
  say ""
  step "Permissions required"
  say "Enable Accessibility for:"
  say "- Hammerspoon"
  say "- Terminal (or iTerm, if needed)"
  say ""
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" || true
}

verify_cli() {
  say ""
  step "Verification"
  if command -v hs >/dev/null 2>&1; then
    ok "hs CLI found: $(command -v hs)"
  else
    warn "hs CLI not found in PATH yet. Restart terminal or open Hammerspoon once."
  fi

  if curl -fsS "http://127.0.0.1:7710/health" >/dev/null 2>&1; then
    ok "FlowOS Hammerspoon bridge is active on 127.0.0.1:7710"
  else
    warn "FlowOS bridge not active yet; in Hammerspoon menu click Reload Config"
    warn "Then run: curl http://127.0.0.1:7710/health"
  fi

  say ""
  say "Next: run FlowOS with Hammerspoon desktop migration enabled:"
  say "  FLOWOS_ENABLE_HAMMERSPOON=1 npm run dev"
}

main() {
  say "${BLUE}FlowOS Hammerspoon Guided Setup${NC}"
  ensure_brew
  install_hammerspoon
  ensure_init_loader
  start_hammerspoon
  show_permissions
  verify_cli
}

main "$@"
