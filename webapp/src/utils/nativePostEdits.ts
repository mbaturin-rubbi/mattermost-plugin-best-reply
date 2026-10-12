import type {Store} from 'redux';

import type {Post} from '@mattermost/types/posts';
import type {GlobalState} from '@mattermost/types/store';

import {getPostFromState, isQuotedReplyPost} from './posts';
import {reconcileEditedPost} from './quoteBlocks';

// MM 11.11 inline Edit bypasses MessageWillBeUpdated and calls Client4.patchPost
// directly. Normalize its one outgoing request; never repair posts after saving.
export function installNativePostEditReconciliation(store: Store<GlobalState>): () => void {
    const previousFetch = window.fetch;
    if (typeof previousFetch !== 'function') {
        return () => undefined;
    }
    let active = true;
    const wrappedFetch: typeof window.fetch = (input, init) => {
        let options = init;
        if (active && (typeof input === 'string' || input instanceof URL) && init?.method?.toUpperCase() === 'PUT' && typeof init.body === 'string') {
            try {
                const url = new URL(input, window.location.href);
                const match = (/\/api\/v4\/posts\/([a-z0-9]{26})\/patch$/i).exec(url.pathname);
                if (url.origin === window.location.origin && !url.search && !url.hash && match) {
                    const state = store.getState();
                    const siteURL = new URL(state.entities.general.config.SiteURL || window.location.origin, window.location.href);
                    const expectedPath = `${siteURL.pathname.replace(/\/$/, '')}/api/v4/posts/${match[1]}/patch`;
                    if (siteURL.origin !== url.origin || url.pathname !== expectedPath) {
                        return previousFetch.call(window, input, init);
                    }
                    const oldPost = getPostFromState(state, match[1]);
                    const patch: Partial<Post> | null = JSON.parse(init.body);
                    if (oldPost && oldPost.user_id === state.entities.users.currentUserId && isQuotedReplyPost(oldPost) &&
                        patch?.id === oldPost.id && typeof patch.message === 'string') {
                        const normalized = reconcileEditedPost(patch, oldPost);
                        if (normalized !== patch && (normalized.message !== patch.message || JSON.stringify(normalized.props) !== JSON.stringify(patch.props ?? oldPost.props))) {
                            options = {...init, body: JSON.stringify(normalized)};
                        }
                    }
                }
            } catch {
                // Unknown request shapes keep the host's normal validation/error path.
            }
        }
        return previousFetch.call(window, input, options);
    };
    window.fetch = wrappedFetch;
    return () => {
        active = false;
        if (window.fetch === wrappedFetch) {
            window.fetch = previousFetch;
        }
    };
}
