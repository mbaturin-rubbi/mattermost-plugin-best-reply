// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from 'vitest';

import type {Post} from '@mattermost/types/posts';

import {QUOTED_REPLY_POST_TYPE} from './constants';
import manifest from './manifest';
import {PLUGIN_STATE_KEY, type PendingReply} from './types/store';
import {fingerprintQuote, quoteMarkdown, QUOTE_BLOCKS_PROP} from './utils/quoteBlocks';

const registerPluginMock = vi.fn();
const quote = fingerprintQuote({id: 'a'.repeat(32), sourceId: 'p'.repeat(26), author: 'Alice', text: 'Original', url: `https://example.com/team/pl/${'p'.repeat(26)}`}, {userId: 'me', channelId: 'ch1', rootId: 'root'});

function makeRegistry() {
    return {
        registerReducer: vi.fn(),
        registerTranslations: vi.fn(),
        registerRootComponent: vi.fn(),
        registerPostActionComponent: vi.fn(),
        registerPostTypeComponent: vi.fn(),
        registerPostDropdownMenuAction: vi.fn(),
        registerMessageWillBePostedHook: vi.fn(),
        registerMessageWillBeUpdatedHook: vi.fn(),
    };
}

function makeStore(pendingReply: PendingReply | null = null, user = 'me') {
    return {
        getState: () => ({
            [PLUGIN_STATE_KEY]: {pendingReply},
            entities: {posts: {posts: {}}, users: {profiles: {}, currentUserId: user}},
        }),
        dispatch: vi.fn(),
    };
}

async function initialize(pendingReply: PendingReply | null = null, user = 'me') {
    vi.resetModules();
    window.registerPlugin = registerPluginMock;
    const {default: Plugin} = await import('./index');
    const registry = makeRegistry();
    const store = makeStore(pendingReply, user);
    new Plugin().initialize(registry, store as never);
    const hook = registry.registerMessageWillBePostedHook.mock.calls[0][0] as (post: Post) => {post: Post};
    return {registry, store, hook};
}

beforeEach(() => {
    registerPluginMock.mockClear();
    sessionStorage.clear();
    localStorage.clear();
});

describe('plugin registration and message hooks', () => {
    it('registers component types, both hooks, and the manifest id', async () => {
        const {registry} = await initialize();
        expect(registerPluginMock).toHaveBeenCalledWith(manifest.id, expect.any(Object));
        expect(registry.registerReducer).toHaveBeenCalledOnce();
        expect(registry.registerTranslations).toHaveBeenCalledOnce();
        expect(registry.registerRootComponent).toHaveBeenCalledTimes(3);
        expect(registry.registerPostActionComponent).toHaveBeenCalledOnce();
        expect(registry.registerPostTypeComponent).toHaveBeenCalledWith(QUOTED_REPLY_POST_TYPE, expect.any(Function));
        expect(registry.registerMessageWillBePostedHook).toHaveBeenCalledOnce();
        expect(registry.registerMessageWillBeUpdatedHook).toHaveBeenCalledOnce();
        const components = [
            ...registry.registerPostActionComponent.mock.calls.map((call) => call[0]),
            ...registry.registerPostTypeComponent.mock.calls.map((call) => call[1]),
            ...registry.registerRootComponent.mock.calls.map((call) => call[0]),
        ];
        expect(components.every((component) => typeof component === 'function')).toBe(true);
    });

    it('never injects an invisible pending quote into a post', async () => {
        const pending = {channelId: 'ch1', rootId: 'root', replyToPostId: quote.sourceId, context: 'thread', isOpeningThread: true} as PendingReply;
        const {hook} = await initialize(pending);
        const post = {channel_id: 'ch1', root_id: 'root', message: 'Ordinary message'} as Post;
        expect(hook(post).post).toBe(post);
    });

    it.each([
        {channel_id: 'other', root_id: 'root', user: 'me'},
        {channel_id: 'ch1', root_id: 'other', user: 'me'},
        {channel_id: 'ch1', root_id: '', user: 'me'},
        {channel_id: 'ch1', root_id: 'root', user: 'other-user'},
    ])('isolates a draft from other channel/thread/user: %j', async ({channel_id: channelId, root_id: rootId, user}) => {
        const {hook} = await initialize(null, user);
        const post = {channel_id: channelId, root_id: rootId, message: quoteMarkdown(quote), props: {}} as Post;
        expect(hook(post).post.message).toContain('Original');
        expect(hook(post).post.message).not.toContain('#br-');
        expect(hook(post).post.props).toEqual({});
    });

    it('reconciles a retained native draft after a fresh tab opens, preserving failed-send retry', async () => {
        sessionStorage.clear();
        const {hook} = await initialize();
        const post = {channel_id: 'ch1', root_id: 'root', message: quoteMarkdown(quote) + '\n\nReply', props: {other: true}} as unknown as Post;
        const result = hook(post).post;
        expect(result.type).toBe(QUOTED_REPLY_POST_TYPE);
        expect(result.message).toBe(post.message);
        expect(result.props).toEqual({other: true, [QUOTE_BLOCKS_PROP]: {version: 2, quotes: [quote]}});
        expect(hook(post).post).toEqual(result);
        expect(hook({...post, message: 'Cleared quote'}).post.message).toBe('Cleared quote');
        const edited = hook({...post, message: post.message.replace('Original', 'Changed in new tab')}).post;
        expect(edited.message).toContain('Changed in new tab');
        expect(edited.message).not.toContain('Alice');
        expect(edited.message).not.toContain('#br-');
    });

    it('reconciles a partial native update using old props', async () => {
        const {registry} = await initialize();
        const hook = registry.registerMessageWillBeUpdatedHook.mock.calls[0][0];
        const oldPost = {message: quoteMarkdown(quote), props: {[QUOTE_BLOCKS_PROP]: {version: 2, quotes: [quote]}}};
        const patch = {id: 'edited', message: quoteMarkdown(quote).replace('Original', 'Changed'), file_ids: ['attachment']};
        const result = hook(patch, oldPost).post;
        expect(result.message).not.toContain('Alice');
        expect(result.message).toContain('Changed');
        expect(result.file_ids).toEqual(['attachment']);
        expect(result.props[QUOTE_BLOCKS_PROP].quotes).toEqual([]);
    });
});
