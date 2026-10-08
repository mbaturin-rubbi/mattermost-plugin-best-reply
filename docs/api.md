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
| `registerTranslations` | Key-value map merged into the webapp i18n dictionaries. Best Reply uses it to rename the native Reply action to "Thread" / "Тред" (`post_info.reply`, `post_info.comment_icon.tooltip.reply`). |

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
- The composer preview portal mounts into `.AdvancedTextEditor__cell`
  (`.ThreadViewer` / `.sidebar--right` for threads, `#post-create` for the
  center channel).
- The composer is focused via `setTimeout` after opening a thread
  (`COMPOSER_FOCUS_DELAY_MS` = 250 ms) — the panel is not mounted
  synchronously.

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
