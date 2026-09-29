# Contributing to PandaPi

Thanks for taking a look. PandaPi is a small, opinionated project: a browser-use
agent that runs in a Brave/Chrome side panel, driven by an isolated
[Pi](https://github.com/earendil-works/pi) harness. Contributions that keep it
calm, safe, and easy to reason about are very welcome.

## Before you start

- **Desktop Brave or Chrome** for manual testing. There is no mobile story.
- **[Bun](https://bun.sh) 1.2+** for the host, tests, and tooling.
- An **OpenAI-compatible API key** if you want to run the agent end to end.

## Set up a development checkout

```bash
git clone https://github.com/yashwanth-chennuru/PandaPi.git
cd PandaPi
bun install
bun run setup-host        # registers the com.pandapi.host native-messaging manifest
```

Then, in the browser:

1. `brave://extensions` (or `chrome://extensions`) → enable **Developer mode**
2. **Load unpacked** → the `extension/` folder in this repo
3. Open the side panel and paste a base URL, API key, and model id in **⚙ Settings**

Credentials are written to `~/.pandapi` and are never shared with the Pi CLI's
`~/.pi/agent`.

## Checks

Every pull request must pass all three:

```bash
bun run typecheck   # tsc --noEmit
bun run lint        # oxlint (curated anti-slop subset)
bun test            # host unit tests
```

CI runs the same commands on every push and pull request.

## Where things live

```
extension/      MV3 side panel (plain JS, no build step)
host/src/       native host: Pi session, browser tools, protocol, config
scripts/        setup-host
tools/oxlint/   vendored anti-slop rules (MIT, see UPSTREAM.md)
```

See the [README](README.md#architecture) for the full architecture.

## Guidelines

- **Keep the trust boundary intact.** The model may only reach the browser
  through the tools in `host/src/browser-tools.ts`. Do not add shell, filesystem,
  or network tools.
- **Gate destructive actions.** New tools or controls that can submit, send,
  pay, delete, publish, or sign must go through `needsApproval` in
  `host/src/danger.ts`, with tests.
- **Validate URLs.** Anything the model can steer toward navigation must pass
  `assertNavigableUrl` (http/https/`about:blank` only).
- **Keep refs unforgeable.** Snapshot refs live in the extension's isolated
  world, not in page-readable DOM attributes. Do not move them back.
- **Prefer fewer tokens.** Do not resend page content the model already has;
  use the snapshot fingerprints.
- **Tests come with behaviour changes.** Add or update a test in `host/src/*.test.ts`.
- **Lint is curated, not maximal.** `tools/oxlint/anti-slop/UPSTREAM.md` records
  which upstream rules are enabled and why the rest are excluded. Do not enable
  the excluded boundary-typing rules without revisiting that decision.

## Forks and the pinned extension ID

`extension/manifest.json` contains a `key`, which pins the extension ID to
`kdocghhgibkeiaojckijeocmppbealaa`. The native-messaging manifest must list that
exact ID in `allowed_origins`, which is why it is pinned.

If you fork and want your own ID:

1. Replace `key` in `extension/manifest.json` (or remove it and let the browser
   generate one), then note the new ID.
2. Update `extensionId` in `scripts/setup-host.mjs` to match.
3. Re-run `bun run setup-host`.

## Design

The side panel follows a restrained, neutral visual system; the tokens live at
the top of `extension/sidepanel.css`. The design guidelines used to build it
were not vendored (the upstream skill has no license) — install it locally if
you want the same reference:

```bash
npx skills add ericzakariasson/scandinavian-design
```

## Pull requests

- Keep them focused: one concern per PR.
- Say what changed and why, and note anything you could not verify.
- Include the check results (`typecheck`, `lint`, `test`).
- If behaviour changed for the user, update the README.

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
