import {describe, expect, it} from 'vitest';

import type {Post} from '@mattermost/types/posts';

import {formatMobileQuoteBlock, buildQuotedReplyPost} from './mobileQuote';

import {QUOTED_REPLY_BODY_PROP, QUOTED_REPLY_POST_TYPE, QUOTED_REPLY_PROP, QUOTED_REPLY_TEXT_PROP} from '../constants';
import type {PendingReply} from '../types/store';

function makeState(posts: Record<string, Post> = {}, profiles: Record<string, unknown> = {}): unknown {
    return {
        entities: {
            posts: {posts},
            users: {profiles},
        },
    };
}

function makeStore(state: unknown): {getState: () => unknown} {
    return {getState: () => state};
}

function makePost(overrides: Partial<Post> = {}): Post {
    return {
        id: 'newpost',
        channel_id: 'channelid',
        user_id: 'me',
        message: 'тело ответа',
        props: {},
        ...overrides,
    } as Post;
}

const basePending: PendingReply = {
    replyToPostId: 'quotedid',
    channelId: 'channelid',
    rootId: '',
    context: 'channel',
};

describe('formatMobileQuoteBlock', () => {
    it('formats the author line and quoted text on one line', () => {
        const block = formatMobileQuoteBlock('Anna Author', 'первая строка\nвторая строка');
        expect(block).toBe('> **Anna Author**\n> первая строка вторая строка');
    });

    it('truncates long quotes and handles empty authors', () => {
        const block = formatMobileQuoteBlock('', 'x'.repeat(600));
        expect(block.startsWith('> **Unknown user**')).toBe(true);
        expect(block.length).toBeLessThan(600);
    });
});

describe('buildQuotedReplyPost', () => {
    it('marks the post with the custom type and props', () => {
        const result = buildQuotedReplyPost(makePost(), basePending, makeStore(makeState()) as never);

        expect(result.type).toBe(QUOTED_REPLY_POST_TYPE);
        expect(result.props[QUOTED_REPLY_PROP]).toBe('quotedid');
        expect(result.props[QUOTED_REPLY_BODY_PROP]).toBe('тело ответа');
    });

    it('keeps the original message when the quoted post is unavailable', () => {
        const result = buildQuotedReplyPost(makePost(), basePending, makeStore(makeState()) as never);

        expect(result.message).toBe('тело ответа');
        expect(result.props[QUOTED_REPLY_TEXT_PROP]).toBeUndefined();
    });

    it('quotes the whole original message when there is no selection', () => {
        const quoted = makePost({id: 'quotedid', message: 'оригинал'});
        const store = makeStore(makeState({quotedid: quoted})) as never;

        const result = buildQuotedReplyPost(makePost(), basePending, store);

        expect(result.message).toContain('> **Unknown user**');
        expect(result.message).toContain('> оригинал');
        expect(result.message).toContain('тело ответа');
    });

    it('quotes only the selected fragment and stores it in props', () => {
        const quoted = makePost({id: 'quotedid', message: 'оригинал целиком'});
        const store = makeStore(makeState({quotedid: quoted})) as never;
        const pending: PendingReply = {...basePending, selectedText: 'фрагмент'};

        const result = buildQuotedReplyPost(makePost(), pending, store);

        expect(result.message).toContain('> фрагмент');
        expect(result.message).not.toContain('> оригинал целиком');
        expect(result.props[QUOTED_REPLY_TEXT_PROP]).toBe('фрагмент');
    });

    it('preserves existing post props', () => {
        const post = makePost({props: {from_webhook: 'true'}});
        const result = buildQuotedReplyPost(post, basePending, makeStore(makeState()) as never);

        expect(result.props.from_webhook).toBe('true');
    });
});

// Independent audit regression.

it('neutralizes quoted mentions while preserving mentions in the new answer', () => {
    const quoted = makePost({id: 'quotedid', message: 'Ask @observer and @channel'});
    const store = makeStore(makeState({quotedid: quoted})) as never;
    const result = buildQuotedReplyPost(makePost({message: 'My answer to @observer'}), basePending, store);
    expect(result.message).toContain('Ask @\u200bobserver and @\u200bchannel');
    expect(result.message).toContain('\n\nMy answer to @observer');
    expect(result.props[QUOTED_REPLY_BODY_PROP]).toBe('My answer to @observer');
});

it('neutralizes mentions in the quoted display name too', () => {
    expect(formatMobileQuoteBlock('@observer', 'hello')).toBe('> **@\u200bobserver**\n> hello');
});
