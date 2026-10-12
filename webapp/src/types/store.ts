import type {QuoteSnapshot} from '../utils/quoteBlocks';

export type ReplyContext = 'channel' | 'thread';

export type PendingReply = {
    replyToPostId: string;
    channelId: string;
    rootId: string;
    context: ReplyContext;
    selectedText?: string;
    isOpeningThread?: boolean;
    quote?: QuoteSnapshot;
    surface?: 'rhs' | 'global' | 'channel';
};

export type PluginState = {
    pendingReply: PendingReply | null;
};

export const PLUGIN_STATE_KEY = 'plugins-com.bestreply.plugin';

export const SET_PENDING_REPLY = pluginAction('SET_PENDING_REPLY');
export const CLEAR_PENDING_REPLY = pluginAction('CLEAR_PENDING_REPLY');

function pluginAction(name: string): string {
    return `PLUGIN_${PLUGIN_STATE_KEY}_${name}`;
}
