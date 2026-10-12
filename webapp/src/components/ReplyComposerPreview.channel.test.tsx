// @vitest-environment jsdom
import React from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {act} from 'react-dom/test-utils';
import {Provider} from 'react-redux';
import {createStore} from 'redux';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import ReplyComposerPreview from './ReplyComposerPreview';

import reducer from '../reducers';
import {PLUGIN_STATE_KEY, type PendingReply} from '../types/store';
import {quoteMarkdown} from '../utils/quoteBlocks';

let root: Root;
const pending: PendingReply = {
    replyToPostId: 'p'.repeat(26),
    channelId: 'a',
    rootId: 'p'.repeat(26),
    context: 'thread',
    surface: 'rhs',
    quote: {id: 'a'.repeat(32), sourceId: 'p'.repeat(26), author: 'Alice', text: 'Original', url: `https://example.com/team/pl/${'p'.repeat(26)}`},
};

function makeStore(reply: PendingReply = pending) {
    const initial = {
        [PLUGIN_STATE_KEY]: {pendingReply: reply as PendingReply | null},
        entities: {
            general: {config: {DefaultClientLocale: 'en'}},
            channels: {currentChannelId: 'a'},
            posts: {posts: {[pending.replyToPostId]: {id: pending.replyToPostId, channel_id: 'a', root_id: ''}}},
            users: {profiles: {}, currentUserId: 'me'},
        },
        views: {rhs: {selectedPostId: pending.rootId, isSidebarOpen: true}},
    };
    return createStore((state: typeof initial = initial, action: {type: string; channelId?: string}) => ({
        ...state,
        [PLUGIN_STATE_KEY]: reducer(state[PLUGIN_STATE_KEY], action),
        entities: {...state.entities, channels: {currentChannelId: action.channelId ?? state.entities.channels.currentChannelId}},
    }));
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    sessionStorage.clear();
    localStorage.clear();
    document.body.innerHTML = `<div id="app"></div><div id="sidebar-right" class="sidebar--right"><div class="virtual-list__ctr"><div id="rhsPost_${pending.replyToPostId}"></div><div data-testid="comment-create"><div class="AdvancedTextEditor__cell"><textarea></textarea></div></div></div></div><div id="post-create"><div class="AdvancedTextEditor__cell"><textarea></textarea></div></div>`;
    root = createRoot(document.getElementById('app')!);
});

afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('channel ownership of pending insertion', () => {
    it('cancels a channel insertion after channel navigation without mutating its draft', async () => {
        const store = makeStore({...pending, context: 'channel', rootId: '', surface: 'channel'});
        const textarea = document.querySelector<HTMLTextAreaElement>('#post-create textarea')!;
        textarea.value = 'Unrelated draft';
        await act(async () => root.render(<Provider store={store}><ReplyComposerPreview/></Provider>));
        await act(async () => store.dispatch({type: 'SELECT_CHANNEL', channelId: 'b'}));
        await act(async () => vi.advanceTimersByTime(300));
        expect(store.getState()[PLUGIN_STATE_KEY].pendingReply).toBeNull();
        expect(textarea.value).toBe('Unrelated draft');
    });

    it('does not confuse a thread composer with the center channel', async () => {
        const store = makeStore();
        await act(async () => root.render(<Provider store={store}><ReplyComposerPreview/></Provider>));
        await act(async () => store.dispatch({type: 'SELECT_CHANNEL', channelId: 'b'}));
        await act(async () => vi.advanceTimersByTime(300));
        expect(document.querySelector<HTMLTextAreaElement>('.sidebar--right textarea')!.value).toBe(quoteMarkdown(pending.quote!) + '\n\n');
        expect(document.querySelector<HTMLTextAreaElement>('#post-create textarea')!.value).toBe('');
        expect(store.getState()[PLUGIN_STATE_KEY].pendingReply).toBeNull();
    });
});
