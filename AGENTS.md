# AGENTS.md — working on Best Reply

Guide for humans and AI agents working in this repository. Keep this file in
English. When you change behavior that is documented here, update the file in
the same commit.

## Layout

- `webapp/src/index.tsx` — plugin entry: registers every extension point, owns
  the `messageWillBePosted` hook that converts the next matching post into a
  quoted reply.
- `webapp/src/actions/` — reply/thread/navigation flows (all client-side).
- `webapp/src/components/` — Reply button, selection popup, quote blocks,
  composer preview, ErrorBoundary.
- `webapp/src/utils/` — pure helpers (selection, posts, mobile fallback).
- `docs/api.md` — verified semantics of the Mattermost internals we depend on.
  Read it before touching DOM selection, Redux dispatches, or the composer.

## Dev loop

```bash
make check-style   # ESLint + tsc (depends on apply)
make test          # vitest (depends on apply)
make coverage      # vitest with v8 coverage
make dist          # build webapp + assemble dist/com.bestreply.plugin-<version>.tar.gz
```

`make apply` regenerates `webapp/src/manifest.ts` from `plugin.json` +
`git describe` and is a dependency of every target above, so it is never
run by hand in practice. Only when invoking npm scripts directly inside
`webapp/` (e.g. `npm run build` after a fresh clone) run
`node scripts/sync-manifest.mjs` first — tsc/vitest/webpack all fail on the
missing generated file otherwise.

`make watch` rebuilds on change, and `make deploy` uploads and enables the
bundle on `$MM_SERVICESETTINGS_SITEURL` (default http://localhost:8065)
using `$MM_ADMIN_TOKEN`.

## Publishing

- CI mirrors the official Mattermost plugin pipeline through the same make
  targets (`check-style`/`test`/`dist`); the reusable
  `mattermost/actions-workflows` workflow is not used because it requires
  Go unconditionally (setup-go + `go mod tidy`) and this repo has no
  server component. If the reusable workflow ever gains a webapp-only mode,
  switch back to it.
- Releases are tag-driven only: `git tag vX.Y.Z` (with `plugin.json`
  version bumped to match) triggers the release job — never create
  releases or tags manually without an explicit request. The bundle version
  comes from the git tag via `sync-manifest.mjs`.
- The coverage badge lives on the orphaned-style `coverage-badge` branch,
  rewritten on every push to main (`coverage-badge.json` is gitignored on
  main).

Test against a local server: upload the bundle
(System Console → Plugin Management, or
`curl -F plugin=@dist/... -F force=true .../api/v4/plugins` with a sysadmin
token), then hard-refresh the web client.

## Critical gotchas (learned the hard way)

1. **Post id extraction must check each DOM attribute independently.** The
   Mattermost 11.x post container has `data-testid="postView"` (no id) and
   `id="post_<id>"`; a `||` fallback chain lets the testid shadow the id and
   silently disables selection quoting. See `docs/api.md`.
2. **Never pass JSX elements to the plugin registry** — component types only,
   or React error #130 unmounts the whole Mattermost app. Guarded by
   `index.test.ts`.
3. **macOS tar writes pax archives that Mattermost's extractor rejects.**
   The Makefile bundles with `COPYFILE_DISABLE=1 tar --format=ustar`.
   Do not "simplify" that line.
4. **The registry `messageWillBePosted` hook owns single-use pending replies.**
   Any post that does not match the pending reply (wrong channel, wrong
   thread, channel context but `root_id` set) must pass through untouched,
   and the pending reply is only cleared on a match — otherwise the next
   unrelated message eats the quote.
5. **`data-testid="post-message-text"` looks like `post-message-<id>`.**
   All post-id pattern captures are validated with `/^[a-z0-9]{26}$/i`.
6. **Composer focus uses a 250 ms timeout** because the RHS thread panel is
   not mounted synchronously after `SELECT_POST`. Resist "fixing" the
   timeout without a replacement mechanism.
7. **`window.PostUtils` / internal Redux actions (`SELECT_POST`,
   `UPDATE_RHS_STATE`, `RECEIVED_POSTS_IN_THREAD`) are undocumented.** Wrap
   new uses in the same defensive style as the existing code and record them
   in `docs/api.md`.
8. **Every registered component is wrapped in ErrorBoundary** so a plugin
   render crash degrades to nothing instead of taking down the channel.

9. **Removing a composer cancels its pending quote.** The preview observes
   DOM removal while a quote is active; do not leave a detached portal with
   an armed message hook after the initial mounting poll has stopped.

## User decisions that must not be violated

- The plugin stays **webapp-only** (no server component).
- The native Mattermost Reply action stays renamed to "Thread" / "Тред";
  the plugin's button is the one labeled "Reply" / "Ответить".
- Fragments are capped at 500 characters; whole-message quotes are not
  capped.
- Mobile clients must always see a readable markdown quote in the message
  body — never props-only rendering.

## Toolchain decisions

- `@mattermost/eslint-plugin` is pinned to `1.1.0-0` (a prerelease): the
  registry only publishes `1.0.0` and `1.1.0-0`, and `1.1.0-0` is the version
  the unified config `plugin:@mattermost/react` is built for. Only
  `header/header` is turned off; everything else stays as the plugin sets it.
- `webapp/src/manifest.ts` is generated by `webapp/scripts/sync-manifest.mjs`
  (run via `make apply`; `make webapp`/`dist`/`check`/`test` depend on it)
  from `plugin.json` + `git describe --tags --dirty`. It is gitignored —
  do not edit or commit it. `plugin.json.version` stays the
  release-declared version and must match the `v*` tag at release time.

## Code conventions

- `PluginRegistry` typings live in `webapp/src/types/mattermost-webapp/
  index.d.ts` (trimmed to the methods this plugin uses) — import the type
  from there, do not redeclare it in `index.tsx`.
- Redux state reads use `GlobalState` from `@mattermost/types`. The only
  remaining casts are the webapp-internal `views.rhs` slice
  (local `GlobalState` extension in `navigateToPost.ts`) and the plugin
  state slice under `plugins-<plugin-id>`; both carry a comment pointing to
  `docs/api.md`. Keep it that way — no new umbrella casts.
- Magic numbers (timeouts, page sizes, popup geometry) are named constants
  in `webapp/src/constants.ts` with a one-line "why".

## Credits

Base reply UX: Azario16/mattermost-plugin-channel-reply (MIT).
Fragment selection: ZILosoft/mattermost-reply (Apache-2.0).
See NOTICE.
