# Third-party notices

PandaPi is MIT licensed (see [LICENSE](LICENSE)). It includes the following
third-party material.

## Vendored source

### anti-slop

- **Path:** `tools/oxlint/anti-slop/`
- **Source:** https://github.com/dmmulroy/anti-slop
- **Commit:** `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`
- **License:** MIT — see [`tools/oxlint/anti-slop/LICENSE`](tools/oxlint/anti-slop/LICENSE)
- **Notes:** A curated subset of the upstream Oxlint plugin. See
  [`tools/oxlint/anti-slop/UPSTREAM.md`](tools/oxlint/anti-slop/UPSTREAM.md) for
  provenance and the rules that are intentionally not enabled.

## Dependencies

Runtime and development dependencies are declared in
[`package.json`](package.json) and locked in `bun.lock`. Each package carries
its own license; the notable one is
[`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi),
which provides the agent harness this project embeds.
