import type {Store} from 'redux';

import type {Post} from '@mattermost/types/posts';

import {getOpenThreadRootId, getPermalinkUrl, isThreadRhsOpen} from './navigateToPost';
import {openThreadForPost} from './openThread';

import {CLEAR_PENDING_REPLY, PLUGIN_STATE_KEY, SET_PENDING_REPLY, type PendingReply, type ReplyContext} from '../types/store';
import {getDisplayName, getQuotedPostDisplayMessage, getUserFromState} from '../utils/posts';
import {fingerprintQuote} from '../utils/quoteBlocks';
import {showQuoteNotice} from '../utils/quoteNotice';
import {normalizeQuotedFragment} from '../utils/selection';

type MattermostState = Parameters<typeof isThreadRhsOpen>[0];

function getRootPostId(post: Post): string {
    return post.root_id || post.id;
}

function closeRhs(store: Store): void {
    store.dispatch({
        type: 'UPDATE_RHS_STATE',
        state: null,
    });
    store.dispatch({
        type: 'SELECT_POST',
        postId: '',
        channelId: '',
        timestamp: 0,
    });
}

export function setPendingReply(store: Store, pendingReply: PendingReply | null): void {
    store.dispatch({
        type: SET_PENDING_REPLY,
        data: pendingReply,
    });
}

export function clearPendingReply(store: Store): void {
    store.dispatch({
        type: CLEAR_PENDING_REPLY,
    });
}

export function getPendingReply(store: Store): PendingReply | null {
    const state = store.getState() as Record<string, {pendingReply: PendingReply | null} | undefined>;
    return state[PLUGIN_STATE_KEY]?.pendingReply || null;
}

function isInGlobalThreadViewer(element?: HTMLElement): boolean {
    return Boolean(element?.closest('.ThreadViewer') && !element.closest('.sidebar--right'));
}

function isThreadPanelAlreadyOpen(store: Store, post: Post, element?: HTMLElement): boolean {
    if (isInGlobalThreadViewer(element)) {
        return true;
    }

    const state = store.getState() as MattermostState;
    const rootId = getRootPostId(post);

    return isThreadRhsOpen(state) && getOpenThreadRootId(state) === rootId;
}

type StartReplyOptions = {
    context: ReplyContext;
    element?: HTMLElement;
    selectedText?: string;
};

export async function startReplyToPost(
    store: Store,
    post: Post,
    options: StartReplyOptions,
): Promise<boolean> {
    const {context, element} = options;
    const pendingReply: PendingReply = {
        replyToPostId: post.id,
        channelId: post.channel_id,
        rootId: context === 'thread' ? getRootPostId(post) : '',
        context,
        selectedText: options.selectedText ? normalizeQuotedFragment(options.selectedText) : undefined,
        surface: isInGlobalThreadViewer(element) ? 'global' : 'rhs',
    };

    const url = getPermalinkUrl(store, post.id);
    if (!url) {
        showQuoteNotice('quote_open_failed');
        return false;
    }
    pendingReply.quote = fingerprintQuote({
        id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join(''),
        sourceId: post.id,
        author: getDisplayName(getUserFromState(store.getState(), post.user_id)),
        text: pendingReply.selectedText || getQuotedPostDisplayMessage(post) || 'Attachment',
        url,
    }, {userId: store.getState().entities.users.currentUserId, channelId: pendingReply.channelId, rootId: pendingReply.rootId});

    const isOpeningThread = context === 'thread' && !isThreadPanelAlreadyOpen(store, post, element);
    const waitingReply = isOpeningThread ? {...pendingReply, isOpeningThread: true} : pendingReply;
    setPendingReply(store, waitingReply);

    if (context === 'thread') {
        if (isOpeningThread) {
            let opened;
            try {
                opened = await openThreadForPost(store, post.id, () => getPendingReply(store) === waitingReply);
            } catch (error) {
                if (getPendingReply(store) === waitingReply) {
                    clearPendingReply(store);
                    showQuoteNotice('quote_open_failed');
                }
                return false;
            }

            if (getPendingReply(store) !== waitingReply) {
                return false;
            }
            if (!opened) {
                clearPendingReply(store);
                showQuoteNotice('quote_open_failed');
                return false;
            }

            // The old composer may still exist while the target thread is loading.
            setPendingReply(store, pendingReply);
        }

        return true;
    }

    closeRhs(store);

    return true;
}
