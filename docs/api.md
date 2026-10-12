# Mattermost internals this plugin relies on

This file is the source of truth for the undocumented Mattermost webapp
behaviors Best Reply depends on. Every entry was verified against the
webapp bundle of a running server (v11.11.0, Entry Edition) and against
observed runtime behavior. **Re-verify this file when bumping the target
server version** — all of these are internal APIs and can change without
notice.

## Post DOM (center channel, RHS, search)

Verified from the `PostView` component in the client bundle.

| Element | Attribute | Value |
|---|---|---|
| Post container | `id` | `post_<id>` in the center channel, `rhsPost_<id>` in the RHS thread, `searchResult_<id>` in search results |
| Post container | `data-testid` | `postView` / `rhsPostView` — **contains no post id** |
| Message body | `class` | `post-message__text` |
| Message body | `data-testid` | `post-message-text` (lowercase, dashes, **no post id**) |

Consequences for selection quoting (`webapp/src/utils/selection.ts`):

- Post id extraction must walk **every attribute independently**. An earlier
  implementation checked `data-postid || data-post-id || data-testid || id`
  as a fallback chain; in v11 the container has both
  `data-testid="postView"` (no id inside) and `id="post_<id>"`, and the
  non-null `data-testid` shadowed the `id` — selection quoting silently
  broke for all posts. This was a real production bug.
- `data-testid="post-message-text"` matches the shape `post-message-<x>`.
  Any pattern of that form must validate the capture with
  `/^[a-z0-9]{26}$/i` — otherwise the literal `"text"` is mistaken for a
  post id.
- Post ids are 26 lowercase alphanumeric characters.

## Plugin registry

| Registry call | Expectation |
|---|---|
| `registerPostActionComponent` / `registerPostTypeComponent` / `registerRootComponent` | A **component type**, never a JSX element. Passing an element throws React error #130 and unmounts the whole Mattermost app. Guarded by `index.test.ts` (component typeof 'function'). |
| `registerMessageWillBePostedHook` | Synchronous transformation of the outgoing post. The returned object replaces the post before it is sent. Setting `type` to a custom value makes the server store the post under that type; the webapp renders it via `registerPostTypeComponent`. |
| `registerMessageWillBeUpdatedHook` | Receives `(newPost: Partial<Post>, oldPost: Post)`, returns `{post: Partial<Post>}`. The patch may have no props; reconcile against old props and return only the patch plus changed message/props. |
| `registerTranslations` | Key-value map merged into the webapp i18n dictionaries. Best Reply uses it to rename the native Reply action to "Thread" / "Тред" (`post_info.reply`, `post_info.comment_icon.tooltip.reply`). |

### Native inline Edit bypass in v11.11.0

The hook exists but the ordinary inline editor does not invoke it:
[use_submit.tsx](https://github.com/mattermost/mattermost/blob/v11.11.0/webapp/channels/src/components/advanced_text_editor/use_submit.tsx)
dispatches [views/posts.editPost](https://github.com/mattermost/mattermost/blob/v11.11.0/webapp/channels/src/actions/views/posts.ts),
which calls [mattermost-redux editPost](https://github.com/mattermost/mattermost/blob/v11.11.0/webapp/channels/src/packages/mattermost-redux/src/actions/posts.ts).
That binds [Client4.patchPost](https://github.com/mattermost/mattermost/blob/v11.11.0/webapp/platform/client/src/client4.ts)
directly to one `fetch` with `PUT <SiteURL>/api/v4/posts/<id>/patch` and a JSON
string body. Runtime testing confirmed that relying on the hook left changed
automatic quotes attributed in the persisted server message.

`nativePostEdits.ts` wraps only that same-origin exact SiteURL endpoint,
matching `id`/`message` JSON and an existing Best Reply post owned by the current
user. It normalizes message/props before forwarding one original request.
Other endpoints, methods, users, unknown shapes, Request objects and streams
pass through untouched. Headers, credentials, abort signal, response and
errors remain owned by the native call. Disposal restores the previous fetch
when possible; if a later wrapper captured it, the disposed adapter becomes
pass-through. No follow-up repair request and no server mutation on read.

## Internal Redux actions (dispatched by string type)

Used to open/close the RHS thread panel without a Mattermost fork. All are
**undocumented and unstable**:

- `SELECT_POST` with `{postId, channelId, timestamp}` — opens the RHS
  thread for the post; `postId: ''` (with `timestamp: 0`) closes it. When
  opening, `timestamp` is `Date.now()` so the reducer treats the selection
  as fresh; when closing, `0` is enough.
- `UPDATE_RHS_STATE` with `{state: null}` — resets the RHS panel state.
- `RECEIVED_POSTS` / `RECEIVED_POSTS_IN_THREAD` — pre-fill the store so the
  thread panel renders without waiting for its own fetch.
  `RECEIVED_POSTS_IN_THREAD` additionally carries `rootId` at the top level
  of the action.
- `RECEIVED_POST` with `{data: post}` — stores a single post fetched via
  the REST API (`ensurePostLoaded`).
- `HIGHLIGHT_REPLY` with `{postId}` — flashes the post in the open RHS
  thread; `CLEAR_HIGHLIGHT_REPLY` clears it. The plugin clears the
  highlight itself after `PERMALINK_FADEOUT_MS` (5000 ms), mirroring
  Mattermost's own permalink fadeout. Re-dispatching `HIGHLIGHT_REPLY` for
  the same post requires a `CLEAR_HIGHLIGHT_REPLY` first (plus a
  `requestAnimationFrame`), otherwise the reducer sees no state change.

The RHS slice read by the plugin (`views.rhs.selectedPostId`,
`views.rhs.isSidebarOpen`, `views.rhs.highlightedPostId`,
`views.rhsSuppressed`) is webapp-internal and absent from the packaged
`@mattermost/types` `GlobalState`, so the code extends `GlobalState`
locally in `webapp/src/actions/navigateToPost.ts`.

The plugin state lives under `plugins-<plugin-id>` in the global store
(`plugins-com.bestreply.plugin`). It is not part of the `GlobalState` type
either; components read it through a narrowed cast typed directly as
`{pendingReply: PendingReply | null}`.

## Global window objects

- `window.PostUtils.formatText(message, options)` and
  `window.PostUtils.messageHtmlToComponent(html, isRHS, options)` — markdown
  rendering identical to Mattermost's own. Used by the quoted-reply block.
- `window.WebappUtils.browserHistory` — client-side navigation used for
  permalink jumps (with a `window.location.assign` fallback).

## Composer DOM

- Center channel composer: `#post-create .AdvancedTextEditor [contenteditable="true"]` / `#post_textbox`.
- Thread composer (RHS): `.sidebar--right .AdvancedTextEditor [contenteditable="true"]`.
- Global Threads view: `.ThreadViewer .AdvancedTextEditor [contenteditable="true"]`.
- Multi-quote insertion only writes native textareas, using
  `[data-testid="comment-create"] .AdvancedTextEditor__cell textarea` for a
  thread. This excludes native inline Edit controls.
- Scope RHS lookups to `#sidebar-right`, not the first `.sidebar--right`.
  Runtime v11.11.0 renders `.sidebar--right--width-holder` before the real
  sidebar; the holder has no composer and causes insertion to time out.
- `.virtual-list__ctr` contains both the rendered `rhsPost_*` posts and the
  thread composer. Its owning virtual viewer is keyed by `selected.id`.
  Verify visible posts in this same container against the target channel/root
  before insertion; Redux selection alone can advance ahead of old DOM.
- Declared minimum v9.0.0 uses `.post-create__container #reply_textbox` inside
  `.post-right__content`, without the newer data-testid/virtual-list wrapper.
  Its viewer is still keyed by `selected.id`; the same visible-post ownership
  check applies. Verified from v9 source:
  [comment container](https://github.com/mattermost/mattermost/blob/v9.0.0/webapp/channels/src/components/threading/virtualized_thread_viewer/create_comment.tsx),
  [virtual viewer](https://github.com/mattermost/mattermost/blob/v9.0.0/webapp/channels/src/components/threading/virtualized_thread_viewer/virtualized_thread_viewer.tsx),
  [editor id](https://github.com/mattermost/mattermost/blob/v9.0.0/webapp/channels/src/components/advanced_text_editor/advanced_text_editor.tsx),
  [RHS id](https://github.com/mattermost/mattermost/blob/v9.0.0/webapp/channels/src/components/sidebar_right/sidebar_right.tsx).
  This is source/fixture compatibility evidence, not a v9 runtime test.
- Caret positions are remembered from native input/select/key/mouse/blur
  events. Insert at the remembered position without replacing selected text.
  `document.execCommand('insertText')` uses native input and undo where
  supported; fallback uses the prototype textarea value setter plus a bubbling
  `input` event to update React's controlled draft. The fallback cannot retain
  browser undo for that insertion. Unsupported contenteditable editors are
  never rewritten.
- Poll after a 250 ms mount delay, stop after 3 seconds, and cancel stale
  destination/request identity. The delay is not a readiness guarantee.

The new contracts above were checked against the public v11.11.0 source:
[hook dispatch](https://github.com/mattermost/mattermost/blob/v11.11.0/webapp/channels/src/actions/hooks.ts),
[registry](https://github.com/mattermost/mattermost/blob/v11.11.0/webapp/channels/src/plugins/registry.ts),
[keyed viewer](https://github.com/mattermost/mattermost/blob/v11.11.0/webapp/channels/src/components/threading/thread_viewer/thread_viewer.tsx),
[virtual viewer](https://github.com/mattermost/mattermost/blob/v11.11.0/webapp/channels/src/components/threading/virtualized_thread_viewer/virtualized_thread_viewer.tsx),
[comment container](https://github.com/mattermost/mattermost/blob/v11.11.0/webapp/channels/src/components/threading/virtualized_thread_viewer/create_comment.tsx),
[editor](https://github.com/mattermost/mattermost/blob/v11.11.0/webapp/channels/src/components/advanced_text_editor/advanced_text_editor.tsx).
Browser undo and controlled-draft behavior require runtime verification; source
inspection and jsdom do not prove them.

## Timing constants

All timing values live in `webapp/src/constants.ts`:

| Constant | Value | Why |
|---|---|---|
| `COMPOSER_FOCUS_DELAY_MS` | 250 ms | RHS thread panel mounts asynchronously after `SELECT_POST`; focusing earlier hits no composer node. |
| `PREVIEW_MOUNT_POLL_INTERVAL_MS` | 150 ms | The composer preview portal target (`.AdvancedTextEditor__cell`) appears on Mattermost's render schedule; there is no hook, so the plugin polls. |
| `PREVIEW_MOUNT_POLL_TIMEOUT_MS` | 3000 ms | Polling stops after 3 s so a never-appearing composer does not leave a timer running forever. |
| `PERMALINK_FADEOUT_MS` | 5000 ms | Matches Mattermost's own permalink highlight fadeout. |

## Core localization keys overridden

`registerTranslations` merges these webapp i18n keys to rename the native
Reply action (the plugin's own button is the one labeled "Reply"):

- `post_info.reply` → "Thread" / "Тред" / "Fil" / "Thread"
- `post_info.comment_icon.tooltip.reply` → same set of translations

These are core webapp keys; if Mattermost renames them, the native action
label falls back to the original string.

## Post shape produced by the plugin

New posts use `custom_best_reply`, with `best_reply_quotes: {version: 2,
quotes: [{id, sourceId, author, text, url, fingerprint}]}`. The message is the authoritative,
ordered Markdown body. Each automatic block starts with
`> [**Author**](<permalink>#br-<random id>-<fingerprint>)`, followed by escaped, mention-safe
`> ` snapshot lines. The URL fragment identifies a block without a technical
label or tooltip. Comments and manual blocks are ordinary Markdown.

Create/update hooks compare each identified top-level block with its exact
snapshot. Edited blocks retain user text but lose their generated header and
metadata; absent blocks are never rebuilt. Fenced/indented code and nested
quotes are not treated as automatic blocks. Rendering performs the same
reconciliation for stale props left by mobile/plugin-disabled edits, without
writing to the server. Unknown/corrupt versioned props show the full Markdown.
Full Reply to a v2 source flattens its unchanged automatic blocks to their
snapshot text in place, preserving interleaved comments/manual Markdown and
avoiding visible block IDs or recursively generated attribution.

The 64-bit FNV-1a fingerprint covers exact generated Markdown and the authoring
user/channel/root. It is integrity bookkeeping, not authentication. The native
draft itself carries enough data to reconstruct unchanged snapshots at send;
changed/missing/tampered fingerprints become manual quotes. There is no
sidecar cache, eviction or storage quota mechanism. Reopened tabs and failed
send retries use the same native text. Rendering/editing use the original
post's author/scope, never the current reader's identity.

### Legacy single quotes

Custom type: `custom_best_reply`. Props:

| Prop | Content |
|---|---|
| `best_reply_to` | post id of the quoted message (permalink target) |
| `best_reply_body` | reply text (used for rendering when the message was transformed) |
| `best_reply_fallback` | exact generated Markdown quote prefix; only this prefix is stripped after edits |
| `best_reply_text` | selected fragment, present only for selection-based quotes |

`message` always contains a mobile-safe markdown fallback:
`> **<author>**\n> <quote>\n\n<body>`. Web/desktop clients re-render the rich
block from props; mobile clients show the raw markdown.
