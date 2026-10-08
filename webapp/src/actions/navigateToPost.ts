import type {Store} from 'redux';

import type {Post} from '@mattermost/types/posts';
import type {GlobalState} from '@mattermost/types/store';

import {getPostFromStore, openThreadForPost} from './openThread';

import {PERMALINK_FADEOUT_MS} from '../constants';
import {getPostFromState} from '../utils/posts';

const HIGHLIGHT_REPLY = 'HIGHLIGHT_REPLY';
const CLEAR_HIGHLIGHT_REPLY = 'CLEAR_HIGHLIGHT_REPLY';
const RECEIVED_THREAD = 'RECEIVED_THREAD';

// GlobalState covers entities.*, but views.rhs is webapp-internal and
// missing from the packaged @mattermost/types, so it stays a local
// extension (docs/api.md#internal-redux-actions).
type MattermostState = GlobalState & {
    views?: {
        rhs?: {
            selectedPostId?: string;
            isSidebarOpen?: boolean;
            highlightedPostId?: string;
        };
        rhsSuppressed?: boolean;
    };
    entities?: GlobalState['entities'] & {
        threads?: {
            threads?: Record<string, {id?: string}>;
        };
    };
};

function isPostInThread(post: Post, threadRootId: string): boolean {
    return post.id === threadRootId || post.root_id === threadRootId;
}

export function getThreadRootId(post: Post): string {
    return post.root_id || post.id;
}

export type QuoteClickSurface = 'channel' | 'rhs' | 'thread-viewer';

// Which surface a quoted reply was clicked in. The RHS thread panel renders
// a ThreadViewer inside .sidebar--right, so the sidebar check has to come
// first (mirrors the composer detection in reply.ts).
export function getClickSurface(element?: HTMLElement | null): QuoteClickSurface {
    if (!element) {
        return 'channel';
    }

    if (element.closest('.sidebar--right')) {
        return 'rhs';
    }

    if (element.closest('.ThreadViewer')) {
        return 'thread-viewer';
    }

    return 'channel';
}

export function isThreadRhsOpen(state: MattermostState): boolean {
    return Boolean(
        state.views?.rhs?.isSidebarOpen &&
        !state.views?.rhsSuppressed &&
        state.views?.rhs?.selectedPostId,
    );
}

export function getOpenThreadRootId(state: MattermostState): string | null {
    return state.views?.rhs?.selectedPostId || null;
}

let highlightClearTimeout: number | undefined;

function scheduleHighlightClear(store: Store): void {
    if (highlightClearTimeout) {
        window.clearTimeout(highlightClearTimeout);
    }

    highlightClearTimeout = window.setTimeout(() => {
        store.dispatch({type: CLEAR_HIGHLIGHT_REPLY});
        highlightClearTimeout = undefined;
    }, PERMALINK_FADEOUT_MS);
}

function highlightPost(store: Store, postId: string): void {
    const state: MattermostState = store.getState();
    const currentHighlight = state.views?.rhs?.highlightedPostId;

    if (currentHighlight === postId) {
        store.dispatch({type: CLEAR_HIGHLIGHT_REPLY});
        window.requestAnimationFrame(() => {
            store.dispatch({type: HIGHLIGHT_REPLY, postId});
            scheduleHighlightClear(store);
        });
        return;
    }

    store.dispatch({type: HIGHLIGHT_REPLY, postId});
    scheduleHighlightClear(store);
}

function tryNavigateWithinOpenThread(store: Store, post: Post): boolean {
    const state: MattermostState = store.getState();

    if (!isThreadRhsOpen(state)) {
        return false;
    }

    const threadRootId = getOpenThreadRootId(state);
    if (!threadRootId || !isPostInThread(post, threadRootId)) {
        return false;
    }

    highlightPost(store, post.id);
    return true;
}

// A quote clicked inside the RHS thread panel must not touch the center
// channel: switch the panel to the quoted thread instead. Only takes over
// when the RHS already shows a thread; other panels (search, flagged posts)
// keep the permalink behavior.
async function tryOpenThreadInRhs(store: Store, post: Post): Promise<boolean> {
    if (!isThreadRhsOpen(store.getState() as MattermostState)) {
        return false;
    }

    const opened = await openThreadForPost(store, post.id);
    if (opened) {
        highlightPost(store, post.id);
    }

    return opened;
}

export function getThreadsPagePath(state: MattermostState, post: Post): string | null {
    const teamName = getTeamNameForPost(state, post);
    if (!teamName) {
        return null;
    }

    return `/${teamName}/threads/${getThreadRootId(post)}`;
}

function isThreadInStore(state: MattermostState, threadRootId: string): boolean {
    return Boolean(state.entities?.threads?.threads?.[threadRootId]);
}

// The global threads page resolves the viewed thread through the per-user
// threads entity (getThread(state, id)), which RECEIVED_POSTS_IN_THREAD does
// not populate — fetch the thread and dispatch RECEIVED_THREAD so the
// viewer pane can render a thread the user has not interacted with before.
async function ensureThreadInStore(store: Store, post: Post): Promise<boolean> {
    const state = store.getState() as MattermostState;
    const rootId = getThreadRootId(post);

    if (isThreadInStore(state, rootId)) {
        return true;
    }

    const channelId = post.channel_id;
    const channel = state.entities.channels.channels[channelId];
    const teamId = channel?.team_id || state.entities.teams.currentTeamId;
    const currentUserId = state.entities.users.currentUserId;
    if (!teamId || !currentUserId) {
        return false;
    }

    const response = await fetch(`${getSiteUrl(store)}/api/v4/users/${currentUserId}/teams/${teamId}/threads/${rootId}`, {
        credentials: 'same-origin',
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
        },
    });

    if (!response.ok) {
        return false;
    }

    store.dispatch({
        type: RECEIVED_THREAD,
        data: await response.json(),
    });

    return true;
}

// On the global threads page the viewed thread lives in the route and the
// posts/threads stores, not in views.rhs, so the rhs-based checks never
// match there — and a permalink would replace the whole page with a channel
// view. Same-thread quotes only highlight; cross-thread quotes switch the
// viewer to the quoted thread without leaving the page.
async function navigateInThreadViewer(store: Store, post: Post, replyPost: Post): Promise<boolean> {
    if (isPostInThread(post, getThreadRootId(replyPost))) {
        highlightPost(store, post.id);
        return true;
    }

    const opened = await openThreadForPost(store, post.id);
    if (!opened || !(await ensureThreadInStore(store, post))) {
        return false;
    }

    const path = getThreadsPagePath(store.getState() as MattermostState, post);
    if (!path) {
        return false;
    }

    if (window.WebappUtils?.browserHistory) {
        window.WebappUtils.browserHistory.push(path);
    } else {
        window.location.assign(path);
    }

    highlightPost(store, post.id);
    return true;
}

function getSiteUrl(store: Store): string {
    const state: GlobalState = store.getState();
    return state.entities.general.config.SiteURL || window.location.origin;
}

function getTeamNameForPost(state: MattermostState, post: Post): string | null {
    const channel = state.entities.channels.channels[post.channel_id];
    const teamId = channel?.team_id || state.entities.teams.currentTeamId;
    const team = teamId ? state.entities.teams.teams[teamId] : undefined;

    return team?.name || null;
}

export function getPermalinkPath(state: MattermostState, postId: string): string | null {
    const post = getPostFromState(state, postId);
    if (!post) {
        return null;
    }

    const teamName = getTeamNameForPost(state, post);
    if (!teamName) {
        return null;
    }

    return `/${teamName}/pl/${postId}`;
}

export function getPermalinkUrl(store: Store, postId: string): string | null {
    const path = getPermalinkPath(store.getState(), postId);
    if (!path) {
        return null;
    }

    return `${getSiteUrl(store).replace(/\/$/, '')}${path}`;
}

export async function ensurePostLoaded(store: Store, postId: string): Promise<Post | undefined> {
    if (typeof postId !== 'string' || !(/^[a-z0-9]{26}$/i).test(postId)) {
        return undefined;
    }

    let post = getPostFromStore(store, postId) || getPostFromState(store.getState(), postId);
    if (post) {
        return post;
    }

    const response = await fetch(`${getSiteUrl(store)}/api/v4/posts/${postId}`, {
        credentials: 'same-origin',
        headers: {
            'X-Requested-With': 'XMLHttpRequest',
        },
    });

    if (!response.ok) {
        return undefined;
    }

    post = await response.json();
    store.dispatch({
        type: 'RECEIVED_POST',
        data: post,
    });

    return post;
}

declare global {
    interface Window {
        WebappUtils?: {
            browserHistory: {
                push: (path: string) => void;
            };
        };
    }
}

type NavigateOptions = {

    // The post the clicked quote lives in. On the global threads page it
    // identifies the thread the viewer currently shows (no rhs state there).
    replyPost?: Post;

    // DOM root of the clicked post; determines the surface (channel, rhs,
    // global thread viewer) the quote was clicked in.
    sourceElement?: HTMLElement | null;
};

export async function navigateToQuotedPost(store: Store, postId: string, options?: NavigateOptions): Promise<boolean> {
    const post = await ensurePostLoaded(store, postId);
    if (!post) {
        return false;
    }

    const surface = getClickSurface(options?.sourceElement);

    if (surface === 'thread-viewer' && options?.replyPost && await navigateInThreadViewer(store, post, options.replyPost)) {
        return true;
    }

    if (tryNavigateWithinOpenThread(store, post)) {
        return true;
    }

    if (surface === 'rhs' && await tryOpenThreadInRhs(store, post)) {
        return true;
    }

    const permalinkPath = getPermalinkPath(store.getState(), postId);
    if (!permalinkPath) {
        return false;
    }

    if (window.WebappUtils?.browserHistory) {
        window.WebappUtils.browserHistory.push(permalinkPath);
        return true;
    }

    window.location.assign(permalinkPath);
    return true;
}
