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

let root: Root;
const pending: PendingReply = {replyToPostId: 'source', channelId: 'a', rootId: 'root', context: 'thread'};

function makeStore(reply: PendingReply = pending) {
    const initial = {
        [PLUGIN_STATE_KEY]: {pendingReply: reply as PendingReply | null},
        entities: {
            channels: {currentChannelId: 'a'},
            posts: {posts: {source: {id: 'source', user_id: 'author', message: 'Original text'}}},
            users: {profiles: {author: {id: 'author', username: 'author'}}},
        },
    };
    return createStore((state: typeof initial = initial, action: {type: string; channelId?: string}) => ({
        ...state,
        [PLUGIN_STATE_KEY]: reducer(state[PLUGIN_STATE_KEY], action),
        entities: {...state.entities, channels: {currentChannelId: action.channelId ?? state.entities.channels.currentChannelId}},
    }));
}

async function render(store: ReturnType<typeof makeStore>) {
    await act(async () => root.render(<Provider store={store}><ReplyComposerPreview/></Provider>));
}

beforeEach(() => {
    Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
    document.body.innerHTML = '<div id="app"></div><div class="sidebar--right"><div class="AdvancedTextEditor__cell"></div></div><div id="post-create"><div class="AdvancedTextEditor__cell"></div></div>';
    root = createRoot(document.getElementById('app')!);
});

afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('channel ownership of a pending quote', () => {
    it('clears a channel quote when navigating to another channel', async () => {
        const store = makeStore({...pending, context: 'channel', rootId: ''});
        await render(store);
        expect(document.querySelector('[aria-label="Cancel reply"]')).not.toBeNull();
        await act(async () => store.dispatch({type: 'SELECT_CHANNEL', channelId: 'b'}));
        expect(document.querySelector('[aria-label="Cancel reply"]')).toBeNull();
        expect(store.getState()[PLUGIN_STATE_KEY].pendingReply).toBeNull();
    });

    it('does not cancel a thread quote based on the center channel id', async () => {
        const store = makeStore();
        await render(store);
        await act(async () => store.dispatch({type: 'SELECT_CHANNEL', channelId: 'b'}));
        expect(store.getState()[PLUGIN_STATE_KEY].pendingReply).toEqual(pending);
    });
});
