// @vitest-environment jsdom
import React from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {act} from 'react-dom/test-utils';
import {Provider} from 'react-redux';
import {createStore} from 'redux';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import ReplyComposerPreview from './ReplyComposerPreview';

import {clearPendingReply} from '../actions/reply';
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

function makeStore() {
    const initial = {
        [PLUGIN_STATE_KEY]: {pendingReply: pending as PendingReply | null},
        entities: {
            general: {config: {DefaultClientLocale: 'en'}},
            channels: {currentChannelId: 'a'},
            posts: {posts: {
                [pending.replyToPostId]: {id: pending.replyToPostId, channel_id: 'a', root_id: ''},
                old: {id: 'old', channel_id: 'a', root_id: ''},
            }},
            users: {profiles: {}, currentUserId: 'me'},
        },
        views: {rhs: {selectedPostId: pending.rootId, isSidebarOpen: true}},
    };
    return createStore((state: typeof initial = initial, action: {type: string; rootId?: string}) => ({
        ...state,
        [PLUGIN_STATE_KEY]: reducer(state[PLUGIN_STATE_KEY], action),
        views: action.rootId ? {rhs: {selectedPostId: action.rootId, isSidebarOpen: true}} : state.views,
    }));
}

function composer(postId: string, content = '<textarea>Existing draft</textarea>') {
    return `<div class="virtual-list__ctr"><div id="rhsPost_${postId}"></div><div data-testid="comment-create"><div class="AdvancedTextEditor__cell">${content}</div></div></div>`;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    sessionStorage.clear();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div><div id="sidebar-right" class="sidebar--right"></div>';
    root = createRoot(document.getElementById('app')!);
});

afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('composer mount and ownership', () => {
    it('supports the v9 comment container inside the keyed post-right content', async () => {
        const store = makeStore();
        const sidebar = document.getElementById('sidebar-right')!;
        sidebar.innerHTML = `<div class="post-right__content"><div id="rhsPost_${pending.replyToPostId}"></div><div class="post-create__container"><div class="AdvancedTextEditor__cell"><textarea id="reply_textbox">Existing draft</textarea></div></div></div>`;
        await act(async () => root.render(<Provider store={store}><ReplyComposerPreview/></Provider>));
        await act(async () => vi.advanceTimersByTime(300));
        expect(sidebar.querySelector('textarea')!.value).toContain(quoteMarkdown(pending.quote!));
        expect(store.getState()[PLUGIN_STATE_KEY].pendingReply).toBeNull();
    });

    it('ignores the RHS width holder that precedes the real sidebar in Mattermost', async () => {
        const store = makeStore();
        const holder = document.createElement('div');
        holder.className = 'sidebar--right sidebar--right--width-holder';
        document.body.prepend(holder);
        const sidebar = document.getElementById('sidebar-right')!;
        sidebar.innerHTML = composer(pending.replyToPostId);
        await act(async () => root.render(<Provider store={store}><ReplyComposerPreview/></Provider>));
        await act(async () => vi.advanceTimersByTime(300));
        expect(document.querySelector('.sidebar--right')).toBe(holder);
        expect(sidebar.querySelector('textarea')!.value).toContain(quoteMarkdown(pending.quote!));
        expect(store.getState()[PLUGIN_STATE_KEY].pendingReply).toBeNull();
        expect(document.querySelector('[role="status"]')).toBeNull();
    });

    it('ignores inline Edit textareas and inserts only into the reply draft', async () => {
        const store = makeStore();
        const surface = document.querySelector('.sidebar--right')!;
        surface.innerHTML = '<div class="AdvancedTextEditor__cell"><textarea>Existing inline edit</textarea></div>' + composer(pending.replyToPostId);
        await act(async () => root.render(<Provider store={store}><ReplyComposerPreview/></Provider>));
        await act(async () => vi.advanceTimersByTime(300));
        expect(surface.querySelector('textarea')!.value).toBe('Existing inline edit');
        expect(surface.querySelector<HTMLTextAreaElement>('[data-testid="comment-create"] textarea')!.value).toContain(quoteMarkdown(pending.quote!));
    });

    it('waits for the target DOM when Redux already points to the new thread', async () => {
        const store = makeStore();
        const surface = document.querySelector('.sidebar--right')!;
        surface.innerHTML = composer('old');
        const oldTextarea = surface.querySelector('textarea')!;
        await act(async () => root.render(<Provider store={store}><ReplyComposerPreview/></Provider>));
        await act(async () => vi.advanceTimersByTime(900));
        expect(oldTextarea.value).toBe('Existing draft');
        expect(store.getState()[PLUGIN_STATE_KEY].pendingReply).toBe(pending);
        surface.innerHTML = composer(pending.replyToPostId);
        await act(async () => vi.advanceTimersByTime(150));
        expect(surface.querySelector('textarea')!.value).toBe(`Existing draft\n\n${quoteMarkdown(pending.quote!)}\n\n`);
        expect(store.getState()[PLUGIN_STATE_KEY].pendingReply).toBeNull();
    });

    it.each(['cancel', 'navigate'])('stops waiting after %s and never changes the late composer', async (reason) => {
        const store = makeStore();
        const surface = document.querySelector('.sidebar--right')!;
        surface.innerHTML = composer('old');
        await act(async () => root.render(<Provider store={store}><ReplyComposerPreview/></Provider>));
        await act(async () => vi.advanceTimersByTime(500));
        await act(async () => {
            if (reason === 'cancel') {
                clearPendingReply(store);
            } else {
                store.dispatch({type: 'SELECT_POST', rootId: 'other'});
            }
        });
        await act(async () => vi.advanceTimersByTime(150));
        surface.innerHTML = composer(pending.replyToPostId);
        await act(async () => vi.advanceTimersByTime(500));
        expect(surface.querySelector('textarea')!.value).toBe('Existing draft');
        expect(store.getState()[PLUGIN_STATE_KEY].pendingReply).toBeNull();
    });

    it('expires a never-mounted composer with visible feedback', async () => {
        const store = makeStore();
        await act(async () => root.render(<Provider store={store}><ReplyComposerPreview/></Provider>));
        await act(async () => vi.advanceTimersByTime(3300));
        expect(store.getState()[PLUGIN_STATE_KEY].pendingReply).toBeNull();
        expect(document.querySelector('[role="status"]')?.textContent).toContain('Your draft has been preserved');
    });

    it('preserves an unsupported contenteditable editor and disarms insertion', async () => {
        const store = makeStore();
        document.querySelector('.sidebar--right')!.innerHTML = composer(pending.replyToPostId, '<div contenteditable="true">My rich draft</div>');
        await act(async () => root.render(<Provider store={store}><ReplyComposerPreview/></Provider>));
        await act(async () => vi.advanceTimersByTime(300));
        expect(document.querySelector('[contenteditable]')?.textContent).toBe('My rich draft');
        expect(store.getState()[PLUGIN_STATE_KEY].pendingReply).toBeNull();
        expect(document.querySelector('[role="status"]')?.textContent).toContain('Markdown text editor');
    });
});
