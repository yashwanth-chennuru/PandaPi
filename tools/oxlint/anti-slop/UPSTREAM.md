# anti-slop (curated)

This directory vendors a **curated subset** of [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop),
an opinionated Oxlint ruleset. The upstream project is meant to be vendored and
tuned per repository; this is our tuned copy.

## Provenance

- Source: `https://github.com/dmmulroy/anti-slop`
- Source commit: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`
- Upstream path: `skills/install-anti-slop/assets/anti-slop/`
- Vendored entry point: `tools/oxlint/anti-slop/index.ts`
- License: MIT (upstream)

## Enabled rules

| Rule | Why |
| --- | --- |
| `anti-slop/no-array-filter-map` | Avoids eager intermediate arrays in filter/map chains |
| `anti-slop/no-reduce-accumulator-copy` | Avoids accidental quadratic reducers |
| `anti-slop/no-chained-type-assertions` | Chained `as` casts fabricate type evidence |
| `anti-slop/no-conditional-empty-object-spread` | `...(cond ? {} : x)` hides field omission |
| `anti-slop/no-module-mocking` | Prefer real dependency seams over module mocks |
| `anti-slop/no-object-parameters` | `object` inputs erase useful shape |
| `anti-slop/no-reflect-apply` | Prefer typed calls over `Reflect.apply` |
| `anti-slop/no-reflect-get` | Prefer typed access over `Reflect.get` |
| `oxc/no-accumulating-spread` (native) | Pairs with `no-reduce-accumulator-copy` |

## Deliberately excluded

These upstream rules are **not** enabled because they conflict with legitimate
boundary typing in this project (native-messaging payloads, `JSON.parse`
results, SDK event bridging, and browser feature detection):

- `no-unknown-parameters`, `no-unknown-returns`, `no-unknown-type-aliases`
- `no-unsafe-dictionary-type`
- `no-known-value-widening`, `no-widen-then-assert`
- `no-runtime-typeof` (browser feature detection such as `typeof x === "function"`)
- `require-safety-comment-for-type-assertion`
- `require-readable-spacing` (a competing formatter; we do not run it)
- `no-shape-in-symbol-names` (project-specific naming preference, not applicable)
- all `anti-slop-effect/*` rules (this project does not depend on Effect)

## Updating

Replace the files under `rules/` and `shared/` from a newer upstream commit,
keep this `index.ts` registering only the enabled rules, and update the commit
hash above. Do not enable the excluded rules without revisiting the boundary
code they flag.
