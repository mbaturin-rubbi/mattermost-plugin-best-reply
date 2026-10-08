// @vitest-environment jsdom
import React from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {act} from 'react-dom/test-utils';
import {Provider} from 'react-redux';
import {createStore} from 'redux';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import type {Post} from '@mattermost/types/posts';
import type {GlobalState} from '@mattermost/types/store';

import QuotedReplyPost from './QuotedReplyPost';

const {loadPost, permalink} = vi.hoisted(() => ({loadPost: vi.fn(), permalink: vi.fn()}));
vi.mock('../actions/navigateToPost', () => ({
    ensurePostLoaded: loadPost,
    getPermalinkUrl: permalink,
    navigateToQuotedPost: vi.fn(),
}));

let root: Root;
const reply = {id: 'reply', channel_id: 'channel', message: '> **author**\n> Original text\n\nMy answer', type: 'custom_best_reply', props: {best_reply_to: 'source', best_reply_body: 'My answer'}} as unknown as Post;

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
    document.body.innerHTML = '<div id="app"></div>';
    root = createRoot(document.getElementById('app')!);
    loadPost.mockReset().mockResolvedValue(undefined);
    permalink.mockReset().mockImplementation((store) => (store.getState().entities.posts.posts.source ? '/audit/pl/source' : null));
    window.PostUtils = {formatText: (text) => text, messageHtmlToComponent: (html) => html};
});

afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
});

describe('unloaded quote originals', () => {
    it('shows the stored fallback until the original is loaded, then restores the link', async () => {
        const initial = {entities: {posts: {posts: {}}, users: {profiles: {author: {id: 'author', username: 'author'}}}}} as unknown as GlobalState;
        const store = createStore((state: GlobalState = initial, action: {type: string; data?: Post}) => (action.data ? {
            ...state,
            entities: {...state.entities, posts: {...state.entities.posts, posts: {[action.data.id]: action.data}}},
        } : state));
        await act(async () => root.render(<Provider store={store}><QuotedReplyPost post={reply}/></Provider>));
        expect(document.body.textContent).toContain('Original text');
        expect(loadPost).toHaveBeenCalledWith(store, 'source');
        await act(async () => store.dispatch({type: 'RECEIVED_POST', data: {id: 'source', user_id: 'author', message: 'Original text'} as Post}));
        expect(document.querySelector('a')?.getAttribute('href')).toBe('/audit/pl/source');
        expect(document.body.textContent?.match(/Original text/g)).toHaveLength(1);
    });

    it('keeps readable content when fetching the original fails', async () => {
        loadPost.mockRejectedValue(new Error('offline'));
        const state = {entities: {posts: {posts: {}}, users: {profiles: {}}}} as unknown as GlobalState;
        const store = createStore(() => state);
        await act(async () => root.render(<Provider store={store}><QuotedReplyPost post={reply}/></Provider>));
        expect(document.body.textContent).toContain('Original text');
        expect(document.body.textContent).toContain('My answer');
    });
});
