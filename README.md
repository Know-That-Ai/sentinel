# Sentinel

Mac menu bar app that monitors GitHub PRs and routes scanner results
(BugBot, CodeQL, CI failures) directly into active Claude Code sessions.

## Install

```bash
git clone https://github.com/Know-That-Ai/sentinel
cd sentinel
./scripts/install.sh
```

Then edit `~/.sentinel/.env` with your values — see `.env.example` for all options.

Restart the daemon after editing `.env`:
```bash
launchctl kickstart -k gui/$(id -u)/com.sentinel.daemon
```

## Webhook Setup

```bash
pnpm tsx scripts/setup-webhook.ts --webhook-url=https://YOUR_TUNNEL_URL/webhook --org=YOUR_ORG
```

For tunnel setup see `docs/tunnel-setup.md`.

## Usage

Sentinel runs automatically on login. The `👁` icon appears in your menu bar.

From any repo directory with an open PR:
```bash
sentinel link      # link this session to the PR on the current branch
sentinel status    # show active links and recent scanner runs
sentinel flush --pr <number>   # re-dispatch a PR's latest scanner results
```
