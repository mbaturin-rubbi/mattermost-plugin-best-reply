// Selection popup and Ctrl+Q hotkey for quoting a fragment of a message.
// Ported from ZILosoft/mattermost-reply (Apache License 2.0) and adapted to
// the Best Reply pending-reply flow.

import React, {useCallback, useEffect, useState} from 'react';
import {createPortal} from 'react-dom';
import {useStore} from 'react-redux';

import {ensurePostLoaded} from '../actions/navigateToPost';
import {isReplyablePost} from '../actions/openThread';
import {startReplyToPost} from '../actions/reply';
import {SELECTION_POPUP_BOTTOM_MARGIN, SELECTION_POPUP_OFFSET, SELECTION_POPUP_WIDTH} from '../constants';
import {useTranslation} from '../i18n';
import {showQuoteNotice} from '../utils/quoteNotice';
import {getSelectionQuoteContext, type SelectionQuoteContext} from '../utils/selection';

type OverlayState = SelectionQuoteContext & {
    top: number;
    left: number;
};

function readSelectionOverlay(): OverlayState | null {
    const context = getSelectionQuoteContext();
    if (!context) {
        return null;
    }

    // The selection rect lives in viewport coordinates, so the popup is
    // positioned with position: fixed and clamped onscreen.
    return {
        ...context,
        top: Math.min(context.rect.bottom + SELECTION_POPUP_OFFSET, window.innerHeight - SELECTION_POPUP_BOTTOM_MARGIN),
        left: Math.min(context.rect.left + (context.rect.width / 2), window.innerWidth - SELECTION_POPUP_WIDTH),
    };
}

const SelectionQuoteButton: React.FC = () => {
    const store = useStore();
    const [overlay, setOverlay] = useState<OverlayState | null>(null);
    const t = useTranslation();

    const submitQuote = useCallback(async (current: OverlayState) => {
        setOverlay(null);
        window.getSelection()?.removeAllRanges();

        let post;
        try {
            post = await ensurePostLoaded(store, current.postId);
        } catch {
            showQuoteNotice('quote_open_failed');
            return;
        }
        if (!post || !isReplyablePost(post)) {
            showQuoteNotice('quote_open_failed');
            return;
        }

        await startReplyToPost(store, post, {
            context: 'thread',
            element: current.messageBody,
            selectedText: current.selectedText,
        });
    }, [store]);

    useEffect(() => {
        const updateOverlay = () => setOverlay(readSelectionOverlay());
        const clearOverlay = () => setOverlay(null);

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
                return;
            }

            if (event.key.toLowerCase() !== 'q') {
                return;
            }

            const current = readSelectionOverlay();
            if (!current) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            submitQuote(current);
        };

        document.addEventListener('selectionchange', updateOverlay);
        document.addEventListener('keydown', handleKeyDown, true);
        window.addEventListener('scroll', clearOverlay, true);
        window.addEventListener('resize', updateOverlay);

        return () => {
            document.removeEventListener('selectionchange', updateOverlay);
            document.removeEventListener('keydown', handleKeyDown, true);
            window.removeEventListener('scroll', clearOverlay, true);
            window.removeEventListener('resize', updateOverlay);
        };
    }, [submitQuote]);

    if (!overlay) {
        return null;
    }

    // Render directly into <body> so no ancestor stacking context, opacity,
    // or transform can make the popup translucent or mis-positioned.
    return createPortal(
        <button
            type='button'
            className='best-reply-selection-popup'
            style={{top: `${overlay.top}px`, left: `${overlay.left}px`}}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
                submitQuote(overlay);
            }}
        >
            {t('quote_action')}
        </button>,
        document.body,
    );
};

export default SelectionQuoteButton;
