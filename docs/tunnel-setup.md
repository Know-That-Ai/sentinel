# Cloudflare Tunnel Setup — Verification Checklist

After running `./scripts/setup-tunnel.sh`, verify the following:

## Checklist

- [ ] **`cloudflared tunnel --url http://localhost:3847` starts without error**
  Run manually first to confirm. Check `~/.sentinel/tunnel.log` for the public URL.

- [ ] **Public URL is accessible from outside the local network**
  Open the tunnel URL in a browser or from another device. The `/health` endpoint should return `200 OK`.

- [ ] **GitHub webhook delivers successfully to the public URL**
  Go to your repo's Settings > Webhooks > Recent Deliveries. Confirm the webhook payload was received with a `200` response. The webhook URL should be `https://<your-tunnel>.trycloudflare.com/webhook`.

- [ ] **`sentinel test-webhook --pr 1 --type bugbot` fires and the delivery appears**
  Run the test webhook command. Verify the event appears in the menu bar UI and in the GitHub webhook delivery logs.

## Troubleshooting

**Tunnel won't start:**
- Check if port 3847 is in use: `lsof -i :3847`
- Ensure Sentinel daemon is running: `launchctl list | grep sentinel`

**Webhook returns 401:**
- Verify `WEBHOOK_SECRET` in `.env` matches the secret configured in GitHub webhook settings

**No events showing up:**
- Check tunnel logs: `tail -f ~/.sentinel/tunnel.error.log`
- Verify the webhook events are subscribed: `check_run`, `pull_request`, `pull_request_review_comment`

## Managing the tunnel service

```bash
# Stop the tunnel
launchctl unload ~/Library/LaunchAgents/com.sentinel.tunnel.plist

# Start the tunnel
launchctl load ~/Library/LaunchAgents/com.sentinel.tunnel.plist

# View logs
tail -f ~/.sentinel/tunnel.log
tail -f ~/.sentinel/tunnel.error.log

# Reinstall (after changes)
./scripts/setup-tunnel.sh
```
