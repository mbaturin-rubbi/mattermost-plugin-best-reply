// @vitest-environment jsdom
import {createStore} from 'redux';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import type {Post} from '@mattermost/types/posts';
import type {GlobalState} from '@mattermost/types/store';

import {installNativePostEditReconciliation} from './nativePostEdits';
import {QUOTE_BLOCKS_PROP, fingerprintQuote, quoteMarkdown} from './quoteBlocks';

const scope = {userId: 'me', channelId: 'channel', rootId: 'root'};
const quote = fingerprintQuote({id: 'a'.repeat(32), sourceId: 's'.repeat(26), author: 'Alice', text: 'Original', url: `http://localhost/team/pl/${'s'.repeat(26)}`}, scope);
const second = fingerprintQuote({...quote, id: 'b'.repeat(32), text: 'Second'}, scope);
const oldPost = {
    id: 'p'.repeat(26),
    user_id: 'me',
    channel_id: 'channel',
    root_id: 'root',
    type: 'custom_best_reply',
    message: `${quoteMarkdown(quote)}\n\nFirst answer\n\n${quoteMarkdown(second)}\n\n> Manual`,
    props: {[QUOTE_BLOCKS_PROP]: {version: 2, quotes: [quote, second]}, other_plugin: {keep: true}},
} as unknown as Post;
const store = createStore(() => ({entities: {general: {config: {SiteURL: window.location.origin}}, posts: {posts: {[oldPost.id]: oldPost}}, users: {currentUserId: 'me'}}} as unknown as GlobalState));
let removeAdapter: () => void;
const transport = vi.fn<typeof fetch>();

beforeEach(() => {
    transport.mockReset().mockResolvedValue(new Response('{}', {status: 200}));
    vi.stubGlobal('fetch', transport);
    removeAdapter = installNativePostEditReconciliation(store);
});

afterEach(() => {
    removeAdapter();
    vi.unstubAllGlobals();
});

// Pinned MM 11.11 useSubmit -> views/posts.editPost -> redux PostActions.editPost
// binds Client4.patchPost directly: PUT string URL + JSON body, without the hook.
function nativeInlineSave(patch: Partial<Post>, options: RequestInit = {}) {
    return window.fetch(`/api/v4/posts/${patch.id}/patch`, {...options, method: 'put', body: JSON.stringify(patch)});
}

describe('native inline Edit transport contract', () => {
    it('sends one normalized API request with remaining snapshots and edited manual text', async () => {
        const signal = new AbortController().signal;
        const headers = {'X-CSRF-Token': 'csrf', 'Content-Type': 'application/json'};
        const patch = {id: oldPost.id, message: oldPost.message.replace('Original', 'Edited').replace('> Manual', '> Manual changed'), file_ids: ['attachment']};
        const response = await nativeInlineSave(patch, {headers, signal, credentials: 'same-origin'});
        expect(response.status).toBe(200);
        expect(transport).toHaveBeenCalledOnce();
        const [url, options] = transport.mock.calls[0];
        expect(url).toBe(`/api/v4/posts/${oldPost.id}/patch`);
        expect(options).toMatchObject({headers, signal, credentials: 'same-origin', method: 'put'});
        const saved = JSON.parse(options!.body as string);
        expect(saved.message).toContain('> Edited');
        expect(saved.message).toContain('> Manual changed');
        expect(saved.message).not.toContain(`#br-${quote.id}`);
        expect(saved.message).toContain(`#br-${second.id}`);
        expect(saved.props).toEqual({other_plugin: {keep: true}, [QUOTE_BLOCKS_PROP]: {version: 2, quotes: [second]}});
        expect(saved.file_ids).toEqual(['attachment']);
        expect(patch.message).toBe(oldPost.message.replace('Original', 'Edited').replace('> Manual', '> Manual changed'));
    });

    it('preserves transport rejection and normalizes a retry without a second request', async () => {
        const failure = new Error('offline');
        transport.mockRejectedValueOnce(failure);
        const patch = {id: oldPost.id, message: oldPost.message.replace('Original', 'Edited')};
        await expect(nativeInlineSave(patch)).rejects.toBe(failure);
        expect(transport).toHaveBeenCalledOnce();
        await nativeInlineSave(patch);
        expect(transport).toHaveBeenCalledTimes(2);
        expect(transport.mock.calls[0][1]!.body).toBe(transport.mock.calls[1][1]!.body);
    });

    it.each([
        ['/api/v4/posts/unknown/patch', 'put', '{}'],
        [`https://other.example/api/v4/posts/${oldPost.id}/patch`, 'put', JSON.stringify({id: oldPost.id, message: 'Changed'})],
        [`/api/v4/posts/${oldPost.id}/patch`, 'get', undefined],
        [`/api/v4/posts/${oldPost.id}/patch`, 'put', '{'],
        [`/api/v4/posts/${oldPost.id}/patch`, 'put', JSON.stringify({id: 'other', message: 'Changed'})],
        [`/api/v4/posts/${oldPost.id}/patch`, 'put', JSON.stringify({id: oldPost.id, is_pinned: true})],
        [`/wrong-base/api/v4/posts/${oldPost.id}/patch`, 'put', JSON.stringify({id: oldPost.id, message: 'Changed'})],
    ])('passes unrelated/unknown requests unchanged: %s %s', async (url, method, body) => {
        const init = {method, body};
        await window.fetch(url!, init);
        expect(transport).toHaveBeenCalledExactlyOnceWith(url, init);
    });

    it('passes through requests for a different user and preserves unknown props', async () => {
        removeAdapter();
        const otherUserStore = createStore(() => ({entities: {general: {config: {SiteURL: window.location.origin}}, posts: {posts: {[oldPost.id]: oldPost}}, users: {currentUserId: 'other'}}} as unknown as GlobalState));
        removeAdapter = installNativePostEditReconciliation(otherUserStore);
        const patch = {id: oldPost.id, message: oldPost.message.replace('Original', 'Edited')};
        await nativeInlineSave(patch);
        expect(transport.mock.calls[0][1]!.body).toBe(JSON.stringify(patch));
    });

    it('restores fetch on unload without clobbering a later wrapper', async () => {
        const adapter = window.fetch;
        const laterWrapper = vi.fn<typeof fetch>((...args) => adapter(...args));
        window.fetch = laterWrapper;
        removeAdapter();
        expect(window.fetch).toBe(laterWrapper);
        const patch = {id: oldPost.id, message: oldPost.message.replace('Original', 'Edited')};
        await nativeInlineSave(patch);
        expect(transport.mock.calls[0][1]!.body).toBe(JSON.stringify(patch));
    });

    it('handles disable/re-enable without duplicate requests or stacked active adapters', async () => {
        removeAdapter();
        expect(window.fetch).toBe(transport);
        removeAdapter = installNativePostEditReconciliation(store);
        await nativeInlineSave({id: oldPost.id, message: oldPost.message.replace('Original', 'Edited')});
        expect(transport).toHaveBeenCalledOnce();
        expect(JSON.parse(transport.mock.calls[0][1]!.body as string).message).not.toContain(`#br-${quote.id}`);
    });

    it('does not consume Request objects or streaming bodies', async () => {
        const request = new Request(`${window.location.origin}/api/v4/posts/${oldPost.id}/patch`, {method: 'PUT', body: JSON.stringify({id: oldPost.id, message: 'Changed'})});
        await window.fetch(request);
        expect(transport).toHaveBeenCalledExactlyOnceWith(request, undefined);
        expect(request.bodyUsed).toBe(false);
    });

    it('preserves partial props supplied by another plugin', async () => {
        await nativeInlineSave({id: oldPost.id, message: oldPost.message.replace('Original', 'Edited'), props: {added: true} as Post['props']});
        const props = JSON.parse(transport.mock.calls[0][1]!.body as string).props;
        expect(props.other_plugin).toEqual({keep: true});
        expect(props.added).toBe(true);
        expect(props[QUOTE_BLOCKS_PROP].quotes).toEqual([second]);
    });
});
