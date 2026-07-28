import type { Platform } from './types.js';

export interface EmbedUrls {
  platform: Platform;
  playerUrl: string | null;
  /** URL for in-page chat iframe (must allow embedding) */
  chatUrl: string | null;
  /**
   * Preferred URL for the "Pop out chat" window.
   * Falls back to chatUrl, then profileUrl, when omitted.
   */
  chatPopoutUrl?: string | null;
  profileUrl: string;
  supportsPlayerEmbed: boolean;
  supportsChatEmbed: boolean;
  notes?: string;
}

/**
 * Build embed / profile URLs for a platform.
 * `parentHost` is required for Twitch (parent query param must match the page host).
 */
export function buildEmbedUrls(
  platform: Platform,
  username: string,
  options: {
    parentHost?: string;
    externalId?: string | null;
    /** Resolved live video ID (YouTube) or embed id (Rumble) */
    videoId?: string | null;
    /** Rumble chat popup content id */
    chatId?: string | null;
  } = {}
): EmbedUrls {
  const user = username.replace(/^@/, '').trim();
  const parent = options.parentHost || 'localhost';
  const externalId = options.externalId?.trim() || null;
  const videoId = options.videoId?.trim() || null;
  const chatId = options.chatId?.trim() || null;

  switch (platform) {
    case 'twitch': {
      const twitchChatEmbed = `https://www.twitch.tv/embed/${encodeURIComponent(user)}/chat?parent=${encodeURIComponent(parent)}&darkpopout`;
      const twitchChatPopout = `https://www.twitch.tv/popout/${encodeURIComponent(user)}/chat?popout=`;
      return {
        platform,
        playerUrl: `https://player.twitch.tv/?channel=${encodeURIComponent(user)}&parent=${encodeURIComponent(parent)}&muted=false`,
        // Iframe-friendly embed (requires matching parent host)
        chatUrl: twitchChatEmbed,
        // Window popout — popout URL cannot be iframed (X-Frame-Options)
        chatPopoutUrl: twitchChatPopout,
        profileUrl: `https://www.twitch.tv/${encodeURIComponent(user)}`,
        supportsPlayerEmbed: true,
        supportsChatEmbed: true,
      };
    }

    case 'kick': {
      const kickChat = `https://kick.com/popout/${encodeURIComponent(user)}/chat`;
      return {
        platform,
        playerUrl: `https://player.kick.com/${encodeURIComponent(user)}`,
        chatUrl: kickChat,
        chatPopoutUrl: kickChat,
        profileUrl: `https://kick.com/${encodeURIComponent(user)}`,
        supportsPlayerEmbed: true,
        supportsChatEmbed: true,
      };
    }

    case 'youtube': {
      // Prefer resolved live video ID; else channel live_stream embed; else open link
      const channelParam = externalId
        ? `channel=${encodeURIComponent(externalId)}`
        : null;
      const handle = user.startsWith('@') ? user : `@${user}`;
      const profileUrl = externalId
        ? `https://www.youtube.com/channel/${encodeURIComponent(externalId)}`
        : `https://www.youtube.com/${encodeURIComponent(handle)}/live`;

      if (videoId) {
        return {
          platform,
          playerUrl: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1`,
          chatUrl: `https://www.youtube.com/live_chat?v=${encodeURIComponent(videoId)}&embed_domain=${encodeURIComponent(parent)}`,
          profileUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
          supportsPlayerEmbed: true,
          supportsChatEmbed: true,
          notes: 'Resolved from live stream. Chat needs a matching embed_domain host.',
        };
      }

      return {
        platform,
        playerUrl: channelParam
          ? `https://www.youtube.com/embed/live_stream?${channelParam}`
          : null,
        chatUrl: null,
        profileUrl,
        supportsPlayerEmbed: Boolean(channelParam),
        supportsChatEmbed: false,
        notes: channelParam
          ? 'Checking for live video… Chat appears once the live stream is resolved.'
          : 'Set channel ID (UC…) or wait for live resolve from username. Chat needs a live video ID.',
      };
    }

    case 'rumble': {
      if (videoId) {
        const rumbleChat = chatId
          ? `https://rumble.com/chat/popup/${encodeURIComponent(chatId)}`
          : null;
        return {
          platform,
          playerUrl: `https://rumble.com/embed/${encodeURIComponent(videoId)}/`,
          chatUrl: rumbleChat,
          chatPopoutUrl: rumbleChat,
          profileUrl: `https://rumble.com/c/${encodeURIComponent(user)}`,
          supportsPlayerEmbed: true,
          supportsChatEmbed: Boolean(rumbleChat),
        };
      }
      return {
        platform,
        playerUrl: null,
        chatUrl: null,
        profileUrl: `https://rumble.com/c/${encodeURIComponent(user)}`,
        supportsPlayerEmbed: false,
        supportsChatEmbed: false,
        notes: 'Player appears when the channel is live.',
      };
    }

    case 'x':
      return {
        platform,
        playerUrl: null,
        chatUrl: null,
        profileUrl: `https://x.com/${encodeURIComponent(user)}`,
        supportsPlayerEmbed: false,
        supportsChatEmbed: false,
        notes: 'X does not provide a public live player/chat embed. Open the profile or use pop-out.',
      };

    default: {
      const _exhaustive: never = platform;
      throw new Error(`Unknown platform: ${_exhaustive}`);
    }
  }
}

export const PLATFORM_META: Record<
  Platform,
  { label: string; color: string; icon: string }
> = {
  twitch: { label: 'Twitch', color: '#9146FF', icon: 'twitch' },
  kick: { label: 'Kick', color: '#53FC18', icon: 'kick' },
  youtube: { label: 'YouTube', color: '#FF0000', icon: 'youtube' },
  rumble: { label: 'Rumble', color: '#85C742', icon: 'rumble' },
  x: { label: 'X', color: '#E7E9EA', icon: 'x' },
};
