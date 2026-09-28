# PandaPi

A **browser-only** [Pi](https://github.com/earendil-works/pi) agent in a Brave/Chrome **side panel**. Pi is the harness. The extension is the hands. Nothing on disk, no shell — this window only.

You already use Pi in the terminal. This is the same harness with a chat UI attached to the tab you are looking at — but it runs on **its own credentials** (`~/.pandapi`), fully separate from your terminal Pi (`~/.pi/agent`).

## What it does

- Side panel chat (right-hand panel via the toolbar button)
- Current-tab context chip (dismissible)
- Tools: list/create/switch tabs, navigate, screenshot (**returned to the model when it supports vision**), page snapshot, page text, click/type by ref, Gmail **draft** (does not send)
- BYOK with its own key in `~/.pandapi/auth.json`, isolated from the Pi CLI — nothing stored in the extension
- Optional [Stagehand](https://www.stagehand.dev/) **attach** if you already expose CDP on this browser (`PANDAPI_CDP_URL`). It never launches a second profile and never uses Browserbase.

## Requirements

- Desktop Brave (or Chrome). No mobile.
- [Bun](https://bun.sh) 1.2+ (`curl -fsSL https://bun.sh/install | bash`)
- An API key for a supported provider (e.g. OpenCode Go). PandaPi bundles the Pi SDK, so a Pi CLI install is optional.

The side panel is still a normal MV3 extension (the browser cannot run Bun). Bun replaces Node for install, tests, and the native host that embeds Pi.

## Install

```bash
git clone <this-repo> && cd PandaPi
bun install
bun run setup-host   # writes scripts/pandapi-host.sh + the Brave/Chrome native-messaging manifests
bun run set-key      # prompts (hidden) for PandaPi's own API key; or pass --key/--model
bun run check-key    # confirms the key and lists the models PandaPi can use
```

You can also set the key from inside the panel: click the gear (&#9881;) in the top-right, choose the provider, paste the key, and Save.

The setup script points the `com.pandapi.host` manifest at *this* checkout, so re-run it if you move the folder or clone over an old install.

Then in Brave:

1. `brave://extensions` → Developer mode
2. Load unpacked → the `extension/` folder in this repo  
   The packed ID is pinned to `kdocghhgibkeiaojckijeocmppbealaa` so native messaging can find it.
3. Click the PandaPi icon (opens the side panel)

If the panel says the native host is missing, `setup-host` did not land a manifest in Brave’s `NativeMessagingHosts` directory. Re-run it and fully quit Brave.

## Your key, separate from the Pi CLI

PandaPi keeps everything it owns in `~/.pandapi` (override with `PANDAPI_HOME`):

| PandaPi (browser) | Pi CLI (terminal) |
| --- | --- |
| `~/.pandapi/auth.json` | `~/.pi/agent/auth.json` |
| `~/.pandapi/settings.json` | `~/.pi/agent/settings.json` |
| `~/.pandapi/models-store.json` | `~/.pi/agent/models-store.json` |

Nothing is shared. The browser agent never reads the CLI's key, settings, model catalog, extensions, or skills. That means you can plug in a **dedicated API key** and track this agent's usage on its own in your provider dashboard:

```bash
bun run set-key                                  # hidden prompt; provider defaults to opencode-go
bun run set-key --key sk-... --model kimi-k2.6   # or pass it directly
bun run set-key --check                          # same as: bun run check-key
```

`set-key` merges into `~/.pandapi/auth.json` (chmod `0600`) and never touches `~/.pi/agent`. The same thing can be done without a terminal: the gear (&#9881;) button in the side panel opens a key form — pick the provider, paste the key, optionally set a default model, and Save. The host writes the file and reloads the agent live. Re-run `set-key` (or save again in the panel) any time to rotate the key.

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

The host is `com.pandapi.host`. Tool calls never run `bash`, `read`, or `write`. The host embeds the Pi SDK and reads only `~/.pandapi` — the Pi CLI's `~/.pi/agent` is never touched.

## Tests

```bash
bun test
bun run typecheck
```
