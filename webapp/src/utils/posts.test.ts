import {describe, expect, it} from 'vitest';

import type {Post} from '@mattermost/types/posts';
import type {UserProfile} from '@mattermost/types/users';

import {getQuotedReplyBody, getQuotedFragment, getQuotedPostDisplayMessage, isQuotedReplyPost, truncateMessage, getDisplayName} from './posts';

import {QUOTED_REPLY_BODY_PROP, QUOTED_REPLY_POST_TYPE, QUOTED_REPLY_PROP, QUOTED_REPLY_TEXT_PROP} from '../constants';

function makePost(overrides: Partial<Post> = {}): Post {
    return {
        id: 'postid',
        channel_id: 'channelid',
        user_id: 'userid',
        message: 'hello',
        props: {},
        ...overrides,
    } as Post;
}

describe('isQuotedReplyPost', () => {
    it('detects replies by custom type', () => {
        expect(isQuotedReplyPost(makePost({type: QUOTED_REPLY_POST_TYPE as Post['type']}))).toBe(true);
    });

    it('detects replies by props even when the type is unknown', () => {
        expect(isQuotedReplyPost(makePost({props: {[QUOTED_REPLY_PROP]: 'otherpost'}}))).toBe(true);
    });

    it('rejects regular posts', () => {
        expect(isQuotedReplyPost(makePost())).toBe(false);
    });
});

describe('getQuotedFragment', () => {
    it('returns the fragment stored by a selection-based reply', () => {
        const post = makePost({props: {[QUOTED_REPLY_TEXT_PROP]: 'фрагмент'}});
        expect(getQuotedFragment(post)).toBe('фрагмент');
    });

    it('returns undefined for whole-message replies', () => {
        expect(getQuotedFragment(makePost({props: {[QUOTED_REPLY_PROP]: 'x'}}))).toBeUndefined();
    });

    it('returns undefined for blank fragments', () => {
        const post = makePost({props: {[QUOTED_REPLY_TEXT_PROP]: '   '}});
        expect(getQuotedFragment(post)).toBeUndefined();
    });
});

describe('getQuotedReplyBody', () => {
    it('strips the mobile markdown quote prefix from the message', () => {
        const post = makePost({
            type: QUOTED_REPLY_POST_TYPE as Post['type'],
            message: '> **brtester**\n> фрагмент\n\nтело ответа',
            props: {[QUOTED_REPLY_BODY_PROP]: 'тело ответа'},
        });
        expect(getQuotedReplyBody(post)).toBe('тело ответа');
    });

    it('falls back to the body prop when the message has no quote prefix', () => {
        const post = makePost({
            type: QUOTED_REPLY_POST_TYPE as Post['type'],
            message: '',
            props: {[QUOTED_REPLY_BODY_PROP]: 'тело из props'},
        });
        expect(getQuotedReplyBody(post)).toBe('тело из props');
    });

    it('leaves regular messages untouched', () => {
        const post = makePost({message: 'обычное сообщение'});
        expect(getQuotedReplyBody(post)).toBe('обычное сообщение');
    });

    it('does not strip messages that only start with "> " but have no separator', () => {
        const post = makePost({
            type: QUOTED_REPLY_POST_TYPE as Post['type'],
            message: '> просто цитата без тела',
            props: {[QUOTED_REPLY_BODY_PROP]: 'запасное тело'},
        });

        // No blank-line separator: the whole message is treated as the body.
        expect(getQuotedReplyBody(post)).toBe('> просто цитата без тела');
    });
});

describe('getQuotedPostDisplayMessage', () => {
    it('returns the body when quoting a quoted reply', () => {
        const quotedReply = makePost({
            id: 'q1',
            type: QUOTED_REPLY_POST_TYPE as Post['type'],
            message: '> **a**\n> b\n\nвложенное тело',
        });
        expect(getQuotedPostDisplayMessage(quotedReply)).toBe('вложенное тело');
    });

    it('returns the message for regular posts', () => {
        expect(getQuotedPostDisplayMessage(makePost({message: 'текст'}))).toBe('текст');
    });
});

describe('truncateMessage', () => {
    it('normalizes whitespace', () => {
        expect(truncateMessage('a\n  b\t c')).toBe('a b c');
    });

    it('truncates long messages with an ellipsis', () => {
        const result = truncateMessage('x'.repeat(600), 500);
        expect(result.length).toBe(500);
        expect(result.endsWith('…')).toBe(true);
    });

    it('keeps short messages', () => {
        expect(truncateMessage('коротко', 500)).toBe('коротко');
    });
});

describe('getDisplayName', () => {
    it('prefers the full name', () => {
        const user = {first_name: 'Anna', last_name: 'Author', username: 'brauthor'} as UserProfile;
        expect(getDisplayName(user)).toBe('Anna Author');
    });

    it('falls back to the username', () => {
        const user = {username: 'brauthor'} as UserProfile;
        expect(getDisplayName(user)).toBe('brauthor');
    });

    it('falls back to "Unknown user"', () => {
        expect(getDisplayName(undefined)).toBe('Unknown user');
    });
});

// Independent audit regression.

it('does not mistake an edited user blockquote for the generated prefix', () => {
    const message = '> My own quoted answer\n\nExplanation';
    const post = makePost({type: QUOTED_REPLY_POST_TYPE as Post['type'], message, props: {[QUOTED_REPLY_BODY_PROP]: 'Old answer'}});
    expect(getQuotedReplyBody(post)).toBe(message);
});

it('only strips the recorded prefix from new replies', () => {
    const prefix = '> **author**\n> Original text';
    const message = '> **My own heading**\n> My own quote\n\nExplanation';
    const post = makePost({type: QUOTED_REPLY_POST_TYPE as Post['type'], message, props: {best_reply_fallback: prefix}});
    expect(getQuotedReplyBody(post)).toBe(message);
    expect(getQuotedReplyBody({...post, message: prefix + '\n\nUpdated answer'})).toBe('Updated answer');
});
