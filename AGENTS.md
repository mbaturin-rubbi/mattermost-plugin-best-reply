# AGENTS.md — working on Best Reply

Guide for humans and AI agents working in this repository. Keep this file in
English. When you change behavior that is documented here, update the file in
the same commit.

## Layout

- `webapp/src/index.tsx` — plugin entry: registers extension points and the
  create/update hooks that reconcile quote snapshots against actual Markdown.
- `webapp/src/actions/` — reply/thread/navigation flows (all client-side).
- `webapp/src/components/` — Reply button, selection popup, quote blocks,
  native composer insertion, ErrorBoundary.
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
4. **Pending replies only request insertion; they never inject text at send.**
   The post hook verifies a self-contained fingerprint for the exact
   user/channel/root and reconciles only blocks already in the message.
   Native draft text carries the fingerprint across tabs, undo and retries;
   do not introduce a separate draft metadata cache.
5. **`data-testid="post-message-text"` looks like `post-message-<id>`.**
   All post-id pattern captures are validated with `/^[a-z0-9]{26}$/i`.
6. **A 250 ms delay does not prove composer ownership.** Insertion must find
   `[data-testid="comment-create"]` inside the keyed `.virtual-list__ctr`
   whose rendered `rhsPost_*` posts belong to the target channel/root.
   v9 uses `.post-create__container #reply_textbox` inside `.post-right__content`.
   Never select the first textarea: it may be an unrelated inline edit.
7. **`window.PostUtils` / internal Redux actions (`SELECT_POST`,
   `UPDATE_RHS_STATE`, `RECEIVED_POSTS_IN_THREAD`) are undocumented.** Wrap
   new uses in the same defensive style as the existing code and record them
   in `docs/api.md`.
8. **Every registered component is wrapped in ErrorBoundary** so a plugin
   render crash degrades to nothing instead of taking down the channel.

9. **A waiting insertion is cancelled on destination mismatch or timeout.**
   Ignore stale completions for a replaced/cancelled request. Once inserted,
   text belongs to the native draft; navigation never removes or reinserts it.
   Unsupported rich editors receive feedback and no DOM mutation.
10. **Updates receive `(newPost: Partial<Post>, oldPost: Post)`.** Read old
    props as well as the patch. Reconcile again during rendering because
    native/mobile clients can edit the body without updating plugin props.
    MM 11.11 inline Edit bypasses that hook: `nativePostEdits.ts` normalizes
    only its exact same-origin SiteURL post-patch request before the one host
    fetch call. Restore/pass through on unload; never issue a second repair
    request or mutate server posts while rendering.

## User decisions that must not be violated

- The plugin stays **webapp-only** (no server component).
- The native Mattermost Reply action stays renamed to "Thread" / "Тред";
  the plugin's button is the one labeled "Reply" / "Ответить".
- The plugin's Reply button always quotes inside the source thread
  (`post.root_id || post.id`), including the first reply from the channel.
  Selection quoting and Ctrl+Q also quote inside the source thread, preserving
  only the selected fragment.
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

Channel-context pending replies are cancelled when the selected channel
changes. Thread-context replies must not be cancelled based on the center
channel id because the global Threads view can show another channel.

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

New posts keep ordered Markdown in `message` and version-2 snapshots in
`best_reply_quotes`. A generated author link's URL fragment identifies its
block and carries an FNV-1a content/scope fingerprint (not authentication).
Edited bodies become manual quotes and lose generated attribution.
Never reconstruct missing text from props, strip manual/nested/code examples,
or mutate the server during rendering. Unknown metadata means plain Markdown.
Legacy single quotes retain `best_reply_fallback`/author-header compatibility;
never treat an arbitrary leading user blockquote as a generated prefix.

## Credits

Base reply UX: Azario16/mattermost-plugin-channel-reply (MIT).
Fragment selection: ZILosoft/mattermost-reply (Apache-2.0).
See NOTICE.
