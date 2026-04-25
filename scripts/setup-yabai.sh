#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

say() {
  printf "%b\n" "$1"
}

step() {
  say "${BLUE}==>${NC} $1"
}

ok() {
  say "${GREEN}✓${NC} $1"
}

warn() {
  say "${YELLOW}!${NC} $1"
}

err() {
  say "${RED}x${NC} $1"
}

ask_yes_no() {
  local prompt="$1"
  local default_answer="${2:-y}"
  local answer

  if [[ "$default_answer" == "y" ]]; then
    read -r -p "$prompt [Y/n]: " answer || true
    answer="${answer:-y}"
  else
    read -r -p "$prompt [y/N]: " answer || true
    answer="${answer:-n}"
  fi

  [[ "$answer" =~ ^[Yy]$ ]]
}

ensure_brew() {
  if command -v brew >/dev/null 2>&1; then
    ok "Homebrew found"
    return
  fi

  warn "Homebrew not found"
  say "Install Homebrew first:"
  say '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  exit 1
}

install_formula_if_missing() {
  local formula="$1"
  if brew list --formula "$formula" >/dev/null 2>&1; then
    ok "$formula already installed"
    return
  fi

  step "Installing $formula"
  brew install "$formula"
  ok "$formula installed"
}

ensure_koekeishiya_tap() {
  if brew tap | grep -q '^koekeishiya/formulae$'; then
    ok "Tap koekeishiya/formulae already present"
    return
  fi

  step "Adding tap koekeishiya/formulae"
  brew tap koekeishiya/formulae
  ok "Tap added"
}

ensure_config_files() {
  local config_dir="$HOME/.config/yabai"
  mkdir -p "$config_dir"

  if [[ ! -f "$config_dir/yabairc" ]]; then
    cat > "$config_dir/yabairc" <<'YABAI'
#!/usr/bin/env sh

# Minimal yabai config for FlowOS desktop automation

yabai -m config layout bsp

yabai -m config mouse_follows_focus off
yabai -m config focus_follows_mouse autoraise
yabai -m config window_placement second_child

yabai -m config top_padding 8
yabai -m config bottom_padding 8
yabai -m config left_padding 8
yabai -m config right_padding 8
yabai -m config window_gap 8
YABAI
    chmod +x "$config_dir/yabairc"
    ok "Created ~/.config/yabai/yabairc"
  else
    ok "Using existing ~/.config/yabai/yabairc"
  fi

  if [[ ! -f "$config_dir/skhdrc" ]]; then
    cat > "$config_dir/skhdrc" <<'SKHD'
# Minimal skhd config placeholder
# Example:
# alt - return : open -na Terminal
SKHD
    ok "Created ~/.config/yabai/skhdrc"
  else
    ok "Using existing ~/.config/yabai/skhdrc"
  fi
}

start_services() {
  step "Starting yabai service"
  if yabai --stop-service >/dev/null 2>&1; then
    :
  fi
  yabai --start-service
  ok "yabai service start requested"

  step "Starting skhd service"
  if skhd --stop-service >/dev/null 2>&1; then
    :
  fi
  skhd --start-service
  ok "skhd service start requested"
}

print_permissions_help() {
  say ""
  step "Permissions required"
  say "1) Open macOS Settings -> Privacy & Security -> Accessibility"
  say "2) Enable permissions for:"
  say "   - yabai"
  say "   - skhd"
  say "   - Terminal (or iTerm), if used"
  say ""

  if ask_yes_no "Open Accessibility settings now?" "y"; then
    open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" || true
  fi
}

print_sip_note() {
  say ""
  step "Important SIP note"
  warn "Moving windows across Spaces/Desktop 2 with yabai may require the scripting addition."
  warn "That often requires partially disabling SIP on Apple Silicon/modern macOS."
  say ""
  say "FlowOS will still work without this, but Desktop-2 moves may fall back to hide/minimize."
  say ""
}

verify_runtime() {
  say ""
  step "Verifying runtime"

  if command -v yabai >/dev/null 2>&1; then
    ok "yabai binary: $(command -v yabai)"
  else
    err "yabai missing after setup"
  fi

  if command -v skhd >/dev/null 2>&1; then
    ok "skhd binary: $(command -v skhd)"
  else
    err "skhd missing after setup"
  fi

  if yabai -m query --spaces >/dev/null 2>&1; then
    ok "yabai can query spaces"
  else
    warn "yabai query failed (usually permissions not granted yet)"

    local yerr=""
    local serr=""
    yerr="$(tail -n 1 /tmp/yabai_$(whoami).err.log 2>/dev/null || true)"
    serr="$(tail -n 1 /tmp/skhd_$(whoami).err.log 2>/dev/null || true)"
    if [[ -n "$yerr" ]]; then
      warn "yabai log: $yerr"
    fi
    if [[ -n "$serr" ]]; then
      warn "skhd log: $serr"
    fi

    say ""
    step "Next action"
    say "Grant Accessibility to yabai + skhd in System Settings, then run:"
    say "  yabai --start-service && skhd --start-service"
  fi
}

main() {
  say "${BLUE}FlowOS Yabai Guided Setup${NC}"
  say "This script installs and configures yabai/skhd for Desktop-2 workspace moves."
  say ""

  ensure_brew
  ensure_koekeishiya_tap
  install_formula_if_missing "koekeishiya/formulae/yabai"
  install_formula_if_missing "koekeishiya/formulae/skhd"
  ensure_config_files
  start_services
  print_permissions_help
  print_sip_note
  verify_runtime

  say ""
  ok "Setup flow complete."
  say "Next: restart FlowOS and test Enter/Exit Flow mode again."
}

main "$@"
