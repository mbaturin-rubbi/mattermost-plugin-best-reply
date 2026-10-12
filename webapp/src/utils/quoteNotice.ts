import type {MessageId} from '../i18n/messages';

export const QUOTE_NOTICE_EVENT = 'best-reply-notice';

export function showQuoteNotice(message: MessageId): void {
    window.dispatchEvent(new CustomEvent(QUOTE_NOTICE_EVENT, {detail: message}));
}
