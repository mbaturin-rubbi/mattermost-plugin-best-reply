// UI strings for the plugin itself. The dictionaries are the single source
// of truth: MessageId is derived from the English table, so every call site
// is compile-checked and the symmetry test (i18n/messages.test.ts) keeps the
// locales in lockstep.

export const messages = {
    en: {
        quote_action: 'Quote',
        reply_action: 'Reply',
        reply_action_title: 'Reply to message',
        thread_action: 'Thread',
        quote_open_failed: 'Unable to open the source thread. Your draft has been preserved.',
        quote_insert_failed: 'Unable to insert the quote. Check the editor and message length; existing draft text is preserved.',
        quote_source_unavailable: 'The original message is unavailable. The saved quote is still shown.',
        quote_editor_unavailable: 'Quote insertion needs the Markdown text editor. Your draft has been preserved.',
        quote_loading: 'Opening quote…',
        quote_dismiss: 'Dismiss',
        quote_cancel: 'Cancel reply',
    },
    ru: {
        quote_action: 'Цитировать',
        reply_action: 'Ответить',
        reply_action_title: 'Ответить на сообщение',
        thread_action: 'Тред',
        quote_open_failed: 'Не удалось открыть исходный тред. Черновик сохранён.',
        quote_insert_failed: 'Не удалось вставить цитату. Проверьте редактор и длину сообщения; прежний текст черновика сохранён.',
        quote_source_unavailable: 'Исходное сообщение недоступно. Сохранённая цитата остаётся видимой.',
        quote_editor_unavailable: 'Для вставки цитаты нужен текстовый редактор Markdown. Черновик сохранён.',
        quote_loading: 'Открываем цитату…',
        quote_dismiss: 'Закрыть',
        quote_cancel: 'Отменить ответ',
    },
    fr: {
        quote_action: 'Citer',
        reply_action: 'Répondre',
        reply_action_title: 'Répondre au message',
        thread_action: 'Fil',
        quote_open_failed: 'Impossible d’ouvrir le fil source. Votre brouillon est conservé.',
        quote_insert_failed: 'Impossible d’insérer la citation. Vérifiez l’éditeur et la longueur du message ; le texte existant est conservé.',
        quote_source_unavailable: 'Le message original est indisponible. La citation enregistrée reste visible.',
        quote_editor_unavailable: 'L’insertion nécessite l’éditeur Markdown. Votre brouillon est conservé.',
        quote_loading: 'Ouverture de la citation…',
        quote_dismiss: 'Fermer',
        quote_cancel: 'Annuler la réponse',
    },
    de: {
        quote_action: 'Zitieren',
        reply_action: 'Antworten',
        reply_action_title: 'Auf Nachricht antworten',
        thread_action: 'Thread',
        quote_open_failed: 'Der ursprüngliche Thread konnte nicht geöffnet werden. Ihr Entwurf bleibt erhalten.',
        quote_insert_failed: 'Das Zitat konnte nicht eingefügt werden. Prüfen Sie Editor und Nachrichtenlänge; der bisherige Text bleibt erhalten.',
        quote_source_unavailable: 'Die ursprüngliche Nachricht ist nicht verfügbar. Das gespeicherte Zitat bleibt sichtbar.',
        quote_editor_unavailable: 'Zitate benötigen den Markdown-Texteditor. Ihr Entwurf bleibt erhalten.',
        quote_loading: 'Zitat wird geöffnet…',
        quote_dismiss: 'Schließen',
        quote_cancel: 'Antwort abbrechen',
    },
} as const;

export type Locale = keyof typeof messages;

export type MessageId = keyof typeof messages.en;
