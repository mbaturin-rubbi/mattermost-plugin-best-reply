import React, {useEffect, useState} from 'react';
import {createPortal} from 'react-dom';
import {useSelector, useStore} from 'react-redux';

import type {GlobalState} from '@mattermost/types/store';

import ReplyQuote from './ReplyQuote';

import {clearPendingReply} from '../actions/reply';
import {PREVIEW_MOUNT_POLL_INTERVAL_MS, PREVIEW_MOUNT_POLL_TIMEOUT_MS} from '../constants';
import {PLUGIN_STATE_KEY, type PendingReply} from '../types/store';
import {getPostFromState, getUserFromState, getDisplayName} from '../utils/posts';

const ReplyComposerPreview: React.FC = () => {
    const store = useStore();
    const pendingReply = useSelector((state: GlobalState) => {
        // The plugin slice is mounted under `plugins-<plugin-id>` by
        // registerReducer and is not part of GlobalState
        // (docs/api.md#internal-redux-actions).
        const pluginState = (state as unknown as Record<string, {pendingReply: PendingReply | null} | undefined>)[PLUGIN_STATE_KEY];
        return pluginState?.pendingReply ?? null;
    });

    const replyPost = useSelector((state: GlobalState) => {
        if (!pendingReply) {
            return undefined;
        }
        return getPostFromState(state, pendingReply.replyToPostId);
    });

    const replyUser = useSelector((state: GlobalState) => {
        if (!replyPost) {
            return undefined;
        }
        return getUserFromState(state, replyPost.user_id);
    });

    const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);

    useEffect(() => {
        if (!pendingReply) {
            setPortalHost(null);
            return undefined;
        }

        let hostElement: HTMLDivElement | null = null;

        const mountPreview = () => {
            const mountTarget = (
                pendingReply.context === 'thread' ? document.querySelector('.ThreadViewer .AdvancedTextEditor__cell') ||
                    document.querySelector('.sidebar--right .AdvancedTextEditor__cell') : document.querySelector('#post-create .AdvancedTextEditor__cell')
            ) as HTMLElement | null;

            if (!mountTarget) {
                return;
            }

            if (!hostElement || hostElement.parentElement !== mountTarget) {
                hostElement?.remove();
                hostElement = document.createElement('div');
                hostElement.className = 'quoted-reply-composer-host';
                mountTarget.insertBefore(hostElement, mountTarget.firstChild);
                setPortalHost(hostElement);
            }
        };

        // A detached portal must not leave an invisible quote armed for sending.
        const observer = new MutationObserver(() => {
            if (hostElement && !hostElement.isConnected) {
                clearPendingReply(store);
            }
        });
        observer.observe(document.body, {childList: true, subtree: true});

        mountPreview();
        const intervalId = window.setInterval(mountPreview, PREVIEW_MOUNT_POLL_INTERVAL_MS);
        const timeoutId = window.setTimeout(() => window.clearInterval(intervalId), PREVIEW_MOUNT_POLL_TIMEOUT_MS);

        return () => {
            observer.disconnect();
            window.clearInterval(intervalId);
            window.clearTimeout(timeoutId);
            hostElement?.remove();
            setPortalHost(null);
        };
    }, [pendingReply, store]);

    if (!pendingReply || !replyPost || !portalHost) {
        return null;
    }

    return createPortal(
        <div className='quoted-reply-composer-preview'>
            <ReplyQuote
                post={replyPost}
                username={getDisplayName(replyUser)}
                user={replyUser}
                onClose={() => clearPendingReply(store)}
                quoteText={pendingReply.selectedText}
            />
        </div>,
        portalHost,
    );
};

export default ReplyComposerPreview;
