# PandaPi

A **browser-use agent** in a Brave/Chrome **side panel**. It drives the window you are already looking at: snapshot the page, click/type by ref, switch tabs, wait, screenshot. The planner is an isolated [Pi](https://github.com/earendil-works/pi) harness. The only cloud traffic is your LLM.

## What it is for

Typical jobs: summarize this tab, extract facts, fill a form, open a result in a new tab, draft Gmail (never send), compare two pages, recover when a control moved. Login and 2FA are yours. Send / pay / delete clicks need an in-panel approval.

## Architecture

```
This Brave window
  side panel  →  MV3 service worker  →  native host (Bun)
                                       Pi createAgentSession()
                                       ~/.pandapi  (not ~/.pi)
                                       browser tools only
```

- **Hands:** accessibility-style snapshot + refs, then click/type. Screenshot when the tree is useless (charts, canvas). After click/type/scroll/wait you get a fresh snapshot.
- **Brain:** Pi SDK, no shell, no filesystem tools, **no skills**, no MCP, no Stagehand inner loop.
- **LLM:** OpenAI-compatible endpoint (base URL + key + model id) stored under `~/.pandapi`.
- **Not used:** Browserbase, a second Chromium profile, local weights, `~/.pi/agent`.

Stagehand was considered and **left out**. It is a good recovery SDK, but `act`/`extract` each call an LLM, so putting it under Pi double-pays and fights the planner. Attaching it via `--remote-debugging-port` is a poor daily-driver UX on Brave. Recovery here is: snapshot again, wait, scroll, screenshot.

There is no Python in this repo. Tooling is **Bun** (`bun test`, `bun run setup-host`, native host). `uv` is unused because there is nothing to install with it.

## Requirements

- Desktop Brave (or Chrome)
- [Bun](https://bun.sh) 1.2+ (`curl -fsSL https://bun.sh/install | bash`)
- An OpenAI-compatible API key (OpenAI, OpenRouter, a proxy, …)

## Install

```bash
git clone <this-repo> && cd PandaPi
bun install
bun run setup-host
```

Then in Brave:

1. `brave://extensions` → Developer mode
2. Load unpacked → the `extension/` folder  
   The packed ID is pinned to `kdocghhgibkeiaojckijeocmppbealaa` so native messaging can find it.
3. Click the PandaPi icon (side panel)
4. Settings → paste base URL, API key, model id → Save

Keys land in `~/.pandapi/models.json`. They are not written to Chrome sync. Snapshots and prompts still go to the LLM you configured.

You can also seed the host process with `PANDAPI_API_KEY` / `PANDAPI_BASE_URL` / `PANDAPI_MODEL`, or `OPENAI_API_KEY` / `OPENAI_BASE_URL`.

## Tests

```bash
bun test
bun run typecheck
```
