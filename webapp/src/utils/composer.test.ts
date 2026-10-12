// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {insertIntoComposer, rememberComposerCaret} from './composer';
import {quoteMarkdown, type QuoteSnapshot} from './quoteBlocks';

const quote: QuoteSnapshot = {id: 'a'.repeat(32), sourceId: 'p'.repeat(26), author: 'Alice', text: 'Release', url: `https://example.com/team/pl/${'p'.repeat(26)}`};

beforeEach(() => {
    document.body.innerHTML = '<div class="AdvancedTextEditor__cell"><textarea></textarea></div>';
    sessionStorage.clear();
    localStorage.clear();
});

describe('native composer insertion', () => {
    it('uses the remembered caret, preserves selected text and notifies a controlled input', () => {
        const textarea = document.querySelector('textarea')!;
        textarea.value = 'Before After';
        textarea.setSelectionRange(7, 12);
        textarea.addEventListener('select', rememberComposerCaret);
        textarea.dispatchEvent(new Event('select'));
        const onInput = vi.fn();
        textarea.addEventListener('input', onInput);
        expect(insertIntoComposer(textarea, quote)).toBe(true);
        expect(textarea.value).toBe(`Before \n\n${quoteMarkdown(quote)}\n\nAfter`);
        expect(textarea.value.slice(textarea.selectionStart)).toBe('After');
        expect(onInput).toHaveBeenCalledOnce();
    });

    it('uses insertText for native undo without a second input or replacing the entire value', () => {
        const textarea = document.querySelector('textarea')!;
        const command = vi.fn((_command, _ui, insertion) => {
            textarea.setRangeText(insertion, textarea.selectionStart, textarea.selectionEnd, 'end');
            textarea.dispatchEvent(new Event('input', {bubbles: true}));
            return true;
        });
        Object.defineProperty(document, 'execCommand', {configurable: true, value: command});
        const onInput = vi.fn();
        textarea.addEventListener('input', onInput);
        insertIntoComposer(textarea, quote);
        expect(command).toHaveBeenCalledWith('insertText', false, quoteMarkdown(quote) + '\n\n');
        expect(onInput).toHaveBeenCalledOnce();
        Reflect.deleteProperty(document, 'execCommand');
    });

    it('does not touch detached, disabled, or read-only textareas', () => {
        const textarea = document.querySelector('textarea')!;
        textarea.value = 'Draft';
        textarea.disabled = true;
        expect(insertIntoComposer(textarea, quote)).toBe(false);
        textarea.disabled = false;
        textarea.readOnly = true;
        expect(insertIntoComposer(textarea, quote)).toBe(false);
        textarea.readOnly = false;
        textarea.remove();
        expect(insertIntoComposer(textarea, quote)).toBe(false);
        expect(textarea.value).toBe('Draft');
    });

    it('does not truncate a draft when the quote would exceed the native limit', () => {
        const textarea = document.querySelector('textarea')!;
        textarea.value = 'Draft';
        textarea.maxLength = 10;
        expect(insertIntoComposer(textarea, quote)).toBe(false);
        expect(textarea.value).toBe('Draft');
    });
});
