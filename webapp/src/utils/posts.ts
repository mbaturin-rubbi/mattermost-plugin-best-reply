import type {Post} from '@mattermost/types/posts';
import type {GlobalState} from '@mattermost/types/store';
import type {UserProfile} from '@mattermost/types/users';

import {MAX_QUOTED_FRAGMENT_LENGTH, QUOTED_REPLY_BODY_PROP, QUOTED_REPLY_FALLBACK_PROP, QUOTED_REPLY_POST_TYPE, QUOTED_REPLY_PROP, QUOTED_REPLY_TEXT_PROP} from '../constants';

// The locale the user sees the webapp in; falls back to the server default
// when the current user is not loaded yet.
export function getCurrentUserLocale(state: GlobalState): string {
    const currentUserId = state.entities.users.currentUserId;
    const currentUser = currentUserId ? state.entities.users.profiles[currentUserId] : undefined;

    return currentUser?.locale ||
        state.entities.general.config.DefaultClientLocale ||
        'en';
}

export function getPostFromState(state: GlobalState, postId: string): Post | undefined {
    return state.entities.posts.posts[postId];
}

export function getUserFromState(state: GlobalState, userId: string): UserProfile | undefined {
    return state.entities.users.profiles[userId];
}

export function getDisplayName(user?: UserProfile): string {
    if (!user) {
        return 'Unknown user';
    }

    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    if (fullName) {
        return fullName;
    }

    return user.username;
}

export function getUserAvatarUrl(user?: UserProfile): string | null {
    if (!user?.id) {
        return null;
    }

    return `/api/v4/users/${user.id}/image?_=${user.last_picture_update || 0}`;
}

export function getUserAvatarFallbackUrl(user?: UserProfile): string | null {
    if (!user?.id) {
        return null;
    }

    return `/api/v4/users/${user.id}/image/default`;
}

export function getUserInitials(user?: UserProfile): string {
    const displayName = getDisplayName(user);
    if (displayName === 'Unknown user') {
        return '?';
    }

    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }

    return displayName.slice(0, 2).toUpperCase();
}

export function truncateMessage(message: string, maxLength = MAX_QUOTED_FRAGMENT_LENGTH): string {
    const normalized = message.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength - 1)}…`;
}

function stripMobileQuotePrefix(message: string): string {
    // ponytail: legacy posts have no prefix marker; only recognize the generated author header.
    if (!(/^> \*\*[^\n]+\*\*\n> /).test(message)) {
        return message;
    }

    const separatorIndex = message.indexOf('\n\n');
    if (separatorIndex === -1) {
        return message;
    }

    const prefix = message.slice(0, separatorIndex);
    if (!prefix.split('\n').every((line) => line.startsWith('> '))) {
        return message;
    }

    return message.slice(separatorIndex + 2);
}

export function isQuotedReplyPost(post: Post): boolean {
    return (post.type as string) === QUOTED_REPLY_POST_TYPE || Boolean(post.props?.[QUOTED_REPLY_PROP]);
}

// Fragment text quoted via text selection, if the reply was created from a
// selection rather than from the whole message.
export function getQuotedFragment(post: Post): string | undefined {
    const fragment = post.props?.[QUOTED_REPLY_TEXT_PROP];
    return typeof fragment === 'string' && fragment.trim() ? fragment : undefined;
}

export function getQuotedReplyBody(post: Post): string {
    const message = post.message || '';

    if (isQuotedReplyPost(post)) {
        const fallback = post.props?.[QUOTED_REPLY_FALLBACK_PROP];
        if (message) {
            if (typeof fallback === 'string') {
                const prefix = fallback + '\n\n';
                return fallback && message.startsWith(prefix) ? message.slice(prefix.length) : message;
            }
            return stripMobileQuotePrefix(message);
        }

        const bodyFromProps = post.props?.[QUOTED_REPLY_BODY_PROP];
        if (typeof bodyFromProps === 'string') {
            return bodyFromProps;
        }
    }

    return message;
}

export function getQuotedPostDisplayMessage(post: Post): string {
    if (isQuotedReplyPost(post)) {
        return getQuotedReplyBody(post);
    }

    return post.message || '';
}
