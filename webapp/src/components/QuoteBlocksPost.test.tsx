// @vitest-environment jsdom
import React from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {act} from 'react-dom/test-utils';
import {Provider} from 'react-redux';
import {createStore} from 'redux';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import type {Post} from '@mattermost/types/posts';

import QuotedReplyPost from './QuotedReplyPost';

import {fingerprintQuote, quoteMarkdown, quoteUrl, QUOTE_BLOCKS_PROP} from '../utils/quoteBlocks';

const {navigate} = vi.hoisted(() => ({navigate: vi.fn()}));
vi.mock('../actions/navigateToPost', () => ({navigateToQuotedPost: navigate}));

const quote = fingerprintQuote({id: 'a'.repeat(32), sourceId: 'p'.repeat(26), author: 'Alice', text: 'Saved original', url: `https://example.com/team/pl/${'p'.repeat(26)}`}, {userId: 'original-author', channelId: 'channel', rootId: 'root'});
const source = {id: quote.sourceId, message: 'EDITED ORIGINAL', delete_at: 10};
const store = createStore(() => ({entities: {general: {config: {}}, posts: {posts: {[source.id]: source}}, users: {profiles: {}, currentUserId: 'different-reader'}}}));
let root: Root;

const makePost = (message = quoteMarkdown(quote) + '\n\nComment') => ({id: 'reply', user_id: 'original-author', channel_id: 'channel', root_id: 'root', message, props: {[QUOTE_BLOCKS_PROP]: {version: 2, quotes: [quote]}}} as unknown as Post);

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    document.body.innerHTML = '<div id="app"></div>';
    root = createRoot(document.getElementById('app')!);
    window.PostUtils = {formatText: vi.fn((text) => text), messageHtmlToComponent: (text) => text};
    navigate.mockReset().mockResolvedValue(false);
});

afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
});

describe('snapshot rendering', () => {
    it('renders the saved message independent of source edits/deletion', async () => {
        const post = makePost();
        await act(async () => root.render(<Provider store={store}><QuotedReplyPost post={post}/></Provider>));
        expect(document.body.textContent).toContain('Saved original');
        expect(document.body.textContent).not.toContain('EDITED ORIGINAL');
        expect(navigate).not.toHaveBeenCalled();
    });

    it('reconciles mobile/message-only edits with stale props without resurrecting attribution', async () => {
        const post = makePost(quoteMarkdown(quote).replace('Saved original', 'Mobile change') + '\n\nComment');
        await act(async () => root.render(<Provider store={store}><QuotedReplyPost post={post}/></Provider>));
        expect(document.body.textContent).toContain('Mobile change');
        expect(document.body.textContent).not.toContain('Alice');
        expect(document.body.textContent).not.toContain('Saved original');
        expect(post.props[QUOTE_BLOCKS_PROP]).toEqual({version: 2, quotes: [quote]});
        await act(async () => root.render(<Provider store={store}><QuotedReplyPost post={makePost('Only my comment')}/></Provider>));
        expect(document.body.textContent).toBe('Only my comment');
    });

    it.each([null, {version: 88, quotes: [quote]}, {version: 2, quotes: [{id: 'bad'}]}])('shows all user text with unknown/corrupt props %j', async (metadata) => {
        const post = {...makePost(), props: {[QUOTE_BLOCKS_PROP]: metadata}} as unknown as Post;
        await act(async () => root.render(<Provider store={store}><QuotedReplyPost post={post}/></Provider>));
        expect(document.body.textContent).toBe(post.message);
    });

    it('shows navigation failure while leaving the snapshot in place', async () => {
        window.PostUtils.messageHtmlToComponent = () => <a href={quoteUrl(quote)}>{quote.text}</a>;
        await act(async () => root.render(<Provider store={store}><QuotedReplyPost post={makePost()}/></Provider>));
        await act(async () => document.querySelector('a')!.click());
        expect(navigate).toHaveBeenCalledWith(store, quote.sourceId, expect.objectContaining({verifyOriginal: true}));
        expect(document.querySelector('[role="status"]')?.textContent).toContain('original message is unavailable');
        expect(document.querySelector('a')?.textContent).toBe('Saved original');
    });
});
