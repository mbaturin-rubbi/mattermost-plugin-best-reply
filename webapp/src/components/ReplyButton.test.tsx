// @vitest-environment jsdom
import React from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {act} from 'react-dom/test-utils';
import {Provider} from 'react-redux';
import {createStore} from 'redux';
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

import type {Post} from '@mattermost/types/posts';
import type {GlobalState} from '@mattermost/types/store';

import ReplyButton from './ReplyButton';
import ReplyComposerPreview from './ReplyComposerPreview';
import SelectionQuoteButton from './SelectionQuoteButton';

import {getPendingReply} from '../actions/reply';
import {COMPOSER_FOCUS_DELAY_MS, QUOTED_REPLY_POST_TYPE, THREAD_FETCH_PAGE_SIZE} from '../constants';
import reducer from '../reducers';
import {PLUGIN_STATE_KEY, type PluginState} from '../types/store';
import {QUOTE_BLOCKS_PROP, quoteMarkdown} from '../utils/quoteBlocks';

let plugin: InstanceType<typeof import('../index').default>;
let root: Root;
let container: HTMLDivElement;
const SOURCE_ID = '4w9h6fbja78jueyh1hgcqg8z4y';

function makePost(overrides: Partial<Post> = {}): Post {
    return {
        id: SOURCE_ID,
        channel_id: 'channel',
        user_id: 'author',
        root_id: '',
        message: 'Original message',
        props: {},
        delete_at: 0,
        reply_count: 0,
        ...overrides,
    } as Post;
}

function makeStore(post: Post, selectedPostId = '') {
    const initialState = {
        [PLUGIN_STATE_KEY]: {pendingReply: null},
        entities: {
            channels: {currentChannelId: post.channel_id, channels: {[post.channel_id]: {team_id: 'team'}}},
            teams: {currentTeamId: 'team', teams: {team: {name: 'team'}}},
            general: {config: {SiteURL: 'http://localhost', DefaultClientLocale: 'en'}},
            posts: {posts: {[post.id]: post}},
            users: {profiles: {}, currentUserId: 'me'},
        },
        views: {rhs: {selectedPostId, isSidebarOpen: Boolean(selectedPostId)}},
    } as unknown as GlobalState & {[PLUGIN_STATE_KEY]: PluginState; views: {rhs: {selectedPostId?: string; isSidebarOpen: boolean}}};

    return createStore((state: typeof initialState = initialState, action: {type: string; postId?: string}) => ({
        ...state,
        [PLUGIN_STATE_KEY]: reducer(state[PLUGIN_STATE_KEY], action),
        views: action.type === 'SELECT_POST' ? {rhs: {selectedPostId: action.postId, isSidebarOpen: true}} : state.views,
    }));
}

beforeAll(async () => {
    window.registerPlugin = vi.fn();
    const {default: Plugin} = await import('../index');
    plugin = new Plugin();
});

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
        throw new Error('randomUUID is unavailable on HTTP');
    });
    sessionStorage.clear();
    localStorage.clear();
    document.body.innerHTML = '<div id="post-create"><div class="AdvancedTextEditor__cell"><textarea id="post_textbox"></textarea></div></div><div id="sidebar-right" class="sidebar--right"><div class="AdvancedTextEditor__cell"><textarea></textarea></div></div>';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

describe.each(['Reply', 'Quote', 'Ctrl+Q'])('%s thread routing', (action) => {
    it.each([
        {name: 'channel root with no replies', surface: 'channel', rootId: '', replyCount: 0, selectedPostId: '', opensThread: true},
        {name: 'channel root with existing replies', surface: 'channel', rootId: '', replyCount: 2, selectedPostId: 'other-root', opensThread: true},
        {name: 'thread reply shown in the channel', surface: 'channel', rootId: 'root', replyCount: 0, selectedPostId: '', opensThread: true},
        {name: 'channel post with its thread already open', surface: 'channel', rootId: '', replyCount: 2, selectedPostId: SOURCE_ID, opensThread: false},
        {name: 'RHS thread reply', surface: 'sidebar--right', rootId: 'root', replyCount: 0, selectedPostId: 'root', opensThread: false},
        {name: 'global Threads reply', surface: 'ThreadViewer', rootId: 'root', replyCount: 0, selectedPostId: '', opensThread: false},
    ])('quotes a $name inside its source thread', async ({surface, rootId, replyCount, selectedPostId, opensThread}) => {
        const post = makePost({root_id: rootId, reply_count: replyCount});
        const expectedRootId = post.root_id || post.id;
        const store = makeStore(post, selectedPostId);
        const dispatch = vi.spyOn(store, 'dispatch');
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({order: [post.id], posts: {[post.id]: post}}),
        });
        vi.stubGlobal('fetch', fetchMock);

        const registry = {
            registerReducer: vi.fn(),
            registerTranslations: vi.fn(),
            registerRootComponent: vi.fn(),
            registerPostActionComponent: vi.fn(),
            registerPostTypeComponent: vi.fn(),
            registerPostDropdownMenuAction: vi.fn(),
            registerMessageWillBePostedHook: vi.fn(),
            registerMessageWillBeUpdatedHook: vi.fn(),
        };
        plugin.initialize(registry, store);
        const [hook] = registry.registerMessageWillBePostedHook.mock.calls[0] as [(outgoing: Post) => {post: Post}];

        if (surface === 'ThreadViewer') {
            const viewer = document.createElement('div');
            viewer.className = 'ThreadViewer';
            viewer.innerHTML = '<div class="AdvancedTextEditor__cell"><textarea></textarea></div>';
            document.body.appendChild(viewer);
            viewer.appendChild(container);
        } else if (surface === 'sidebar--right') {
            document.querySelector('.sidebar--right')!.appendChild(container);
        }
        const composerSurface = surface === 'ThreadViewer' ? '.ThreadViewer' : '.sidebar--right';
        const surfaceNode = document.querySelector(composerSurface)!;
        const cell = surfaceNode.querySelector('.AdvancedTextEditor__cell')!;
        const viewer = document.createElement('div');
        viewer.className = 'virtual-list__ctr';
        viewer.innerHTML = `<div id="rhsPost_${post.id}"></div><div data-testid="comment-create"></div>`;
        surfaceNode.appendChild(viewer);
        viewer.querySelector('[data-testid="comment-create"]')!.appendChild(cell);

        await act(async () => {
            root.render(
                <Provider store={store}>
                    <div id={`post_${post.id}`}>
                        <p data-testid='post-message-text'>{post.message}</p>
                    </div>
                    <ReplyButton post={post}/>
                    <ReplyComposerPreview/>
                    <SelectionQuoteButton/>
                </Provider>,
            );
        });
        if (action === 'Reply') {
            await act(async () => {
                container.querySelector<HTMLButtonElement>('.quoted-reply-post-action')!.click();
            });
        } else {
            const range = document.createRange();
            const text = container.querySelector('p')!.firstChild!;
            range.setStart(text, 0);
            range.setEnd(text, 8);
            range.getBoundingClientRect = () => new DOMRect(40, 100, 200, 18);
            window.getSelection()!.removeAllRanges();
            window.getSelection()!.addRange(range);
            await act(async () => {
                document.dispatchEvent(new Event('selectionchange'));
            });
            await act(async () => {
                if (action === 'Quote') {
                    document.querySelector<HTMLButtonElement>('.best-reply-selection-popup')!.click();
                } else {
                    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'q', ctrlKey: true}));
                }
            });
        }
        const quote = action === 'Reply' ? post.message : 'Original';

        const pendingReply = getPendingReply(store);
        expect(pendingReply).toMatchObject({
            context: 'thread',
            channelId: post.channel_id,
            rootId: expectedRootId,
            replyToPostId: post.id,
            selectedText: action === 'Reply' ? undefined : quote,
        });
        if (opensThread) {
            expect(fetchMock).toHaveBeenCalledWith(`http://localhost/api/v4/posts/${expectedRootId}/thread?perPage=${THREAD_FETCH_PAGE_SIZE}`, expect.any(Object));
            expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({type: 'SELECT_POST', postId: expectedRootId, channelId: post.channel_id}));
        } else {
            expect(fetchMock).not.toHaveBeenCalled();
            expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({type: 'SELECT_POST'}));
        }
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({type: 'UPDATE_RHS_STATE'}));

        act(() => vi.advanceTimersByTime(COMPOSER_FOCUS_DELAY_MS));
        const textarea = document.querySelector<HTMLTextAreaElement>(`${composerSurface} textarea`)!;
        expect(document.activeElement).toBe(textarea);
        expect(textarea.value).toBe(quoteMarkdown(pendingReply!.quote!) + '\n\n');
        expect(getPendingReply(store)).toBeNull();

        for (const outgoing of [
            makePost({message: 'Channel message'}),
            makePost({root_id: 'unrelated-thread', message: 'Other thread'}),
            makePost({channel_id: 'other-channel', root_id: expectedRootId}),
        ]) {
            expect(hook(outgoing).post).toBe(outgoing);
            expect(getPendingReply(store)).toBeNull();
        }

        let converted: Post;
        act(() => {
            converted = hook(makePost({id: 'new-reply', root_id: expectedRootId, message: textarea.value + 'My reply'})).post;
        });
        expect(converted!).toMatchObject({
            root_id: expectedRootId,
            type: QUOTED_REPLY_POST_TYPE,
            message: `${quoteMarkdown(pendingReply!.quote!)}\n\nMy reply`,
            props: {[QUOTE_BLOCKS_PROP]: {version: 2, quotes: [pendingReply!.quote!]}},
        });
        expect(getPendingReply(store)).toBeNull();
        expect(document.querySelector('.quoted-reply-composer-preview')).toBeNull();
    });
});
