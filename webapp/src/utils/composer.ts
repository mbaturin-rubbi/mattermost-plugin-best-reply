import {insertQuoteAtCaret, type QuoteSnapshot} from './quoteBlocks';

const carets = new WeakMap<HTMLTextAreaElement, {value: string; caret: number}>();

export function rememberComposerCaret(event: Event): void {
    const textarea = event.target;
    if (textarea instanceof HTMLTextAreaElement && textarea.closest('.AdvancedTextEditor__cell, #post-create')) {
        carets.set(textarea, {value: textarea.value, caret: textarea.selectionStart});
    }
}

export function insertIntoComposer(textarea: HTMLTextAreaElement, quote: QuoteSnapshot): boolean {
    if (textarea.disabled || textarea.readOnly || !textarea.isConnected) {
        return false;
    }
    const remembered = carets.get(textarea);
    const original = textarea.value;
    const caret = remembered?.value === textarea.value ? remembered.caret : textarea.value.length;
    const inserted = insertQuoteAtCaret(textarea.value, caret, quote);
    if (textarea.maxLength >= 0 && inserted.message.length > textarea.maxLength) {
        return false;
    }
    textarea.focus();
    textarea.setSelectionRange(inserted.start, inserted.start);

    // insertText joins the browser's undo history; React receives its native input.
    if (typeof document.execCommand === 'function') {
        try {
            document.execCommand('insertText', false, inserted.insertion);
        } catch {
            // Some hosts expose the command but reject it for textareas.
        }
    }
    if (textarea.value !== inserted.message) {
        if (textarea.value !== original) {
            return false;
        }

        // shortcut: browsers without insertText cannot preserve native undo for this insertion.
        const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (!setValue) {
            return false;
        }
        setValue.call(textarea, inserted.message);
        textarea.dispatchEvent(new Event('input', {bubbles: true}));
    }
    textarea.setSelectionRange(inserted.caret, inserted.caret);
    carets.set(textarea, {value: textarea.value, caret: inserted.caret});
    return true;
}
