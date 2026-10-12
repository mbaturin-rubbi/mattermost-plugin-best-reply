import React from 'react';
import type {Store} from 'redux';

import type {Post} from '@mattermost/types/posts';
import type {GlobalState} from '@mattermost/types/store';

import {getPostFromStore, isReplyablePost} from './actions/openThread';
import {clearPendingReply, getPendingReply, startReplyToPost} from './actions/reply';
import ErrorBoundary from './components/ErrorBoundary';
import QuotedReplyPost from './components/QuotedReplyPost';
import QuotedReplyStyles from './components/QuotedReplyStyles';
import ReplyButton from './components/ReplyButton';
import ReplyComposerPreview from './components/ReplyComposerPreview';
import SelectionQuoteButton from './components/SelectionQuoteButton';
import {QUOTED_REPLY_POST_TYPE} from './constants';
import {getTranslationsForLocale} from './i18n';
import manifest from './manifest';
import reducer from './reducers';
import type {PluginRegistry} from './types/mattermost-webapp';
import {installNativePostEditReconciliation} from './utils/nativePostEdits';
import {applyQuoteSnapshots, reconcileEditedPost} from './utils/quoteBlocks';

// The registry expects component types, not elements (passing JSX here throws
// React #130 and unmounts the whole app); every component is additionally
// wrapped so a render crash degrades instead of propagating to Mattermost.
function wrapWithErrorBoundary<P extends {post: Post}>(Component: React.ComponentType<P>): React.ComponentType<P> {
    const Wrapped: React.FC<P> = (props) => (
        <ErrorBoundary>
            <Component {...props}/>
        </ErrorBoundary>
    );
    return Wrapped;
}

function wrapRootWithErrorBoundary(Component: React.ComponentType): React.ComponentType {
    const Wrapped: React.FC = () => (
        <ErrorBoundary>
            <Component/>
        </ErrorBoundary>
    );
    return Wrapped;
}

export default class Plugin {
    private removeNativeEditReconciliation?: () => void;

    public initialize(registry: PluginRegistry, store: Store<GlobalState>): void {
        this.removeNativeEditReconciliation?.();
        this.removeNativeEditReconciliation = installNativePostEditReconciliation(store);
        registry.registerReducer(reducer);
        registry.registerTranslations(getTranslationsForLocale);
        registry.registerRootComponent(QuotedReplyStyles);
        registry.registerRootComponent(wrapRootWithErrorBoundary(ReplyComposerPreview));
        registry.registerRootComponent(wrapRootWithErrorBoundary(SelectionQuoteButton));
        registry.registerPostActionComponent(wrapWithErrorBoundary(ReplyButton));
        registry.registerPostTypeComponent(QUOTED_REPLY_POST_TYPE, wrapWithErrorBoundary(QuotedReplyPost));

        registry.registerPostDropdownMenuAction(
            'Thread',
            (postId: string) => {
                const post = getPostFromStore(store, postId);
                if (post) {
                    startReplyToPost(store, post, {context: 'thread'});
                }
            },
            (postId: string) => {
                const post = getPostFromStore(store, postId);
                return isReplyablePost(post);
            },
        );

        registry.registerMessageWillBePostedHook((post) => {
            const pendingReply = getPendingReply(store);
            if (pendingReply?.channelId === post.channel_id && pendingReply.rootId === (post.root_id || '')) {
                clearPendingReply(store);
            }
            return {post: applyQuoteSnapshots(post, [], {userId: store.getState().entities.users.currentUserId, channelId: post.channel_id, rootId: post.root_id || ''})};
        });
        registry.registerMessageWillBeUpdatedHook((post, oldPost) => ({post: reconcileEditedPost(post, oldPost)}));
    }

    public uninitialize(): void {
        this.removeNativeEditReconciliation?.();
        this.removeNativeEditReconciliation = undefined;
    }
}

declare global {
    interface Window {
        registerPlugin: (pluginId: string, plugin: Plugin) => void;
    }
}

window.registerPlugin(manifest.id, new Plugin());
