import {describe, expect, it} from 'vitest';

import type {Post} from '@mattermost/types/posts';

import {getQuotedPostDisplayMessage} from './posts';
import {applyQuoteSnapshots, fingerprintQuote, insertQuoteAtCaret, QUOTE_BLOCKS_PROP, quoteBody, quoteLink, quoteMarkdown, readQuoteSnapshots, reconcileEditedPost, reconcileQuotes, type QuoteSnapshot} from './quoteBlocks';

const first: QuoteSnapshot = {id: 'a'.repeat(32), sourceId: 'p'.repeat(26), author: 'Alice', text: 'Release on Friday', url: `https://example.com/team/pl/${'p'.repeat(26)}`};
const second = {...first, id: 'b'.repeat(32), text: 'Include migration'};
const third = {...first, id: 'c'.repeat(32), text: 'Review tests'};
const metadata = (quotes: QuoteSnapshot[]) => ({version: 2, quotes});

describe('self-contained native draft fingerprints', () => {
    const scope = {userId: 'author', channelId: 'channel', rootId: 'root'};
    const marked = fingerprintQuote(first, scope);

    it('reconstructs unchanged snapshots without any sidecar storage', () => {
        const message = quoteMarkdown(marked) + '\n\nMy comment';
        expect(reconcileQuotes(message, [], false, scope)).toEqual({message, quotes: [marked]});
    });

    it.each([
        {userId: 'other', channelId: 'channel', rootId: 'root'},
        {userId: 'author', channelId: 'other', rootId: 'root'},
        {userId: 'author', channelId: 'channel', rootId: 'other'},
    ])('turns a block copied to a different scope into manual text: %j', (destination) => {
        const result = reconcileQuotes(quoteMarkdown(marked), [], false, destination);
        expect(result.quotes).toEqual([]);
        expect(result.message).toContain('> Release on Friday');
        expect(result.message).not.toContain('Alice');
    });

    it.each([
        ['body', (text: string) => text.replace('Release', 'Ship')],
        ['author', (text: string) => text.replace('Alice', 'Bob')],
        ['fingerprint', (text: string) => text.replace(marked.fingerprint!, '0000000000000000')],
        ['missing fingerprint', (text: string) => text.replace('-' + marked.fingerprint!, '')],
        ['malformed fingerprint', (text: string) => text.replace(marked.fingerprint!, 'broken')],
    ])('drops attribution when %s changes in a reopened draft', (_label, edit) => {
        const message = (edit as (text: string) => string)(quoteMarkdown(marked));
        const result = reconcileQuotes(message, [], false, scope);
        expect(result.quotes).toEqual([]);
        expect(result.message).not.toContain('#br-');
        expect(result.message.slice(result.message.indexOf('\n'))).toBe(message.slice(message.indexOf('\n')));
    });

    it('round-trips escaped plaintext, line breaks, mentions, and Unicode', () => {
        const quote = fingerprintQuote({...first, author: 'A [name] @user', text: 'Срок **пятница**\n> пример @channel [x] \\ path 😀'}, scope);
        const message = quoteMarkdown(quote);
        expect(reconcileQuotes(message, [], false, scope)).toEqual({message, quotes: [quote]});
    });

    it('uses the original post scope during edit, including when another user reads it', () => {
        const oldPost = {...post(quoteMarkdown(marked)), user_id: scope.userId, channel_id: scope.channelId, root_id: scope.rootId, props: {[QUOTE_BLOCKS_PROP]: metadata([marked])}};
        const update = reconcileEditedPost({message: oldPost.message + '\n\nComment'}, oldPost);
        expect(update.props?.[QUOTE_BLOCKS_PROP]).toEqual(metadata([marked]));
        expect(getQuotedPostDisplayMessage(oldPost)).toBe(first.text);
    });
});

function post(message: string): Post {
    return {message, props: {[QUOTE_BLOCKS_PROP]: metadata([first, second, third]), another_plugin: 'keep'}} as unknown as Post;
}

describe('snapshot quote reconciliation', () => {
    it('quotes a v2 source as readable snapshot text and comments without internal markers', () => {
        const message = `${quoteMarkdown(first)}\n\nFriday works.\n\n${quoteMarkdown(second)}\n\n> My manual quote\n\nMigration ready.`;
        const text = getQuotedPostDisplayMessage(post(message));
        expect(text).toBe('Release on Friday\n\nFriday works.\n\nInclude migration\n\n> My manual quote\n\nMigration ready.');
        expect(quoteMarkdown({...third, text})).not.toContain(first.id);
        expect(quoteMarkdown({...third, text})).not.toContain(second.id);
    });

    it('keeps three interleaved snapshots and a manual quote exactly in order', () => {
        const message = `${quoteMarkdown(first)}\n\nFriday works.\n\n${quoteMarkdown(second)}\n\nMigration ready.\n\n> Manual quote\n\n${quoteMarkdown(third)}\n\nTests pass.`;
        expect(reconcileQuotes(message, [first, second, third])).toEqual({message, quotes: [first, second, third]});
    });

    it.each([
        ['edit text', (text: string) => text.replace('Release', 'Ship')],
        ['append quoted line', (text: string) => `${text}\n> Extra text`],
        ['remove quote marker', (text: string) => text.replace('> Release', 'Release')],
        ['delete body', (text: string) => text.split('\n')[0]],
        ['edit author', (text: string) => text.replace('Alice', 'Bob')],
        ['edit URL', (text: string) => text.replace('https://example.com', 'https://elsewhere.com')],
    ])('drops attribution after %s without losing edited body', (_name, edit) => {
        const message = (edit as (text: string) => string)(quoteMarkdown(first)) + '\n\nMy comment @intentional';
        const result = reconcileQuotes(message, [first]);
        expect(result.quotes).toEqual([]);
        expect(result.message).not.toContain('#br-');
        expect(result.message).toContain('My comment @intentional');
        expect(result.message.slice(result.message.indexOf('\n'))).toBe(message.slice(message.indexOf('\n')));
    });

    it('does not resurrect deleted blocks or attribute manual blocks', () => {
        const message = `> Manual quote\n\nAnswer\n\n${quoteMarkdown(second)}`;
        expect(reconcileQuotes(message, [first, second])).toEqual({message, quotes: [second]});
        expect(reconcileQuotes('', [first])).toEqual({message: '', quotes: []});
        expect(reconcileQuotes(quoteBody(first), [first])).toEqual({message: quoteBody(first), quotes: []});
    });

    it('handles duplicate fragments, reordering and pasted duplicates by identity', () => {
        const duplicate = {...first, id: 'd'.repeat(32)};
        const message = `${quoteMarkdown(duplicate)}\n\nB\n\n${quoteMarkdown(first)}\n\nA\n\n${quoteMarkdown(first)}`;
        expect(reconcileQuotes(message, [first, duplicate])).toEqual({message, quotes: [duplicate, first]});
    });

    it('preserves ordinary text and fenced/indented/nested examples', () => {
        const examples = [
            `\x60\x60\x60markdown\n${quoteMarkdown(first)}\n\x60\x60\x60`,
            `~~~~\n${quoteMarkdown(first)}\n~~~\n${quoteMarkdown(second)}\n~~~~`,
            quoteMarkdown(first).split('\n').map((line) => `    ${line}`).join('\n'),
            quoteMarkdown(first).split('\n').map((line) => `> ${line}`).join('\n'),
            `Comment ${quoteLink(first)}\n> unrelated`,
        ];
        for (const message of examples) {
            expect(reconcileQuotes(message, [first, second])).toEqual({message, quotes: []});
        }
    });

    it('keeps user text appended on the generated header when converting to manual', () => {
        const message = `> ${quoteLink(first)} my extra words\n> Edited text`;
        expect(reconcileQuotes(message, [first]).message).toBe('>  my extra words\n> Edited text');
    });

    it('suppresses quoted mentions without touching intentional mentions or Markdown in comments', () => {
        const quote = {...first, author: '@alice', text: '@channel *bold* [link](https://example.com)\nsecond line'};
        const message = quoteMarkdown(quote) + '\n\n@alice **please review**';
        const result = reconcileQuotes(message, [quote]);
        expect(result.message).toContain('@\u200bchannel \\*bold\\*');
        expect(result.message).toContain('@\u200balice');
        expect(result.message).toContain('\n\n@alice **please review**');
        expect(result.quotes).toEqual([quote]);
    });

    it('applies the real partial update hook contract and retains other props and attachments', () => {
        const oldPost = post(quoteMarkdown(first) + '\n\nReply');
        const patch = {message: oldPost.message.replace('Release', 'Ship'), file_ids: ['attachment']};
        const updated = reconcileEditedPost(patch, oldPost);
        expect(updated.message).toContain('> Ship on Friday');
        expect(updated.message).not.toContain('Alice');
        expect(updated.props).toEqual({another_plugin: 'keep', [QUOTE_BLOCKS_PROP]: metadata([])});
        expect(updated.file_ids).toEqual(['attachment']);
        expect(updated).not.toHaveProperty('id');
    });

    it('turns changed legacy prefixes into readable manual quotes', () => {
        const oldPost = {message: '> **Alice**\n> Original\n\nReply', props: {best_reply_fallback: '> **Alice**\n> Original'}} as unknown as Post;
        expect(reconcileEditedPost({message: '> **Alice**\n> Edited\n\nReply'}, oldPost)).toMatchObject({message: '> Edited\n\nReply', props: {[QUOTE_BLOCKS_PROP]: metadata([])}});
        expect(reconcileEditedPost({message: oldPost.message}, oldPost)).toEqual({message: oldPost.message});
    });

    it.each([undefined, null, {}, {version: 99, quotes: [first]}, metadata([null as unknown as QuoteSnapshot]), metadata([{...first, url: 'data:text/plain,test'}])])('does not trust malformed or unknown metadata %j', (value) => {
        expect(readQuoteSnapshots(value)).toBeNull();
        const original = {...post('User text'), props: {[QUOTE_BLOCKS_PROP]: value}} as unknown as Post;
        const patch = {message: 'Edited text'};
        expect(reconcileEditedPost(patch, original)).toBe(patch);
    });

    it('does not transform unrelated messages or add removed quotes on retry', () => {
        const original = {message: 'Ordinary text', props: {}} as Post;
        expect(applyQuoteSnapshots(original, [first])).toBe(original);
        const quoted = applyQuoteSnapshots({...original, message: quoteMarkdown(first)}, [first]);
        expect(applyQuoteSnapshots(quoted, [first])).toEqual(quoted);
        expect(applyQuoteSnapshots({...quoted, message: ''}, [first]).message).toBe('');
    });
});

describe('caret insertion', () => {
    it.each([0, 6, 12])('preserves both sides when inserting at %i', (caret) => {
        const text = 'Before After';
        const result = insertQuoteAtCaret(text, caret, first);
        expect(result.message).toBe(text.slice(0, caret) + result.insertion + text.slice(caret));
        expect(result.message.slice(result.caret)).toBe(text.slice(caret));
        expect(result.insertion).toContain(quoteMarkdown(first));
    });
});
