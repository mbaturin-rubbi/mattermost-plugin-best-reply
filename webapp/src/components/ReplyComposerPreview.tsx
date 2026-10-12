import React, {useEffect, useState} from 'react';
import {useSelector, useStore} from 'react-redux';

import type {GlobalState} from '@mattermost/types/store';

import {getOpenThreadRootId, isThreadRhsOpen} from '../actions/navigateToPost';
import {clearPendingReply, getPendingReply} from '../actions/reply';
import {COMPOSER_FOCUS_DELAY_MS, PREVIEW_MOUNT_POLL_INTERVAL_MS, PREVIEW_MOUNT_POLL_TIMEOUT_MS} from '../constants';
import {useTranslation} from '../i18n';
import type {MessageId} from '../i18n/messages';
import {PLUGIN_STATE_KEY, type PendingReply} from '../types/store';
import {insertIntoComposer, rememberComposerCaret} from '../utils/composer';
import {getPostFromState} from '../utils/posts';
import {QUOTE_NOTICE_EVENT} from '../utils/quoteNotice';

const ReplyComposerPreview: React.FC = () => {
    const store = useStore();
    const [error, setError] = useState<MessageId | ''>('');
    const t = useTranslation();
    const pendingReply = useSelector((state: GlobalState) => {
        // The plugin slice is outside packaged GlobalState (docs/api.md).
        return (state as unknown as Record<string, {pendingReply: PendingReply | null}>)[PLUGIN_STATE_KEY]?.pendingReply;
    });

    useEffect(() => {
        const events = ['input', 'select', 'keyup', 'mouseup', 'focusout'];
        const notice = (event: Event) => setError((event as CustomEvent<MessageId>).detail);
        window.addEventListener(QUOTE_NOTICE_EVENT, notice);
        events.forEach((name) => document.addEventListener(name, rememberComposerCaret, true));
        return () => {
            window.removeEventListener(QUOTE_NOTICE_EVENT, notice);
            events.forEach((name) => document.removeEventListener(name, rememberComposerCaret, true));
        };
    }, []);

    useEffect(() => {
        if (!pendingReply || pendingReply.isOpeningThread || !pendingReply.quote) {
            return undefined;
        }
        setError('');
        let intervalId: number | undefined;
        const startedAt = Date.now();
        const insert = () => {
            if (getPendingReply(store) !== pendingReply) {
                return;
            }
            const state = store.getState() as GlobalState;
            const globalViewer = [...document.querySelectorAll<HTMLElement>('.ThreadViewer')].find((node) => !node.closest('.sidebar--right'));
            const surface = pendingReply.surface === 'global' ? globalViewer : document.querySelector(pendingReply.context === 'thread' ? '#sidebar-right' : '#post-create');
            let wrongDestination = state.entities.channels.currentChannelId !== pendingReply.channelId;
            if (pendingReply.context === 'thread') {
                wrongDestination = pendingReply.surface !== 'global' && (!isThreadRhsOpen(state) || getOpenThreadRootId(state) !== pendingReply.rootId);
            }
            if (wrongDestination) {
                clearPendingReply(store);
                return;
            }
            const selector = pendingReply.context === 'thread' ? '[data-testid="comment-create"] .AdvancedTextEditor__cell textarea' : '.AdvancedTextEditor__cell textarea';
            const textarea = surface?.querySelector<HTMLTextAreaElement>(selector) || surface?.querySelector<HTMLTextAreaElement>('.post-create__container .AdvancedTextEditor__cell #reply_textbox');
            const viewer = textarea?.closest('.virtual-list__ctr, .post-right__content');

            // The virtual viewer is keyed by thread id; its posts and composer
            // mount together, whereas SELECT_POST can precede the DOM update.
            const belongsToThread = pendingReply.context !== 'thread' || Boolean(viewer && [...viewer.querySelectorAll('[id^="rhsPost_"]')].some((node) => {
                const post = getPostFromState(state, node.id.slice('rhsPost_'.length));
                return post?.channel_id === pendingReply.channelId && (post.root_id || post.id) === pendingReply.rootId;
            }));
            if (textarea && belongsToThread) {
                if (!insertIntoComposer(textarea, pendingReply.quote!)) {
                    setError('quote_insert_failed');
                }
                clearPendingReply(store);
                return;
            }
            if (surface?.querySelector('[contenteditable="true"]') || Date.now() - startedAt >= PREVIEW_MOUNT_POLL_TIMEOUT_MS) {
                setError('quote_editor_unavailable');
                clearPendingReply(store);
            }
        };
        const timer = window.setTimeout(() => {
            insert();
            intervalId = window.setInterval(insert, PREVIEW_MOUNT_POLL_INTERVAL_MS);
        }, COMPOSER_FOCUS_DELAY_MS);
        return () => {
            window.clearTimeout(timer);
            window.clearInterval(intervalId);
        };
    }, [pendingReply, store]);

    if (!error && !pendingReply) {
        return null;
    }
    return (
        <div
            className='best-reply-notice'
            role='status'
        >
            {t(error || 'quote_loading')}
            <button
                type='button'
                aria-label={t(error ? 'quote_dismiss' : 'quote_cancel')}
                onClick={() => {
                    setError('');
                    clearPendingReply(store);
                }}
            >
                {'×'}
            </button>
        </div>
    );
};

export default ReplyComposerPreview;
