# Security policy

PandaPi is a browser agent: it reads the page you are on, sends that content to
your configured LLM, and can click and type in your real profile. Security
reports are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private reporting instead:

1. Go to the **Security** tab of this repository.
2. Click **Report a vulnerability** (GitHub Security Advisories).

If that is unavailable, open a minimal issue asking for a private channel and
include no details.

Please include:

- what the issue is and why it matters,
- steps to reproduce, ideally with a minimal page or payload,
- the affected version (the panel shows it next to the PandaPi name),
- whether you believe it is exploitable without user interaction.

You can expect an acknowledgement within a few days. This is a personal
project, so please be patient with timelines.

## Supported versions

Only the latest `main` is supported. There are no maintenance branches.

## Scope

In scope:

- the native host (`host/`), especially the tool surface, approval logic,
  URL handling, and native-messaging protocol,
- the extension (`extension/`), especially injection, permissions, and how
  refs and approvals are handled,
- credential handling and the `~/.pandapi` isolation boundary.

Out of scope / known behaviour:

- **Prompt injection is inherent to browser agents.** A malicious page can try
  to steer the model. The mitigations are the approval gate, the http(s)
  allowlist, unforgeable refs, and the fact that the model has no shell,
  filesystem, or network tools. Bypasses of *those* controls are in scope;
  "a page tried to trick the model" on its own is not.
- **Synthetic input limitations.** Clicks and keystrokes are not trusted browser
  input; some sites may ignore them. That is a known limitation, not a
  vulnerability.
- Vulnerabilities in dependencies (report upstream) or in Pi itself
  ([earendil-works/pi](https://github.com/earendil-works/pi)).

## Design notes for reviewers

- The agent's only capabilities are the tools in `host/src/browser-tools.ts`.
- Destructive actions require in-panel approval (`host/src/danger.ts`).
- Navigation is restricted to `http(s)` and `about:blank`.
- Snapshot refs are stored in the extension's isolated world, so page scripts
  cannot forge them.
- The API key is stored at `~/.pandapi/models.json` (`0600`) and is never
  written to extension storage.
