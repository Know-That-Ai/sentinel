#!/bin/bash
set -e

echo "Installing Sentinel..."

# 1. Install dependencies
pnpm install

# 2. Build
pnpm build

# 3. Create config directory
mkdir -p ~/.sentinel

# 4. Copy .env.example if no .env exists yet
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env — fill in your GitHub PAT and repo paths before running"
fi

# 5. Install the sentinel CLI globally so `sentinel link` works from any terminal
pnpm link --global

# 6. Install the Claude Code PostToolUse hook globally
pnpm run install-hook

# 7. Register as a launchd service so it starts on login
PLIST_PATH="$HOME/Library/LaunchAgents/com.sentinel.daemon.plist"
SENTINEL_DIR="$(pwd)"

cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.sentinel.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>${SENTINEL_DIR}/dist/main.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${SENTINEL_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
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

launchctl load "$PLIST_PATH"

echo "Sentinel installed and running"
echo "   Edit .env then run: launchctl kickstart gui/$(id -u)/com.sentinel.daemon"
