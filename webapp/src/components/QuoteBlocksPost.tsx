import React, {useMemo, useState} from 'react';
import {useStore} from 'react-redux';

import type {Post} from '@mattermost/types/posts';

import {navigateToQuotedPost} from '../actions/navigateToPost';
import {useTranslation} from '../i18n';
import {QUOTE_BLOCKS_PROP, postQuoteScope, quoteUrl, readQuoteSnapshots, reconcileQuotes} from '../utils/quoteBlocks';

const QuoteBlocksPost: React.FC<{post: Post}> = ({post}) => {
    const store = useStore();
    const t = useTranslation();
    const [error, setError] = useState(false);
    const snapshots = readQuoteSnapshots(post.props?.[QUOTE_BLOCKS_PROP]);
    const reconciled = snapshots ? reconcileQuotes(post.message, snapshots, false, postQuoteScope(post)) : {message: post.message, quotes: []};
    const formattedBody = useMemo(() => {
        const options = {postId: post.id, editedAt: post.edit_at || 0, atMentions: true, channelId: post.channel_id};
        return window.PostUtils.messageHtmlToComponent(window.PostUtils.formatText(reconciled.message, options), false, options);
    }, [post.id, post.edit_at, post.channel_id, reconciled.message]);

    return (
        <div
            className='quoted-reply-post'
            onClickCapture={(event) => {
                const anchor = (event.target as HTMLElement).closest('a');
                const quote = reconciled.quotes.find((item) => anchor?.getAttribute('href') === quoteUrl(item));
                if (!quote || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                const sourceElement = event.currentTarget;
                setError(false);
                navigateToQuotedPost(store, quote.sourceId, {replyPost: post, sourceElement, verifyOriginal: true}).then((opened) => {
                    if (!opened) {
                        setError(true);
                    }
                }).catch(() => setError(true));
            }}
        >
            <div className='quoted-reply-post__body'>{formattedBody}</div>
            {error && <div role='status'>{t('quote_source_unavailable')}</div>}
        </div>
    );
};

export default QuoteBlocksPost;
