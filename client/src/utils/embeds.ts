import type { EmbedUrls, Platform, StreamerPlatform } from '../types';

/**
 * Client-side embed URL builder (mirrors server logic for pop-outs / offline use).
 */
export function buildEmbedUrls(
  platform: Platform,
  username: string,
  externalId?: string | null,
  videoId?: string | null,
  chatId?: string | null
): EmbedUrls {
  const user = username.replace(/^@/, '').trim();
  const parent = window.location.hostname || 'localhost';
  const ext = externalId?.trim() || null;
  const vid = videoId?.trim() || null;
  const cid = chatId?.trim() || null;

  switch (platform) {
    case 'twitch': {
      const twitchChatEmbed = `https://www.twitch.tv/embed/${encodeURIComponent(user)}/chat?parent=${encodeURIComponent(parent)}&darkpopout`;
      const twitchChatPopout = `https://www.twitch.tv/popout/${encodeURIComponent(user)}/chat?popout=`;
      return {
        platform,
        playerUrl: `https://player.twitch.tv/?channel=${encodeURIComponent(user)}&parent=${encodeURIComponent(parent)}&muted=false`,
        chatUrl: twitchChatEmbed,
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
      const handle = user.startsWith('@') ? user : `@${user}`;
      if (vid) {
        return {
          platform,
          playerUrl: `https://www.youtube.com/embed/${encodeURIComponent(vid)}?autoplay=1`,
          chatUrl: `https://www.youtube.com/live_chat?v=${encodeURIComponent(vid)}&embed_domain=${encodeURIComponent(parent)}`,
          profileUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}`,
          supportsPlayerEmbed: true,
          supportsChatEmbed: true,
          videoId: vid,
          notes: 'Live stream resolved — player + chat available.',
        };
      }
      return {
        platform,
        playerUrl: ext
          ? `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(ext)}`
          : null,
        chatUrl: null,
        profileUrl: ext
          ? `https://www.youtube.com/channel/${encodeURIComponent(ext)}`
          : `https://www.youtube.com/${encodeURIComponent(handle)}/live`,
        supportsPlayerEmbed: Boolean(ext),
        supportsChatEmbed: false,
        videoId: null,
        notes: ext
          ? 'Resolving live video for chat…'
          : 'Resolving live from username…',
      };
    }
    case 'rumble': {
      const rumbleUser = user.replace(/^c\//i, '');
      if (vid) {
        const rumbleChat = cid
          ? `https://rumble.com/chat/popup/${encodeURIComponent(cid)}`
          : null;
        return {
          platform,
          playerUrl: `https://rumble.com/embed/${encodeURIComponent(vid)}/`,
          chatUrl: rumbleChat,
          chatPopoutUrl: rumbleChat,
          profileUrl: `https://rumble.com/c/${encodeURIComponent(rumbleUser)}`,
          supportsPlayerEmbed: true,
          supportsChatEmbed: Boolean(rumbleChat),
          videoId: vid,
          chatId: cid,
        };
      }
      return {
        platform,
        playerUrl: null,
        chatUrl: null,
        profileUrl: `https://rumble.com/c/${encodeURIComponent(rumbleUser)}`,
        supportsPlayerEmbed: false,
        supportsChatEmbed: false,
        videoId: null,
        chatId: null,
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
        notes: 'X has no public live player/chat embed.',
      };
  }
}

export function embedsForPlatforms(
  platforms: StreamerPlatform[],
  serverEmbeds?: EmbedUrls[],
  resolvedIds?: {
    youtube?: string | null;
    rumble?: string | null;
    rumbleChatId?: string | null;
  }
): EmbedUrls[] {
  return platforms.map((p) => {
    if (p.platform === 'youtube' && resolvedIds?.youtube) {
      return buildEmbedUrls(p.platform, p.username, p.external_id, resolvedIds.youtube);
    }
    if (p.platform === 'rumble' && resolvedIds?.rumble) {
      return buildEmbedUrls(
        p.platform,
        p.username,
        p.external_id,
        resolvedIds.rumble,
        resolvedIds.rumbleChatId
      );
    }
    const fromServer = serverEmbeds?.find((e) => e.platform === p.platform);
    if (fromServer && p.platform !== 'youtube' && p.platform !== 'rumble') {
      return fromServer;
    }
    // Rebuild YT/Rumble client-side so host/embed state stays current
    if (p.platform === 'youtube' || p.platform === 'rumble') {
      return buildEmbedUrls(
        p.platform,
        p.username,
        p.external_id,
        fromServer?.videoId,
        fromServer?.chatId
      );
    }
    return buildEmbedUrls(p.platform, p.username, p.external_id);
  });
}

export function popOutUrl(
  url: string,
  title: string,
  width = 960,
  height = 540
): Window | null {
  const left = Math.max(0, (window.screen.width - width) / 2);
  const top = Math.max(0, (window.screen.height - height) / 2);
  return window.open(
    url,
    title,
    `popup=yes,width=${width},height=${height},left=${left},top=${top},noopener,noreferrer`
  );
}

export function popOutEmbed(
  kind: 'player' | 'chat',
  embed: EmbedUrls
): Window | null {
  // Chat: prefer dedicated popout URL (e.g. Twitch popout) over iframe embed URL
  const url =
    kind === 'player'
      ? embed.playerUrl || embed.profileUrl
      : embed.chatPopoutUrl || embed.chatUrl || embed.profileUrl;
  if (!url) return null;
  const w = kind === 'chat' ? 420 : 960;
  const h = kind === 'chat' ? 720 : 540;
  return popOutUrl(url, `${embed.platform}-${kind}`, w, h);
}
