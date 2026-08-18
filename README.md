# PandaPi

A **browser-only** [Pi](https://github.com/earendil-works/pi) agent in a Brave/Chrome **side panel**. Pi is the harness. The extension is the hands. Nothing on disk, no shell — this window only.

You already use Pi in the terminal. This is the same keys and models, with a chat UI attached to the tab you are looking at.

## What it does

- Side panel chat (right-hand panel via the toolbar button)
- Current-tab context chip (dismissible)
- Tools: list/create/switch tabs, navigate, screenshot, page snapshot, click/type by ref, Gmail **draft** (does not send)
- Cloud BYOK through Pi (`~/.pi/agent` auth), not through the extension
- Optional [Stagehand](https://www.stagehand.dev/) **attach** if you already expose CDP on this browser (`PANDAPI_CDP_URL`). It never launches a second profile and never uses Browserbase.

## Requirements

- Desktop Brave (or Chrome). No mobile.
- [Bun](https://bun.sh) 1.2+ (`curl -fsSL https://bun.sh/install | bash`)
- Pi CLI already working with a cloud provider key in `~/.pi/agent`

The side panel is still a normal MV3 extension (the browser cannot run Bun). Bun replaces Node for install, tests, and the native host that embeds Pi.

## Install

```bash
git clone <this-repo> && cd PandaPi
bun install
bun ./scripts/install-native-host.mjs
# after PR #2 is merged you can also: bun run setup-host
```

Then in Brave:

1. `brave://extensions` → Developer mode
2. Load unpacked → the `extension/` folder in this repo  
   The packed ID is pinned to `kdocghhgibkeiaojckijeocmppbealaa` so native messaging can find it.
3. Click the PandaPi icon (opens the side panel)

If the panel says the native host is missing, `setup-host` did not land a manifest in Brave’s `NativeMessagingHosts` directory. Re-run it and fully quit Brave.

## Optional Stagehand (same window)

Only if you want `page_act` / `page_extract` to use Stagehand instead of snapshot+click:

1. Start **this** Brave with remote debugging (no new user-data dir), e.g.  
   `brave --remote-debugging-port=9222`
2. `export PANDAPI_CDP_URL=http://127.0.0.1:9222`
3. Restart the host (close the side panel so the native process exits, or relaunch the browser)

If `PANDAPI_CDP_URL` is unset, those tools fall back to snapshot/click. That is the default.

## Architecture

```
This Brave window
  side panel  →  extension service worker  →  native host (Bun)
                                              Pi createAgentSession()
                                              browser tools only
                                              ↻ browser_request / browser_result
```

The host is `com.pandapi.host`. Tool calls never run `bash`, `read`, or `write`.

## Tests

```bash
bun test
bun run typecheck
```
