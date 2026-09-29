# PandaPi

A **browser-use agent** in a Brave/Chrome **side panel**. It drives the window you are already looking at: snapshot the page, click/type by ref, switch tabs, scroll, wait, screenshot. The planner is an isolated [Pi](https://github.com/earendil-works/pi) harness. The only cloud traffic is your LLM.

## What it is for

Typical jobs: summarize this tab, extract facts, fill a form, open a result in a new tab, draft Gmail (never send), compare two pages, recover when a control moved. Login and 2FA are yours. Send / pay / delete clicks need an in-panel approval.

## What it does

- **Side panel chat** opened from the toolbar button (or `Ctrl/Cmd+Shift+Period`), with streaming replies and a tool-activity log.
- **Current-tab context** chip: the attached tab's title/URL is sent with each prompt (dismissible).
- **Snapshot + refs**: `snapshot` returns page text plus interactive elements labelled `e1`, `e2`, … Click/type act on those refs. Refs are bound to a tab + URL and expire on navigation.
- **Fresh snapshot after acting**: every `click`, `type_text`, `scroll`, and `wait` returns a new snapshot so the agent sees the result.
- **Vision screenshots**: `screenshot` returns the image to the model (and shows it in the panel) for charts, canvas, maps, or visual-only pages.
- **Approvals**: send / pay / delete / confirm style clicks, `Enter` presses, and submitting `type_text` require an explicit **Approve / Deny** in the panel.
- **Settings in the panel**: LLM base URL, API key, and model id, persisted under `~/.pandapi` and isolated from the Pi CLI.
- **Gmail drafts only**: `compose_gmail` opens a draft and never sends.

## Requirements

- Desktop Brave (or Chrome). No mobile.
- [Bun](https://bun.sh) 1.2+ (`curl -fsSL https://bun.sh/install | bash`).
- An OpenAI-compatible API key (OpenAI, OpenRouter, a proxy, …).

## Install

```bash
git clone https://github.com/yashwanth-chennuru/PandaPi.git
cd PandaPi
bun install
bun run setup-host
```

Then in Brave:

1. `brave://extensions` → enable **Developer mode**.
2. **Load unpacked** → the `extension/` folder in this repo.  
   The extension ID is pinned to `kdocghhgibkeiaojckijeocmppbealaa` so native messaging can find it.
3. Click the PandaPi icon to open the side panel.
4. **⚙ Settings** → paste the base URL, API key, and model id → **Save**.

`setup-host` writes the `com.pandapi.host` manifest for Brave, Chrome, and Chromium (macOS, Linux, and Windows), pointing at this checkout. Re-run it if you move the folder.

If the panel reports the native host is missing, `setup-host` didn't land a manifest in the browser's `NativeMessagingHosts` directory. Re-run it and fully quit the browser.

## Using it

- Type in the composer (Enter sends, Shift+Enter newline). The status line shows host state.
- The **model dropdown** lists what your LLM config exposes; changing it switches the session model.
- **⚙** opens settings. **+** starts a new chat. The **■** button aborts the current run.
- The focused tab becomes the context chip automatically. Detach it with the **×** if you don't want page context.
- When an action needs approval, an **Approve / Deny** card appears in the panel; the agent waits for your choice.
- If a site shows a login or 2FA wall, the agent stops and asks you to finish signing in, then continues.

## LLM configuration

Settings are stored on this machine, not in Chrome sync:

```
~/.pandapi/            # override with PANDAPI_HOME
  models.json          # provider "compat": baseUrl, apiKey, model id (mode 0600)
```

The configured provider is OpenAI-compatible (`openai-completions`) with conservative compatibility flags, and the model is declared image-capable so vision screenshots work. The key is never written to extension storage; the panel only receives a masked hint (`abcd…wxyz`). Reopening the panel reloads the saved config, and saving with a blank key keeps the existing one.

PandaPi never reads or writes the Pi CLI's `~/.pi/agent`. It uses its own directory, so you can point it at a dedicated key and monitor this agent's usage on its own.

You can also seed the host process instead of using the panel:

| Variable | Purpose |
| --- | --- |
| `PANDAPI_HOME` | Agent directory. Default `~/.pandapi` |
| `PANDAPI_API_KEY` / `OPENAI_API_KEY` | API key seed |
| `PANDAPI_BASE_URL` / `OPENAI_BASE_URL` | Base URL seed |
| `PANDAPI_MODEL` | Model id seed |

## Tools

The host exposes only these tools. It never runs `bash`, `read`, `write`, `edit`, `grep`, `find`, or `ls`.

| Tool | What it does |
| --- | --- |
| `tabs_list` | List open tabs in the current window |
| `tabs_create` | Open a new tab, optionally at a URL |
| `tabs_activate` | Focus an existing tab by id |
| `navigate` | Go to a URL and wait for load; invalidates snapshot refs |
| `snapshot` | Page text plus interactive refs; call before click/type |
| `click` | Click a ref; returns a fresh snapshot (approval when the label looks dangerous) |
| `type_text` | Type into a ref; `pressEnter` submits and requires approval |
| `press_key` | Press a key (Enter, Escape, Tab, …); Enter requires approval |
| `scroll` | Scroll up / down / top / bottom |
| `wait` | Wait for the page to settle (max 15s) |
| `screenshot` | Capture the visible tab and return the image to the model |
| `compose_gmail` | Open a Gmail compose **draft** — never sends |

## Architecture

```
This Brave window
  side panel  →  MV3 service worker  →  native host (Bun)
                                         Pi createAgentSession()
                                         ~/.pandapi  (not ~/.pi)
                                         browser tools only
```

- **Hands:** accessibility-style snapshot + refs, then click/type. Screenshot when the tree is useless (charts, canvas). After click/type/scroll/wait you get a fresh snapshot.
- **Brain:** Pi SDK, no shell, no filesystem tools, no skills, no MCP, no Stagehand inner loop.
- **LLM:** OpenAI-compatible endpoint (base URL + key + model id) stored under `~/.pandapi`.
- **Not used:** Browserbase, a second Chromium profile, local weights, `~/.pi/agent`.

Prompts and events flow over a `chrome.runtime` port → service worker → native host (length-prefixed JSON, host name `com.pandapi.host`). Tool calls go back as `browser_request`, are executed with `chrome.tabs` / `chrome.scripting`, and return as `browser_result`. Requests are routed to the owning panel, and approvals use a matching `approval_request` / `approval_result` pair.

Stagehand was considered and **left out**. It is a good recovery SDK, but `act`/`extract` each call an LLM, so putting it under Pi double-pays and fights the planner. Attaching it via `--remote-debugging-port` is a poor daily-driver UX on Brave. Recovery here is: snapshot again, wait, scroll, screenshot.

There is no Python in this repo. Tooling is **Bun** (`bun test`, `bun run setup-host`, the native host).

## Project layout

```
extension/                 MV3 side panel (plain JS, no build step)
  manifest.json            permissions, pinned key, side panel entry
  background.js            service worker; bridges panel <-> native host
  sidepanel.{html,js,css}  chat UI, model dropdown, settings, approvals
  browser.js               chrome.tabs / chrome.scripting implementation
  page-actions.js          single self-contained function injected into pages
host/src/                  native host (Bun + Pi SDK)
  index.ts                 stdio native-messaging loop, routing, approvals
  pi-session.ts            Pi session: models, events, LLM config
  browser-tools.ts         the tools above + the browser system prompt
  protocol.ts              framing and message types
  config.ts                read/write ~/.pandapi/models.json (0600)
  danger.ts                approval heuristics
  stdio-guard.ts           keeps stray stdout writes out of the message stream
scripts/
  setup-host.mjs           setup-host: launcher + native-messaging manifests
```

## Design

The side panel follows a restrained Scandinavian system: a near-black canvas, a neutral alpha-white ink ladder, one system sans-serif, an 8px spacing rhythm, and restrained radii. Color is reserved for state — the connected/error dot and error text — so the interface stays quiet. Tokens live at the top of `extension/sidepanel.css`.

- Canvas `#0a0a0a`; ink is alpha white at 100 / 56 / 46 / 36%.
- Borders 10% white, strong borders 18%, hover 9%, pressed 14%.
- One inline SVG icon set at a single stroke weight; no emoji or icon fonts.
- Semantic color only: `--ok` for the live dot, `--danger` for errors.

The visual system comes from the [`scandinavian-design`](https://skills.sh/ericzakariasson/scandinavian-design) skill, installed under `.agents/skills/`.

## Development

```bash
bun test          # host unit tests (tools, config, host hello, extension guards)
bun run typecheck # tsc --noEmit
bun run lint      # oxlint, with a curated subset of the anti-slop rules
```

Linting uses a **curated subset** of [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), vendored at `tools/oxlint/anti-slop/` and configured in `oxlint.config.ts`. Only rules that fit this project are enabled; the boundary-typing rules (`no-unknown-*`, `no-unsafe-dictionary-type`, `no-runtime-typeof`, …) are deliberately excluded. See `tools/oxlint/anti-slop/UPSTREAM.md` for provenance, the enabled list, and why the rest are off.

After pulling changes, reload the unpacked extension in `brave://extensions` so the side panel picks up new code.

## Troubleshooting

- **"Native host disconnected"** — run `bun run setup-host`, then fully quit and reopen the browser.
- **"No models — open Settings"** — paste base URL, API key, and model id in **⚙ Settings**, then Save.
- **Model dropdown is empty after a good Save** — check the model id matches the endpoint and the base URL has no trailing slash.
- **Screenshot fails** — the attached tab must be active/visible in a focused window.
- **Panel shows an old version** — reload the extension in `brave://extensions`.
- **Moved the repo** — re-run `bun run setup-host` so the manifest points at the new path.

## Safety

- The agent has no shell, filesystem, or OS tools; it can only call the tools above.
- The API key is stored at `~/.pandapi/models.json` with `0600` permissions and is never written to extension storage.
- `compose_gmail` opens a draft only. Clicks that look like send / pay / delete / publish / confirm, `Enter` presses, submitting `type_text`, submit-type controls, and links to action endpoints (`mailto:`, `/checkout`, `/delete`, …) all require explicit in-panel approval — including icon-only buttons with no label.
- Navigation is restricted to `http(s)` (and `about:blank`). `javascript:`, `data:`, `file:`, and extension URLs are refused.
- Snapshot refs live in the extension's isolated world, not in page-readable DOM attributes, so page scripts cannot forge them.
- Everything runs against the browser you already have; no second profile is launched.
