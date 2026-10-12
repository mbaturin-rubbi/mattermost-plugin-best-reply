// @vitest-environment jsdom
import React from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {act} from 'react-dom/test-utils';
import {Provider, useSelector} from 'react-redux';
import {createStore} from 'redux';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import type {Post} from '@mattermost/types/posts';

import ReplyComposerPreview from './ReplyComposerPreview';

import {clearPendingReply, getPendingReply, setPendingReply, startReplyToPost} from '../actions/reply';
import reducer from '../reducers';
import {PLUGIN_STATE_KEY, type PendingReply} from '../types/store';
import {quoteMarkdown} from '../utils/quoteBlocks';

const source = {id: 'next-root', root_id: '', channel_id: 'channel', user_id: 'author', message: 'New quote', delete_at: 0} as Post;
const oldReply: PendingReply = {replyToPostId: 'old-root', rootId: 'old-root', channelId: 'channel', context: 'thread'};
let root: Root;
let finishFetch: (response: Response) => void;

function makeStore(hasOldQuote = false) {
    const initial = {
        [PLUGIN_STATE_KEY]: {pendingReply: hasOldQuote ? oldReply : null as PendingReply | null},
        entities: {
            general: {config: {SiteURL: 'http://localhost'}},
            channels: {currentChannelId: 'channel', channels: {channel: {team_id: 'team'}}},
            teams: {currentTeamId: 'team', teams: {team: {name: 'team'}}},
            posts: {posts: {[source.id]: source, 'old-root': {...source, id: 'old-root', message: 'Old quote'}}},
            users: {profiles: {author: {id: 'author', username: 'author'}}},
        },
        views: {rhs: {selectedPostId: 'old-root', isSidebarOpen: true}},
    };
    return createStore((state: typeof initial = initial, action: {type: string; postId?: string}) => ({
        ...state,
        [PLUGIN_STATE_KEY]: reducer(state[PLUGIN_STATE_KEY], action),
        views: action.type === 'SELECT_POST' ? {rhs: {selectedPostId: action.postId || '', isSidebarOpen: Boolean(action.postId)}} : state.views,
    }));
}

// Mattermost replaces the composer when SELECT_POST changes the viewed root.
function ThreadComposer() {
    const id = useSelector((state: ReturnType<ReturnType<typeof makeStore>['getState']>) => state.views.rhs.selectedPostId);
    if (!id) {
        return null;
    }
    return (
        <div
            id='sidebar-right'
            className='sidebar--right'
            key={id}
        >
            <div className='virtual-list__ctr'>
                <div id={`rhsPost_${id}`}/>
                <div data-testid='comment-create'>
                    <div
                        className='AdvancedTextEditor__cell'
                        data-root={id}
                    >
                        <textarea/>
                    </div>
                </div>
            </div>
        </div>
    );
}

async function render(store: ReturnType<typeof makeStore>) {
    await act(async () => root.render(<Provider store={store}><ThreadComposer/><ReplyComposerPreview/></Provider>));
}

function fetchedThread(ok = true): Response {
    return {ok, status: ok ? 200 : 500, json: async () => ({order: [source.id], posts: {[source.id]: source}})} as Response;
}

beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    localStorage.clear();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
        finishFetch = resolve;
    })));
    document.body.innerHTML = '<div id="app"></div>';
    root = createRoot(document.getElementById('app')!);
});

afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('switching the quoted thread', () => {
    it.each([false, true])('keeps the new quote when the old composer is replaced (old quote: %s)', async (hasOldQuote) => {
        const store = makeStore(hasOldQuote);
        await render(store);
        const oldComposer = document.querySelector('.AdvancedTextEditor__cell')!;
        let opening: Promise<boolean>;
        await act(async () => {
            opening = startReplyToPost(store, source, {context: 'thread'});
        });
        expect(oldComposer.querySelector('.quoted-reply-composer-preview')).toBeNull();
        await act(async () => {
            finishFetch(fetchedThread());
            await opening;
        });
        expect(oldComposer.isConnected).toBe(false);
        expect(getPendingReply(store)).toMatchObject({replyToPostId: source.id, rootId: source.id});
        const quote = getPendingReply(store)!.quote!;
        await act(async () => vi.advanceTimersByTime(300));
        expect(document.querySelector<HTMLTextAreaElement>('[data-root="next-root"] textarea')?.value).toBe(quoteMarkdown(quote) + '\n\n');
        await act(async () => store.dispatch({type: 'SELECT_POST', postId: ''}));
        expect(getPendingReply(store)).toBeNull();
    });

    it('does not restore a quote cancelled while the thread request was in flight', async () => {
        const store = makeStore();
        await render(store);
        let opening: Promise<boolean>;
        await act(async () => {
            opening = startReplyToPost(store, source, {context: 'thread'});
        });
        await act(async () => clearPendingReply(store));
        await act(async () => {
            finishFetch(fetchedThread());
            await opening;
        });
        expect(getPendingReply(store)).toBeNull();
        expect(document.querySelector('.quoted-reply-composer-preview')).toBeNull();
    });

    it('clears the waiting quote when fetching the thread fails', async () => {
        const store = makeStore();
        await render(store);
        let opening: Promise<boolean>;
        await act(async () => {
            opening = startReplyToPost(store, source, {context: 'thread'});
        });
        await act(async () => {
            finishFetch(fetchedThread(false));
            expect(await opening!).toBe(false);
        });
        expect(getPendingReply(store)).toBeNull();
        expect(document.querySelector('.quoted-reply-composer-preview')).toBeNull();
    });

    it.each([true, false])('does not replace a newer quote when an older fetch completes (success: %s)', async (ok) => {
        const store = makeStore();
        await render(store);
        let opening: Promise<boolean>;
        await act(async () => {
            opening = startReplyToPost(store, source, {context: 'thread'});
        });
        await act(async () => setPendingReply(store, oldReply));
        await act(async () => {
            finishFetch(fetchedThread(ok));
            expect(await opening!).toBe(false);
        });
        expect(getPendingReply(store)).toBe(oldReply);
    });
});
