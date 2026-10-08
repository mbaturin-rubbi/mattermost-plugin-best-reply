import type {Store} from 'redux';

import type {Post, PostType} from '@mattermost/types/posts';

import {getDisplayName, getPostFromState, getUserFromState, getQuotedPostDisplayMessage, truncateMessage} from './posts';

import {MAX_QUOTED_FRAGMENT_LENGTH, QUOTED_REPLY_BODY_PROP, QUOTED_REPLY_POST_TYPE, QUOTED_REPLY_PROP, QUOTED_REPLY_TEXT_PROP} from '../constants';
import type {PendingReply} from '../types/store';

export function formatMobileQuoteBlock(authorName: string, quotedMessage: string): string {
    const author = authorName.trim() || 'Unknown user';
    const message = truncateMessage(quotedMessage || 'Attachment', MAX_QUOTED_FRAGMENT_LENGTH);
    const messageLines = message.split('\n').map((line) => `> ${line}`);

    return [`> **${author}**`, ...messageLines].join('\n');
}

export function buildQuotedReplyPost(post: Post, pendingReply: PendingReply, store: Store): Post {
    const replyBody = post.message || '';
    const state = store.getState();
    const quotedPost = getPostFromState(state, pendingReply.replyToPostId);
    const quotedUser = quotedPost ? getUserFromState(state, quotedPost.user_id) : undefined;
    const quotedText = pendingReply.selectedText ||
        (quotedPost ? getQuotedPostDisplayMessage(quotedPost) : '');
    const mobileQuote = quotedPost || quotedText ? formatMobileQuoteBlock(getDisplayName(quotedUser), quotedText) : '';

    return {
        ...post,

        // Custom post types are rendered by the plugin; the server-side type
        // union does not model them, hence the cast.
        type: QUOTED_REPLY_POST_TYPE as PostType,
        message: mobileQuote ? `${mobileQuote}\n\n${replyBody}` : replyBody,
        props: {
            ...post.props,
            [QUOTED_REPLY_PROP]: pendingReply.replyToPostId,
            [QUOTED_REPLY_BODY_PROP]: replyBody,
            ...(pendingReply.selectedText ? {[QUOTED_REPLY_TEXT_PROP]: pendingReply.selectedText} : {}),
        },
    };
}
