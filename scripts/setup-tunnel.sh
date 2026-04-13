#!/bin/bash
set -e

echo "Setting up Cloudflare Tunnel for Sentinel..."

# 1. Check if cloudflared is installed
if ! command -v cloudflared &>/dev/null; then
  echo "cloudflared not found. Installing via Homebrew..."
  if ! command -v brew &>/dev/null; then
    echo "Error: Homebrew is required to install cloudflared."
    echo "Install Homebrew first: https://brew.sh"
    exit 1
  fi
  brew install cloudflared
  echo "cloudflared installed successfully."
else
  echo "cloudflared is already installed: $(cloudflared --version)"
fi

# 2. Print instructions for creating a named tunnel
echo ""
echo "=== Cloudflare Tunnel Setup ==="
echo ""
echo "If you haven't already, authenticate with Cloudflare:"
echo "  cloudflared tunnel login"
echo ""
echo "To create a named tunnel (recommended for persistent URL):"
echo "  cloudflared tunnel create sentinel"
echo ""
echo "For a quick-start tunnel (random URL, no account needed):"
echo "  cloudflared tunnel --url http://localhost:3847"
echo ""

# 3. Create launchd plist for auto-start
PLIST_PATH="$HOME/Library/LaunchAgents/com.sentinel.tunnel.plist"

cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.sentinel.tunnel</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(which cloudflared)</string>
    <string>tunnel</string>
    <string>--url</string>
    <string>http://localhost:3847</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.sentinel/tunnel.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.sentinel/tunnel.error.log</string>
</dict>
</plist>
EOF

echo "Created launchd plist at: $PLIST_PATH"

# 4. Load the plist
launchctl load "$PLIST_PATH"
echo "Tunnel service loaded."

# 5. Wait a moment and check the log for the tunnel URL
echo ""
echo "Waiting for tunnel to start..."
sleep 3

if [ -f "$HOME/.sentinel/tunnel.log" ]; then
  TUNNEL_URL=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' "$HOME/.sentinel/tunnel.log" | head -1)
  if [ -n "$TUNNEL_URL" ]; then
    echo ""
    echo "=== Tunnel is running ==="
    echo "Public URL: $TUNNEL_URL"
    echo ""
    echo "Add this URL to your GitHub webhook configuration:"
    echo "  Webhook URL: ${TUNNEL_URL}/webhook"
    echo "  Content type: application/json"
    echo "  Secret: (use your WEBHOOK_SECRET from .env)"
    echo "  Events: check_run, pull_request, pull_request_review_comment"
  else
    echo "Tunnel started but URL not yet available."
    echo "Check the log: cat ~/.sentinel/tunnel.log"
  fi
else
  echo "Log file not yet created. Check status with:"
  echo "  cat ~/.sentinel/tunnel.log"
fi

echo ""
echo "To stop the tunnel:"
echo "  launchctl unload $PLIST_PATH"
echo ""
echo "To view tunnel logs:"
echo "  tail -f ~/.sentinel/tunnel.log"
