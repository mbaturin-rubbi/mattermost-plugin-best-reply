// @vitest-environment jsdom
import {describe, expect, it, vi} from 'vitest';

import type {Post} from '@mattermost/types/posts';
import type {GlobalState} from '@mattermost/types/store';

import {ensurePostLoaded, getClickSurface, getThreadRootId, getThreadsPagePath} from './navigateToPost';

function makePost(overrides: Partial<Post> = {}): Post {
    return {
        id: 'postid',
        channel_id: 'channelid',
        user_id: 'userid',
        root_id: '',
        message: 'hello',
        props: {},
        ...overrides,
    } as Post;
}

// Builds a chain of nested divs with the given classes and returns the
// innermost one, standing in for the quote block clicked by the user.
function makeElementIn(classChain: string[]): HTMLElement {
    let current = document.createElement('div');
    const outermost = current;

    for (const className of classChain) {
        const child = document.createElement('div');
        child.className = className;
        current.appendChild(child);
        current = child;
    }

    return classChain.length ? current : outermost;
}

describe('getThreadRootId', () => {
    it('returns the root id of a reply', () => {
        expect(getThreadRootId(makePost({id: 'reply1', root_id: 'root1'}))).toBe('root1');
    });

    it('falls back to the post id for a thread root', () => {
        expect(getThreadRootId(makePost({id: 'root1'}))).toBe('root1');
    });
});

it('rejects malformed quote references before reading state or fetching', async () => {
    const store = {getState: vi.fn()};
    await Promise.all(['../users/me', '', '__proto__', undefined].map(async (postId) => {
        expect(await ensurePostLoaded(store as never, postId as string)).toBeUndefined();
    }));
    expect(store.getState).not.toHaveBeenCalled();
});

describe('getClickSurface', () => {
    it('detects the RHS thread panel', () => {
        expect(getClickSurface(makeElementIn(['sidebar--right', 'post']))).toBe('rhs');
    });

    it('detects the global thread viewer', () => {
        expect(getClickSurface(makeElementIn(['ThreadViewer', 'post']))).toBe('thread-viewer');
    });

    it('treats a thread viewer inside the sidebar as the RHS', () => {
        expect(getClickSurface(makeElementIn(['sidebar--right', 'ThreadViewer', 'post']))).toBe('rhs');
    });

    it('treats everything else as the channel', () => {
        expect(getClickSurface(makeElementIn(['channel-post-list', 'post']))).toBe('channel');
    });

    it('falls back to the channel without an element', () => {
        expect(getClickSurface(undefined)).toBe('channel');
        expect(getClickSurface(null)).toBe('channel');
    });
});

describe('getThreadsPagePath', () => {
    function makeState(teamId: string, teamName: string): GlobalState {
        return {
            entities: {
                channels: {channels: {channelid: {id: 'channelid', team_id: teamId}}},
                teams: {currentTeamId: 'fallbackteam', teams: {fallbackteam: {id: 'fallbackteam', name: 'fallback'}, [teamId]: {id: teamId, name: teamName}}},
            },
        } as unknown as GlobalState;
    }

    it('builds a threads-page route for a reply', () => {
        const state = makeState('team1', 'myteam');
        expect(getThreadsPagePath(state, makePost({root_id: 'root1'}))).toBe('/myteam/threads/root1');
    });

    it('uses the post id for a thread root', () => {
        const state = makeState('team1', 'myteam');
        expect(getThreadsPagePath(state, makePost({id: 'root1'}))).toBe('/myteam/threads/root1');
    });

    it('falls back to the current team for channels without one', () => {
        const state = makeState('', 'unused');
        expect(getThreadsPagePath(state, makePost({root_id: 'root1'}))).toBe('/fallback/threads/root1');
    });
});
