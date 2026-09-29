# Changelog

All notable changes to PandaPi are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.4.0 - 2026-09-29

First public release, MIT licensed.

### Added

- CI workflow running typecheck, lint, and tests on every push and pull request.
- Curated [anti-slop](https://github.com/dmmulroy/anti-slop) Oxlint rules,
  vendored at `tools/oxlint/anti-slop/` with provenance in `UPSTREAM.md`.
- Approval gate for submit-type controls and action-endpoint links
  (`mailto:`, `/checkout`, `/delete`, …), even when the control has no label.
- Approval vocabulary for publishing and wallet actions (post, publish, tweet,
  share, withdraw, deposit, swap, connect wallet, sign transaction, …).
- `approval_resolved` event so an expired approval card clears itself.
- Project documentation: `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`,
  issue and pull-request templates, `THIRD_PARTY_NOTICES.md`.

### Changed

- Snapshots carry whole-page and page-text fingerprints. A post-action snapshot
  that finds an unchanged page returns a one-line notice instead of repeating
  the page, and page text is only resent when it changes.
- Prompt-cache retention is configurable via `PANDAPI_CACHE_RETENTION`
  (`short` default, `long` opt-in).
- `tabs_list` and `tabs_create` are scoped to the attached tab's window.
- Screenshots are captured as JPEG instead of PNG.
- `@earendil-works/pi-coding-agent` is pinned to an exact version.

### Fixed

- Navigation is restricted to `http(s)` and `about:blank`; `javascript:`,
  `data:`, `file:`, and extension URLs are refused.
- Snapshot refs live in the extension's isolated world instead of page-readable
  DOM attributes, so page scripts can no longer forge or move them.
- `new_session`, `set_model`, and `set_config` are serialized behind the running
  prompt, so they can no longer dispose the session mid-run.
- Control-message errors are routed to the requesting panel instead of being
  dropped when no prompt is active.
- Snapshot payload no longer sends page content to the model twice.

## 0.3.1 - 2026-09-29

### Added

- The loaded extension version is shown next to the PandaPi name, so it is
  obvious which build the panel is running.

## 0.3.0 - 2026-09-29

### Changed

- Redesigned the side panel around a restrained, neutral visual system:
  near-black canvas, alpha-white ink ladder, one system typeface, an 8px
  spacing rhythm, and a single monochrome SVG icon set.
- Settings became an overlay instead of pushing the conversation around.

## 0.2.0 - 2026-08-29

### Added

- Approvals for destructive actions (send, pay, delete, confirm, Enter-submit).
- `scroll` and `wait` tools; a fresh snapshot after every action.
- Per-panel routing, a progress-aware idle timeout, and a stdio guard.
- Settings for an OpenAI-compatible endpoint (base URL, key, model id), stored
  under `~/.pandapi` and isolated from the Pi CLI's `~/.pi/agent`.

### Changed

- Rebuilt the project as a browser-use agent built on snapshots and refs.

## 0.1.0 - 2026-08-18

### Added

- Initial browser-only Pi agent in a Brave/Chrome side panel: chat, current-tab
  context, tab tools, navigation, screenshot, page snapshot, click/type by ref,
  and Gmail drafts.
