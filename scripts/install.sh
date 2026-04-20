#!/bin/bash
set -e

echo "Installing Sentinel..."

# 1. Install dependencies
echo "Installing dependencies..."
pnpm install

# 2. Build
echo "Building Node..."
pnpm build
echo "Building TUI (Rust)..."
pnpm build:tui

# 3. Create config directory
mkdir -p ~/.sentinel

# 4. Copy .env.example if no .env exists yet
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "Created .env from .env.example — fill in your GitHub PAT and repo paths before running"
  else
    echo "No .env.example found — create a .env file manually before running"
  fi
fi

# 5. Install the sentinel CLI globally so `sentinel link` works from any terminal
echo "Linking sentinel CLI..."
# pnpm link --global is unreliable without a configured global bin dir.
# Symlink directly into the first writable dir on PATH instead.
CLI_TARGET="$(pwd)/dist/cli.js"
for dir in "$HOME/.local/bin" "$HOME/bin" /usr/local/bin; do
  if [ -d "$dir" ] && [ -w "$dir" ]; then
    ln -sf "$CLI_TARGET" "$dir/sentinel"
    echo "  → sentinel → $dir/sentinel"
    break
  fi
done
# Ensure the chosen bin dir is actually on PATH for this shell session
if ! command -v sentinel &>/dev/null; then
  echo "  Note: add \$HOME/.local/bin to your PATH if 'sentinel' is not found after install"
fi

# 6. Install the Claude Code PostToolUse hook globally
echo "Installing Claude Code hook..."
pnpm run install-hook

# 7. Register as a launchd service so it starts on login
PLIST_PATH="$HOME/Library/LaunchAgents/com.sentinel.daemon.plist"
SENTINEL_DIR="$(pwd)"

# Capture the node bin dir at install time so launchd finds node regardless of
# how it was installed (nvm, homebrew, volta, asdf, etc). launchd gets a bare
# system PATH that won't include ~/.nvm or /opt/homebrew by default.
NODE_BIN_DIR="$(dirname "$(which node)")"
PNPM_BIN="$(which pnpm)"
LAUNCHD_PATH="${NODE_BIN_DIR}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.sentinel.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${PNPM_BIN}</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${SENTINEL_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>PATH</key>
    <string>${LAUNCHD_PATH}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.sentinel/sentinel.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.sentinel/sentinel.error.log</string>
</dict>
</plist>
EOF

# Unload any existing agent before loading the updated plist
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo ""
echo "Sentinel installed and running"
echo "  Edit .env with your GitHub PAT, org, and repo paths"
echo "  Then run: launchctl kickstart gui/$(id -u)/com.sentinel.daemon"
