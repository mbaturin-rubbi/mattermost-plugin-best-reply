import type {Post, PostType} from '@mattermost/types/posts';

import {QUOTED_REPLY_FALLBACK_PROP, QUOTED_REPLY_POST_TYPE} from '../constants';

export const QUOTE_BLOCKS_PROP = 'best_reply_quotes';

export type QuoteSnapshot = {
    id: string;
    sourceId: string;
    author: string;
    text: string;
    url: string;
    fingerprint?: string;
};

export type QuoteScope = {userId: string; channelId: string; rootId: string};

export function postQuoteScope(post: Post): QuoteScope {
    return {userId: post.user_id, channelId: post.channel_id, rootId: post.root_id || ''};
}

export function readQuoteSnapshots(value: unknown): QuoteSnapshot[] | null {
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 2 || !('quotes' in value) || !Array.isArray(value.quotes)) {
        return null;
    }
    const quotes: QuoteSnapshot[] = [];
    for (const quote of value.quotes) {
        if (!quote || typeof quote !== 'object' ||
            !['id', 'sourceId', 'author', 'text', 'url'].every((key) => typeof quote[key] === 'string') ||
            !(/^[a-f0-9]{32}$/).test(quote.id) || !(/^[a-z0-9]{26}$/i).test(quote.sourceId) ||
            (quote.fingerprint !== undefined && (typeof quote.fingerprint !== 'string' || !(/^[a-f0-9]{16}$/).test(quote.fingerprint)))) {
            return null;
        }
        try {
            const url = new URL(quote.url);
            if (!['https:', 'http:'].includes(url.protocol) || !url.pathname.endsWith(`/pl/${quote.sourceId}`) || url.hash || (/[\s()<>]/).test(quote.url)) {
                return null;
            }
        } catch {
            return null;
        }
        quotes.push(quote);
    }
    return quotes;
}

function escapeQuoteText(text: string): string {
    // A selection is plain text, not fresh Markdown or fresh notifications.
    return text.replace(/@/g, '@\u200b').replace(/([\\`*_{}[\]<>#!|])/g, '\\$1');
}

export function quoteLink(quote: QuoteSnapshot): string {
    return `[**${escapeQuoteText(quote.author.replace(/\s+/g, ' ').trim() || 'Unknown user')}**](${quoteUrl(quote)})`;
}

export function quoteUrl(quote: QuoteSnapshot): string {
    return `${quote.url}#br-${quote.id}${quote.fingerprint === undefined ? '' : '-' + quote.fingerprint}`;
}

export function quoteBody(quote: QuoteSnapshot): string {
    return escapeQuoteText(quote.text || 'Attachment').split('\n').map((line) => `> ${line}`).join('\n');
}

export function quoteMarkdown(quote: QuoteSnapshot): string {
    return `> ${quoteLink(quote)}\n${quoteBody(quote)}`;
}

// FNV-1a detects changed text/scope; it is not authentication or authorization.
// The fingerprint travels with the native draft, so no sidecar cache is needed.
export function fingerprintQuote(quote: QuoteSnapshot, scope: QuoteScope): QuoteSnapshot {
    const text = JSON.stringify([scope.userId, scope.channelId, scope.rootId, quoteLink({...quote, fingerprint: undefined}), quoteBody(quote)]);
    let hash = 14695981039346656037n;
    for (let i = 0; i < text.length; i++) {
        hash = BigInt.asUintN(64, (hash ^ BigInt(text.charCodeAt(i))) * 1099511628211n);
    }
    return {...quote, fingerprint: hash.toString(16).padStart(16, '0')};
}

function decodeQuoteText(text: string): string {
    return text.replace(/\\([\\`*_{}[\]<>#!|])/g, '$1').replace(/@\u200b/g, '@');
}

// Only top-level generated headers are owned by the plugin. In particular,
// examples inside code fences and nested/manual quotes must stay untouched.
export function reconcileQuotes(message: string, snapshots: QuoteSnapshot[], plainSnapshots = false, scope?: QuoteScope): {message: string; quotes: QuoteSnapshot[]} {
    const lines = message.split('\n');
    const retained = new Map<string, QuoteSnapshot>();
    let fence: {character: string; length: number} | undefined;
    for (let i = 0; i < lines.length; i++) {
        const delimiter = (/^ {0,3}(`{3,}|~{3,})/).exec(lines[i]);
        if (delimiter) {
            if (!fence) {
                fence = {character: delimiter[1][0], length: delimiter[1].length};
            } else if (delimiter[1][0] === fence.character && delimiter[1].length >= fence.length && (/^ {0,3}(?:`+|~+)\s*$/).test(lines[i])) {
                fence = undefined;
            }
            continue;
        }
        if (fence || !(/^(?:> )?\[\*\*/).test(lines[i])) {
            continue;
        }
        const header = (/^(> )?\[\*\*((?:\\.|[^\]])*)\*\*\]\((https?:\/\/[^\s()<>]+\/pl\/([a-z0-9]{26}))#br-([a-f0-9]{32})(?:-([^\s)]*))?\)/i).exec(lines[i]);
        let end = i + 1;
        while (end < lines.length && (/^> ?/).test(lines[end])) {
            end++;
        }
        let quote = snapshots.find((candidate) => header?.[5] === candidate.id);
        let validFingerprint = true;
        if (quote?.fingerprint && scope) {
            validFingerprint = fingerprintQuote(quote, scope).fingerprint === quote.fingerprint;
        }
        if (!quote && header && scope) {
            quote = {id: header[5],
                sourceId: header[4],
                author: decodeQuoteText(header[2]),
                url: header[3],
                text: decodeQuoteText(lines.slice(i + 1, end).map((line) => line.replace(/^> ?/, '')).join('\n')),
                fingerprint: header[6]};
            validFingerprint = Boolean(quote.fingerprint && fingerprintQuote(quote, scope).fingerprint === quote.fingerprint);
        }
        if (!quote) {
            continue;
        }
        if (validFingerprint && lines[i] === `> ${quoteLink(quote)}` && lines.slice(i + 1, end).join('\n') === quoteBody(quote)) {
            retained.set(quote.id, quote);
            if (plainSnapshots) {
                lines.splice(i, end - i, quote.text);
            } else {
                i = end - 1;
            }
            continue;
        }

        // Remove only the generated link, preserving comments added on its line.
        if (header && header[5] === quote.id) {
            lines[i] = lines[i].slice(header[0].length);
            if (lines[i] && header[1]) {
                lines[i] = header[1] + lines[i];
            }
        }
    }
    return {message: lines.join('\n'), quotes: [...retained.values()]};
}

export function applyQuoteSnapshots(post: Post, snapshots: QuoteSnapshot[], scope?: QuoteScope): Post {
    const reconciled = reconcileQuotes(post.message || '', snapshots, false, scope);
    if (!reconciled.quotes.length && !post.props?.[QUOTE_BLOCKS_PROP]) {
        return reconciled.message === post.message ? post : {...post, message: reconciled.message};
    }
    return {
        ...post,
        type: QUOTED_REPLY_POST_TYPE as PostType,
        message: reconciled.message,
        props: {...post.props, [QUOTE_BLOCKS_PROP]: {version: 2, quotes: reconciled.quotes}},
    };
}

export function reconcileEditedPost(patch: Partial<Post>, oldPost: Post): Partial<Post> {
    if (typeof patch.message !== 'string') {
        return patch;
    }
    const props = {...oldPost.props, ...patch.props};
    const snapshots = readQuoteSnapshots(props[QUOTE_BLOCKS_PROP]);
    if (snapshots) {
        const reconciled = reconcileQuotes(patch.message, snapshots, false, postQuoteScope(oldPost));
        return {...patch, message: reconciled.message, props: {...props, [QUOTE_BLOCKS_PROP]: {version: 2, quotes: reconciled.quotes}}};
    }
    const fallback = props[QUOTED_REPLY_FALLBACK_PROP];
    if (!(QUOTE_BLOCKS_PROP in props) && typeof fallback === 'string' && fallback && !patch.message.startsWith(fallback + '\n\n')) {
        const header = fallback.split('\n')[0];
        const message = patch.message.startsWith(header + '\n') ? patch.message.slice(header.length + 1) : patch.message;
        return {...patch, message, props: {...props, [QUOTE_BLOCKS_PROP]: {version: 2, quotes: []}}};
    }
    return patch;
}

export function insertQuoteAtCaret(message: string, caret: number, quote: QuoteSnapshot): {message: string; insertion: string; caret: number; start: number} {
    const start = Math.max(0, Math.min(caret, message.length));
    const before = message.slice(0, start);
    const after = message.slice(start);
    let prefix = '';
    if (before && !before.endsWith('\n\n')) {
        prefix = before.endsWith('\n') ? '\n' : '\n\n';
    }
    const insertion = `${prefix}${quoteMarkdown(quote)}\n\n`;
    return {message: before + insertion + after, insertion, caret: start + insertion.length, start};
}
