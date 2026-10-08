import React, {useCallback, useEffect, useMemo} from 'react';
import {useSelector, useStore} from 'react-redux';

import type {Post} from '@mattermost/types/posts';
import type {GlobalState} from '@mattermost/types/store';

import ReplyQuote from './ReplyQuote';

import {ensurePostLoaded, getPermalinkUrl, navigateToQuotedPost} from '../actions/navigateToPost';
import {QUOTED_REPLY_PROP} from '../constants';
import {getPostFromState, getUserFromState, getDisplayName, getQuotedReplyBody, getQuotedFragment} from '../utils/posts';

type PostFormatOptions = {
    postId?: string;
    editedAt?: number;
    atMentions?: boolean;
    channelId?: string;
};

declare global {
    interface Window {
        PostUtils: {
            formatText: (message: string, options?: PostFormatOptions) => string;
            messageHtmlToComponent: (html: string, isRHS?: boolean, options?: PostFormatOptions) => React.ReactNode;
        };
    }
}

type Props = {
    post: Post;
};

const QuotedReplyPost: React.FC<Props> = ({post}) => {
    const store = useStore();
    const containerRef = React.useRef<HTMLDivElement>(null);
    const replyToPostId = post.props?.[QUOTED_REPLY_PROP] as string | undefined;
    const quotedFragment = getQuotedFragment(post);

    const replyPost = useSelector((state: GlobalState) => {
        if (!replyToPostId) {
            return undefined;
        }
        return getPostFromState(state, replyToPostId);
    });

    const replyUser = useSelector((state: GlobalState) => {
        if (!replyPost) {
            return undefined;
        }
        return getUserFromState(state, replyPost.user_id);
    });

    useEffect(() => {
        if (replyToPostId && !replyPost) {
            // Keep the stored Markdown readable if the original cannot be fetched.
            ensurePostLoaded(store, replyToPostId).catch(() => undefined);
        }
    }, [replyToPostId, replyPost, store]);

    const permalink = replyToPostId && replyPost ? getPermalinkUrl(store, replyToPostId) : null;

    const handleQuoteClick = useCallback(() => {
        if (!replyToPostId) {
            return;
        }

        navigateToQuotedPost(store, replyToPostId, {replyPost: post, sourceElement: containerRef.current});
    }, [replyToPostId, store, post]);

    const replyBody = replyPost || quotedFragment ? getQuotedReplyBody(post) : post.message;
    const formattedBody = useMemo(() => {
        const formatOptions: PostFormatOptions = {
            postId: post.id,
            editedAt: post.edit_at || 0,
            atMentions: true,
            channelId: post.channel_id,
        };
        const formattedText = window.PostUtils.formatText(replyBody, formatOptions);

        return window.PostUtils.messageHtmlToComponent(formattedText, false, formatOptions);
    }, [post.edit_at, post.id, post.channel_id, replyBody]);

    return (
        <div
            className='quoted-reply-post'
            ref={containerRef}
        >
            {(replyPost || quotedFragment) && (
                <ReplyQuote
                    post={replyPost ?? post}
                    username={getDisplayName(replyUser)}
                    user={replyUser}
                    permalink={permalink}
                    onNavigate={handleQuoteClick}
                    compact={true}
                    quoteText={quotedFragment}
                />
            )}
            <div className='quoted-reply-post__body'>
                {formattedBody}
            </div>
        </div>
    );
};

export default QuotedReplyPost;
