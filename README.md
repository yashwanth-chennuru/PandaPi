# PandaPi

A **browser-only** [Pi](https://github.com/earendil-works/pi) agent that lives in a Brave/Chrome **side panel**. Pi is the harness; the extension is the hands. No shell, no filesystem, no OS apps — it only drives the window you already have open.

You already use Pi in the terminal. PandaPi is the same harness with a chat UI attached to the current tab, but it runs on **its own credentials** (`~/.pandapi`), fully separate from your terminal Pi (`~/.pi/agent`).

## Features

- **Side panel chat** opened from the toolbar button, with streaming replies and a tool-activity log.
- **Current-tab context** chip: the attached tab's title/URL is sent with every prompt (dismissible).
- **Vision screenshots**: `screenshot` returns the image to the model when it supports image input, so the agent can actually see the screen. It is always shown in the panel too.
- **Reads pages**: `page_text` returns the page's visible text for summarising and Q&A; `snapshot` returns interactive elements with refs for clicking/typing.
- **Browser control**: list/create/switch tabs, navigate, click, type, press keys.
- **Gmail drafts only**: `compose_gmail` opens a draft and never sends.
- **BYOK, isolated**: PandaPi's own key lives in `~/.pandapi/auth.json`; nothing is stored in the extension. Use a dedicated key to monitor this agent's usage on its own.
- **Optional Stagehand attach** for `page_act` / `page_extract` (see below) — never launches a second profile, never uses Browserbase.

## Requirements

- Desktop Brave (or Chrome). No mobile.
- [Bun](https://bun.sh) 1.2+ (`curl -fsSL https://bun.sh/install | bash`).
- An API key for a supported Pi provider (e.g. OpenCode Go). PandaPi bundles the Pi SDK, so a Pi CLI install is optional.

The side panel is a normal MV3 extension (the browser can't run Bun). Bun replaces Node for install, tests, and the native host that embeds Pi.

## Install

```bash
git clone https://github.com/yashwanth-chennuru/PandaPi.git
cd PandaPi
bun install
bun run setup-host   # writes scripts/pandapi-host.sh + Brave/Chrome native-messaging manifests
bun run set-key      # prompts (hidden) for PandaPi's own API key; or pass --key/--model
bun run check-key    # confirms the key and lists the models PandaPi can use
```

You can also set the key from inside the panel: click the gear (⚙) in the top-right, choose the provider, paste the key, and Save.

`setup-host` points the `com.pandapi.host` manifest at *this* checkout, so re-run it if you move the folder or clone over an old install.

Then in Brave:

1. `brave://extensions` → enable **Developer mode**.
2. **Load unpacked** → the `extension/` folder in this repo.  
   The extension ID is pinned to `kdocghhgibkeiaojckijeocmppbealaa` so native messaging can find it.
3. Click the PandaPi icon to open the side panel.

If the panel reports the native host is missing, `setup-host` didn't land a manifest in Brave's `NativeMessagingHosts` directory. Re-run it and fully quit Brave.

## Using it

- Type in the composer (Enter sends, Shift+Enter newline). The status dot shows host connectivity.
- The **model dropdown** lists everything PandaPi's key can use; changing it switches the session model.
- **+** starts a new chat. **■** aborts the current run.
- Tabs are captured automatically: whatever tab is focused becomes the context chip.
- If a site shows a login or 2FA wall, the agent stops and asks you to finish signing in, then continues.

## Keys and isolation

PandaPi owns exactly one directory — `~/.pandapi` (override with `PANDAPI_HOME`):

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

`set-key` merges into `~/.pandapi/auth.json` (chmod `0600`) and never touches `~/.pi/agent`. The same thing works without a terminal: the panel's gear (⚙) button opens a key form (provider, key, optional default model). The host writes the file and reloads the agent live, with no restart. Re-run `set-key` or Save again any time to rotate the key.

On first use, the host fetches the provider's model catalog into `~/.pandapi/models-store.json`; after that it uses the cache (set `PI_OFFLINE=1` to skip network entirely).

## Tools

The host exposes only these tools. It never runs `bash`, `read`, `write`, `edit`, `grep`, `find`, or `ls`.

| Tool | What it does |
| --- | --- |
| `tabs_list` | List open tabs in the current window |
| `tabs_create` | Open a new tab (optional URL, focus) |
| `tabs_activate` | Focus an existing tab by id |
| `navigate` | Navigate the attached tab (or a given tab id) to a URL |
| `screenshot` | Capture the visible tab; returned to the model when it supports vision |
| `snapshot` | Accessibility-style list of interactive elements with `eN` refs |
| `page_text` | Read the page's visible text (title, URL, description, body) |
| `click` | Click an element by ref from the latest snapshot |
| `type_text` | Type into an element by ref (optional Enter to submit) |
| `press_key` | Press a key (Enter, Escape, Tab, …) |
| `compose_gmail` | Open a Gmail compose **draft** — never sends |
| `page_act` | Natural-language action; uses Stagehand when attached, else asks for snapshot+click |
| `page_extract` | Extract structured facts; uses Stagehand when attached, else returns the page snapshot |

## Optional Stagehand (same window)

Only if you want `page_act` / `page_extract` to use Stagehand instead of snapshot+click:

1. Start **this** Brave with remote debugging (no new user-data dir), e.g. `brave --remote-debugging-port=9222`.
2. `export PANDAPI_CDP_URL=http://127.0.0.1:9222`.
3. Restart the host (close the side panel so the native process exits, or relaunch the browser).

If `PANDAPI_CDP_URL` is unset, those tools fall back to snapshot/click. That is the default.

## Configuration

| Variable | Used by | Purpose |
| --- | --- | --- |
| `PANDAPI_HOME` | host, scripts | Agent directory. Default `~/.pandapi` |
| `PANDAPI_CDP_URL` | host | Attach Stagehand to an existing CDP endpoint |
| `PANDAPI_STAGEHAND_MODEL` | host | Model override for Stagehand |
| `PANDAPI_API_KEY` | `set-key` | Provide the key non-interactively |
| `PANDAPI_PROVIDER` | `set-key` | Provider id. Default `opencode-go` |
| `PANDAPI_MODEL` | `set-key` | Default model id |
| `PI_OFFLINE` | host | Skip the model-catalog network refresh |

## Architecture

```
This Brave window
  side panel  →  extension service worker  →  native host (Bun)
                                              Pi createAgentSession()
                                              browser tools only
                                              ↻ browser_request / browser_result
```

The host is the native-messaging app `com.pandapi.host`. Prompts and events flow over a `chrome.runtime` port → service worker → native host (length-prefixed JSON). Tool calls go back the other way as `browser_request`, are executed with `chrome.tabs` / `chrome.scripting`, and return as `browser_result`.

## Project layout

```
extension/                 MV3 side panel (plain JS, no build step)
  manifest.json            permissions, pinned key, side panel entry
  background.js            service worker; bridges panel <-> native host
  sidepanel.{html,js,css}  chat UI, model dropdown, key form
  browser.js               chrome.tabs / chrome.scripting implementation
  page-actions.js          functions injected into pages (snapshot, click, type, text)
host/src/                  native host (Bun + Pi SDK)
  index.ts                 stdio native-messaging loop
  pi-session.ts            Pi session/controller: models, key reload, event mapping
  browser-tools.ts         the tools above + the browser system prompt
  protocol.ts              framing, message types, small pure helpers
  pandapi-store.ts         writes ~/.pandapi auth/settings (0600)
  stagehand.ts             optional CDP attach
scripts/
  install-native-host.mjs  setup-host: launcher + native-messaging manifests
  pandapi-auth.mjs         set-key / check-key
```

## Development

```bash
bun test          # host unit tests (protocol, tools, store)
bun run typecheck # tsc --noEmit
```

After pulling changes, reload the unpacked extension in `brave://extensions` so the side panel picks up new code.

## Troubleshooting

- **"Native host disconnected"** — run `bun run setup-host`, then fully quit and reopen the browser.
- **"No API key found for PandaPi"** — run `bun run set-key` or set the key from the panel gear.
- **Model dropdown says "No models — add a key"** — the key is missing or invalid for the chosen provider.
- **Screenshot fails** — the attached tab must be active/visible in a focused window.
- **Panel shows an old version** — reload the extension in `brave://extensions`.
- **Moved the repo** — re-run `bun run setup-host` so the manifest points at the new path.

## Security

- The agent has no shell, filesystem, or OS tools; it can only call the browser tools listed above.
- The provider key is stored at `~/.pandapi/auth.json` with `0600` permissions and is never written to extension storage.
- `compose_gmail` opens a draft only; the agent never sends mail, spends money, changes passwords, or grants permissions without an explicit request.
- Stagehand attaches to the browser you already have (via `PANDAPI_CDP_URL`); it never launches a separate profile and never uses Browserbase.
