# PandaPi — agent guide

Loaded automatically by Pi-based agents working in this repository. It covers
what the project is, the rules that must not be broken, the state of the work,
and what is deliberately parked. Read it before changing anything.

## What this is

PandaPi is a **browser-use agent in a Brave/Chrome side panel**. The chat panel
drives the tab you are looking at through a native host that embeds the
[Pi](https://github.com/earendil-works/pi) SDK. It is open source under MIT and
ships as an unpacked MV3 extension plus a Bun native host. There is no build
step and no server.

- Version: **0.5.0**
- Pi SDK: `@earendil-works/pi-coding-agent@1.0.0` (pinned exact — see "Upgrades")
- Licence: MIT (`LICENSE`, `THIRD_PARTY_NOTICES.md`)

## Architecture

```
side panel (extension/)  →  MV3 service worker  →  native host (host/, Bun)
                                                    Pi createAgentSession()
                                                    ~/.pandapi  (not ~/.pi)
                                                    browser tools only
                                                    ↻ browser_request/result
```

- `extension/` — plain JavaScript, no build step.
  - `sidepanel.{html,css,js}` — the chat UI, settings overlay, approvals.
  - `background.js` — service worker; routes messages per panel.
  - `browser.js` — implements the `chrome.tabs` / `chrome.scripting` methods.
  - `page-actions.js` — the single self-contained function injected into pages.
- `host/src/` — TypeScript, run by Bun.
  - `index.ts` — stdio native-messaging loop, panel routing, approvals.
  - `pi-session.ts` — owns the Pi session, models, event mapping, config.
  - `browser-tools.ts` — the tool definitions and the browser system prompt.
  - `config.ts` — reads/writes `~/.pandapi` (`models.json`).
  - `danger.ts` — approval heuristic.
  - `protocol.ts` — native-messaging framing, message types, URL validation.
  - `stdio-guard.ts` — keeps stray stdout out of the message stream.
- `tools/oxlint/anti-slop/` — vendored curated lint rules (MIT, see `UPSTREAM.md`).

## Hard rules — do not break these

1. **Browser-only tools.** The model may only reach the browser through the
   tools in `host/src/browser-tools.ts`. Never add shell, filesystem, network,
   or OS tools.
2. **Approvals.** Anything that can submit, send, pay, delete, publish, or sign
   goes through `needsApproval` (`host/src/danger.ts`), with tests. This
   includes submit-type controls and action-endpoint links (`mailto:`,
   `/checkout`, …) even when the control has no label.
3. **URL allowlist.** Anything the model can steer toward navigation must pass
   `assertNavigableUrl` (`host/src/protocol.ts`): `http`/`https`/`about:blank`
   only.
4. **Unforgeable refs.** Snapshot refs live in the extension's isolated world
   (`globalThis.__pandapiRefsV1`), never in page-readable DOM attributes.
5. **Credential isolation.** PandaPi reads and writes only `~/.pandapi`
   (override with `PANDAPI_HOME`). It must never read `~/.pi/agent` or the Pi
   CLI's credentials.
6. **Token discipline.** Do not resend page content the model already has. Use
   the snapshot fingerprints and the `freshSnapshot` path in `browser-tools.ts`.

## Commands

```bash
bun install
bun run setup-host   # writes scripts/pandapi-host.sh + native-messaging manifests
bun run typecheck    # tsc --noEmit
bun run lint         # oxlint (curated anti-slop subset)
bun test             # 39 tests, includes a real native-host boot
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, and tests on every push
and pull request. All three must pass before committing.

## State of the work

**Shipped**

- Open source under MIT, version 0.5.0, tagged `v0.5.0`.
- Upgraded to Pi SDK 1.0.0. The SDK surface used here is unchanged; the custom
  `compat` provider still builds a session (covered by `host-hello.test.ts`).
- Hardening: URL allowlist, isolated-world refs, approval gating for
  submit-type/href controls, serialized control messages, approval-timeout
  cleanup, window-scoped tab tools.
- Token efficiency: snapshot payload dedupe, unchanged-page short-circuit,
  page-text dedupe, opt-in cache retention and cache lifetime.
- Project docs: README, CONTRIBUTING, SECURITY, CHANGELOG, CODE_OF_CONDUCT,
  issue forms, third-party notices.

**Deliberately deferred — do not "fix" without being asked**

- **Per-panel sessions.** All panels/windows currently share one conversation.
- **Configurable context window / max tokens.** `config.ts` hardcodes `128000`
  and `8192` for whatever model id the user types.
- **Max-steps budget per prompt.** Only the system prompt discourages loops.
- **Snapshot performance** on heavy pages (computed styles, shadow-DOM walk).
- **MV3 service-worker keepalive** during long quiet runs.
- **Auto-compaction** of long conversations, and trimming the snapshot caps.

**Known limitations (documented, not bugs to chase)**

- Synthetic clicks and keys are not trusted browser input; some sites ignore
  them. `press_key` only really drives `Enter` → form submit and JS listeners.
- The isolated-world ref map and the "page unchanged" short-circuit depend on
  browser behaviour that unit tests cannot exercise. Verify in a real browser.
- The design skill used for the UI is **not** vendored (upstream has no
  licence). `.agents/`, `.claude/`, and `skills-lock.json` are gitignored.

## Lint

`oxlint.config.ts` enables a **curated subset** of anti-slop. The boundary-typing
rules (`no-unknown-*`, `no-unsafe-dictionary-type`, `no-runtime-typeof`,
`require-safety-comment-for-type-assertion`, …) are intentionally excluded
because they fight legitimate boundary code (native-messaging payloads,
`JSON.parse`, SDK events, browser feature detection). Read
`tools/oxlint/anti-slop/UPSTREAM.md` before enabling anything else.

## Environment knobs

| Variable | Purpose |
| --- | --- |
| `PANDAPI_HOME` | Agent data directory. Default `~/.pandapi` |
| `PANDAPI_API_KEY` / `PANDAPI_BASE_URL` / `PANDAPI_MODEL` | Seed the endpoint config |
| `PANDAPI_CACHE_RETENTION` | Prompt-cache retention: `short` (default) or `long` (24h) |
| `PANDAPI_CACHE_LIFETIME` | Declare the endpoint's cache TTL (`short:300`) so Pi can warm it |

## Conventions

- Tests accompany behaviour changes (`host/src/*.test.ts`).
- Keep the README's feature list and tool table in sync with `browser-tools.ts`.
- After changing anything in `extension/`, reload the unpacked extension in the
  browser's extensions page; the host restarts when the panel is reopened.
- Never commit `REVIEW.md`, `.agents/`, `.claude/`, or `skills-lock.json`
  (all gitignored).
- Commit style: imperative subject; explain *why* in the body.

## Upgrades

The Pi SDK is pinned exactly on purpose: `pi-session.ts` relies on SDK types
(`AgentSessionEvent`, `DefaultResourceLoader` options), so treat an upgrade as a
deliberate change. To try one, install it, then run the full gate and the host
boot test — `host-hello.test.ts` asserts the custom provider reports `piReady`
with the configured model.

## Local environment (owner's machine — safe to delete in a fork)

- Repo: `/Users/yashwanthchennuru/GitOCProjects/PandaPi`. A `~/PandaPi` symlink
  points here; it only exists so an older Waku session stays resumable and can
  be removed once that session is closed.
- The browser loads the unpacked extension from `extension/`, and the native
  host manifest points at `scripts/pandapi-host.sh` in this repo. Re-run
  `bun run setup-host` if either path moves.
- PandaPi's config lives at `~/.pandapi/models.json` (OpenCode Go endpoint,
  model `deepseek-flash`). It is separate from the Pi CLI's `~/.pi/agent`.
- `REVIEW.md` is a gitignored code-review report. Its Phase 1 findings were
  implemented; everything else is parked under "Deliberately deferred" above.
