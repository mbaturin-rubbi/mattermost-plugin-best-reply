# Multiple quotes: paused development checkpoint

Status: **paused at the user's request on 2026-10-12; not accepted for release**.
Branch: `feat/multiple-quotes`.
Base: `ec4ee01e59d069062ff92cc673a50e2acb9bb5f3` (fragment-to-thread fix,
[PR #39](https://github.com/arxell/mattermost-plugin-best-reply/pull/39)).
Recheck upstream and that PR before resuming; their current status is not a
prerequisite for saving this checkpoint. No feature PR, merge, tag, or release
is part of this checkpoint.

## Agreed behavior

- Use the native Mattermost composer; quote, comment, quote, comment in one
  source-thread reply. Quote/Ctrl+Q inserts at the remembered draft caret.
- Primary scope: several fragments from one source message, plus manual
  Markdown quotes. Cross-thread/channel collection is not implemented.
- Each automatic block retains its snapshot, author, and original link.
  Editing its text converts it to a manual quote without generated attribution.
  Manual quotes remain editable before and after sending.
- Preserve drafts, undo/redo, source-thread ownership, legacy posts, readable
  mobile/plugin-disabled Markdown, and quoted-mention protection.

## Implementation and review

GPT-6 Astra implemented the branch; the parent agent reviewed it and ran local
Mattermost checks. Review fixes include the real RHS container selector,
composer ownership during delayed remounts, excluding inline edit textareas,
HTTP-compatible random identifiers, fresh-tab draft tracking, and native web
post edits that bypass Mattermost's registered update hook.

New snapshot metadata uses `best_reply_quotes` version 2. The generated link
fragment contains a block identifier and an FNV-1a content/scope fingerprint.
This fingerprint is bookkeeping, not authentication. Draft metadata has no
separate session/local-storage sidecar. `nativePostEdits.ts` narrowly reconciles
the host's existing post-patch fetch; it does not send an additional repair
request. Rendering never changes server posts. See `docs/api.md` for details.

Last runtime-tested JavaScript SHA-256:
`A3BC24E5F5346828D1DD7E1637A60A6A30E4F4B571FF0C8D11E8E39DF0C4342B`.
The archived bundle predates this checkpoint commit; its generated manifest
therefore describes the base commit plus a dirty working tree, not this commit.

- Parent independently ran **167 tests in 17 files**, all passing.
- Implementer reported lint, typecheck, production build, and diff checks pass.
- Mattermost 11.11 runtime: insertion into the middle of a draft, native Edit
  persistence, fresh-tab draft restoration, global Threads, mention counters,
  other-reader rendering, and stale metadata after an external edit checked.
- Mattermost 9.0 runtime: multiple quote creation and native Edit persistence
  checked on the final bundle.
- Earlier round: mixed automatic/manual quotes, native undo/redo, source
  edit/delete behavior, draft isolation, and malformed metadata checked.
  Do not claim all earlier scenarios were repeated on the final bundle.
- Plugin-disabled clean reload retained readable Markdown. Native Android/iOS
  was researched but **not run**. A separate report records future options.

## Open UX issue: do not ship as accepted

The current implementation removed the old visual composer card and renders
new posts as ordinary Markdown blockquotes. The user challenged that loss of
visual presentation. Earlier permission to use a text editor did not amount to
acceptance of this UX. The feature was paused before a replacement was chosen.

`ReplyQuote.tsx` and its styles still exist for legacy posts. A live preview of
the complete reply and restored cards in sent posts are feasible candidates.
Inline cards between editable comments, with no Markdown or technical links
visible in the editor, need a separate integration investigation. A textarea
cannot contain such cards. Do not claim support through an unverified rich
editor plugin API or silently replace the native composer.

## Resume sequence

1. Read the saved local handoff and evidence; fetch upstream and inspect the
   actual branch base before merging or rebasing anything.
2. Agree on live preview versus inline visual editing. No implementation of
   that choice was authorized when this checkpoint was saved.
3. Return the selected UX work to the implementer and repeat independent review.
4. Repeat the relevant regression matrix on the exact resulting bundle,
   including prior fixes and draft/undo/edit lifecycles.
5. Create a feature PR and check CI only after acceptance. An earlier issue
   creation form had no confirmed issue number; check for duplicates first.
6. Record the requested multiple Russian-language MP4 demonstrations. Only the
   older single-quote example exists; new-feature videos are still outstanding.

Native clients cannot run this webapp-only plugin's edit hooks. An external
edit may leave old attribution in the server's Markdown; the web renderer
reconciles stale metadata without rewriting server content. This limitation,
the DOM coupling, and the native-edit fetch adapter need explicit review when
resuming. No claim of complete regression freedom is made by this checkpoint.
