// Mattermost webapp plugin registry typings, trimmed to the methods this
// plugin actually uses (the full upstream file lives in the
// mattermost-webapp repo). The registry expects component *types*, never
// JSX elements — passing an element throws React error #130 (docs/api.md).

import type {ComponentType, ReactNode} from 'react';
import type {Reducer} from 'redux';

import type {Post} from '@mattermost/types/posts';

export type UniqueIdentifier = string;

export interface PluginRegistry {

    // The plugin reducer is mounted under `plugins-<plugin-id>` in the
    // global store (docs/api.md).
    registerReducer(reducerToRegister: Reducer): void;

    // Key-value translations merged into the webapp i18n dictionaries.
    registerTranslations(getTranslationsForLocale: (locale: string) => Record<string, string>): void;

    registerRootComponent(component: ComponentType): UniqueIdentifier;

    // Post hover action button; the component receives the post as a prop.
    registerPostActionComponent(component: ComponentType<{post: Post}>): UniqueIdentifier;

    // Renderer for a custom post type (`custom_*`).
    registerPostTypeComponent(type: string, component: ComponentType<{post: Post}>): UniqueIdentifier;

    // Post dropdown menu item; action and filter receive the post id.
    registerPostDropdownMenuAction(
        text: ReactNode,
        action: (postId: string) => void,
        filter?: (postId: string) => boolean,
    ): UniqueIdentifier;

    // Synchronous (or async) transformation of an outgoing post; the
    // returned object replaces the post before it is sent.
    registerMessageWillBePostedHook(
        hook: (post: Post) => {post: Post} | {error: {message: string}} | Promise<{post: Post} | {error: {message: string}}>,
    ): UniqueIdentifier;

    registerMessageWillBeUpdatedHook(
        hook: (post: Partial<Post>, oldPost: Post) => {post: Partial<Post>},
    ): UniqueIdentifier;
}
