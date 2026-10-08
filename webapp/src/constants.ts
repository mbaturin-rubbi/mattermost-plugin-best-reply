export const QUOTED_REPLY_POST_TYPE = 'custom_best_reply';

export const QUOTED_REPLY_PROP = 'best_reply_to';
export const QUOTED_REPLY_BODY_PROP = 'best_reply_body';
export const QUOTED_REPLY_FALLBACK_PROP = 'best_reply_fallback';
export const QUOTED_REPLY_TEXT_PROP = 'best_reply_text';

export const MAX_QUOTED_FRAGMENT_LENGTH = 500;

// The RHS thread panel is not mounted synchronously after SELECT_POST, so
// composer focus has to wait for the next render cycle (docs/api.md).
export const COMPOSER_FOCUS_DELAY_MS = 250;

// The composer mount point appears asynchronously (React portal target), so
// the preview polls for it, but only for a short window after a reply
// starts — permanent polling would keep running in the background forever.
export const PREVIEW_MOUNT_POLL_INTERVAL_MS = 150;
export const PREVIEW_MOUNT_POLL_TIMEOUT_MS = 3000;

// The permalink highlight mirrors Mattermost's own fadeout duration.
export const PERMALINK_FADEOUT_MS = 5000;

// Page size when fetching a thread before opening it in the RHS; enough for
// any thread a user realistically quotes from.
export const THREAD_FETCH_PAGE_SIZE = 200;

// Selection popup geometry: fixed width, small offset below the selection,
// and a bottom margin so the popup never leaves the viewport.
export const SELECTION_POPUP_WIDTH = 96;
export const SELECTION_POPUP_OFFSET = 12;
export const SELECTION_POPUP_BOTTOM_MARGIN = 52;
