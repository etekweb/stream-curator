/**
 * Resolve creator avatar / profile image URLs from streaming platforms.
 * Mix of public APIs, page scrape, and unavatar.io fallbacks.
 */

import type { Platform } from '../types.js';

export interface AvatarResolveResult {
  url: string;
  platform: Platform;
  source: string;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const FETCH_MS = 12_000;

// Public web Client-ID used by twitch.tv (unofficial; may change)
const TWITCH_WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

function normalizeUser(username: string): string {
  return username.replace(/^@/, '').trim();
}

async function fetchText(
  url: string,
  init: RequestInit = {}
): Promise<{ status: number; body: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_MS);
  try {
    const res = await fetch(url, {
      ...init,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: '*/*',
        ...(init.headers || {}),
      },
    });
    const body = await res.text();
    return { status: res.status, body, finalUrl: res.url };
  } finally {
    clearTimeout(timer);
  }
}

function isLikelyImageUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  // Reject obvious HTML error pages served as "images"
  if (url.includes('unavatar.io') && url.endsWith('.svg')) return false;
  return true;
}

async function headOk(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'image/*,*/*' },
      });
      if (!res.ok) return false;
      const ct = res.headers.get('content-type') || '';
      // Drain a bit so connection can close cleanly
      await res.arrayBuffer().catch(() => undefined);
      return ct.startsWith('image/') || ct.includes('octet-stream');
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

async function resolveTwitch(username: string): Promise<AvatarResolveResult | null> {
  const login = normalizeUser(username).toLowerCase();
  try {
    const { status, body } = await fetchText('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Client-Id': TWITCH_WEB_CLIENT_ID,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        {
          operationName: 'ChannelShell',
          variables: { login },
          extensions: {
            persistedQuery: {
              version: 1,
              sha256Hash:
                '580ab410bcd0c1ad194224957ae2241e5d252b2c5173d8e0cce9d32d5bb14efe',
            },
          },
        },
      ]),
    });
    if (status >= 400) return null;
    const data = JSON.parse(body) as Array<{
      data?: { userOrError?: { profileImageURL?: string; __typename?: string } };
    }>;
    let url = data?.[0]?.data?.userOrError?.profileImageURL;
    if (!url) return null;
    // Prefer a larger size when Twitch returns sized assets
    url = url.replace(/-profile_image-\d+x\d+\./, '-profile_image-300x300.');
    return { url, platform: 'twitch', source: 'twitch-gql' };
  } catch (err) {
    console.warn('[avatar] twitch failed', err);
    return null;
  }
}

async function resolveYouTube(
  username: string,
  channelId?: string | null
): Promise<AvatarResolveResult | null> {
  const handle = normalizeUser(username);
  const candidates = [
    channelId ? `https://www.youtube.com/channel/${channelId}` : null,
    `https://www.youtube.com/@${handle}`,
    `https://www.youtube.com/c/${handle}`,
    `https://www.youtube.com/user/${handle}`,
  ].filter(Boolean) as string[];

  for (const page of candidates) {
    try {
      const { status, body } = await fetchText(page);
      if (status >= 400) continue;

      const patterns = [
        /"avatar":\{"thumbnails":\[\{"url":"([^"]+)"/,
        /property="og:image" content="([^"]+)"/,
        /itemprop="image" content="([^"]+)"/,
      ];
      for (const re of patterns) {
        const m = body.match(re);
        if (m?.[1]) {
          let url = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
          // Request a reasonably large size when YouTube includes size params
          url = url.replace(/=s\d+-/, '=s300-');
          if (isLikelyImageUrl(url)) {
            return { url, platform: 'youtube', source: 'youtube-page' };
          }
        }
      }
    } catch (err) {
      console.warn('[avatar] youtube page failed', page, err);
    }
  }

  // unavatar fallback
  const un = `https://unavatar.io/youtube/${encodeURIComponent(handle)}`;
  if (await headOk(un)) {
    return { url: un, platform: 'youtube', source: 'unavatar' };
  }
  return null;
}

async function resolveRumble(username: string): Promise<AvatarResolveResult | null> {
  const user = normalizeUser(username).replace(/^c\//i, '');
  try {
    const { status, body } = await fetchText(
      `https://rumble.com/c/${encodeURIComponent(user)}`
    );
    if (status >= 400) return null;

    const patterns = [
      /class="channel-header--img"[^>]*src="([^"]+)"/,
      /channel-header--img[^>]+src="([^"]+)"/,
      /property=og:image content=([^\s>]+)/,
      /property="og:image" content="([^"]+)"/,
      /"thumb":"(https:[^"]+)"/,
    ];
    for (const re of patterns) {
      const m = body.match(re);
      if (m?.[1]) {
        let url = m[1].replace(/&amp;/g, '&');
        // Prefer static channel icon over animated gif og:image when both exist
        if (url.includes('.gif') && body.includes('channel-header--img')) {
          continue;
        }
        if (isLikelyImageUrl(url)) {
          return { url, platform: 'rumble', source: 'rumble-page' };
        }
      }
    }

    // Fall back to first og:image even if gif
    const og = body.match(/property=og:image content=([^\s>]+)/);
    if (og?.[1] && isLikelyImageUrl(og[1])) {
      return {
        url: og[1].replace(/&amp;/g, '&'),
        platform: 'rumble',
        source: 'rumble-og',
      };
    }
  } catch (err) {
    console.warn('[avatar] rumble failed', err);
  }
  return null;
}

let kickAppTokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Optional official Kick Dev app credentials (client credentials grant).
 * https://docs.kick.com/
 */
async function getKickAppAccessToken(): Promise<string | null> {
  const clientId = process.env.KICK_CLIENT_ID?.trim();
  const clientSecret = process.env.KICK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  if (kickAppTokenCache && kickAppTokenCache.expiresAt > Date.now() + 30_000) {
    return kickAppTokenCache.token;
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
    const { status, body: text } = await fetchText('https://id.kick.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (status >= 400) {
      console.warn('[avatar] kick oauth failed', status, text.slice(0, 200));
      return null;
    }
    const data = JSON.parse(text) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return null;
    kickAppTokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    };
    return data.access_token;
  } catch (err) {
    console.warn('[avatar] kick oauth error', err);
    return null;
  }
}

async function resolveKickOfficial(username: string): Promise<AvatarResolveResult | null> {
  const token = await getKickAppAccessToken();
  if (!token) return null;
  const slug = normalizeUser(username).toLowerCase();

  try {
    // 1) Resolve slug → broadcaster user id
    const ch = await fetchText(
      `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(slug)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    );
    if (ch.status >= 400) return null;
    const chData = JSON.parse(ch.body) as {
      data?: Array<{ broadcaster_user_id?: number }>;
    };
    const userId = chData.data?.[0]?.broadcaster_user_id;
    if (!userId) return null;

    // 2) User profile includes profile_picture
    const us = await fetchText(
      `https://api.kick.com/public/v1/users?id=${encodeURIComponent(String(userId))}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
    );
    if (us.status >= 400) return null;
    const usData = JSON.parse(us.body) as {
      data?: Array<{ profile_picture?: string; name?: string }>;
    };
    const pic = usData.data?.[0]?.profile_picture;
    if (pic && isLikelyImageUrl(pic)) {
      return { url: pic, platform: 'kick', source: 'kick-official-api' };
    }
  } catch (err) {
    console.warn('[avatar] kick official api failed', err);
  }
  return null;
}

/**
 * Microlink free meta API — works when Kick Cloudflare blocks our IP.
 * Free tier is rate-limited; good enough for occasional "Pull icon" clicks.
 */
async function resolveKickViaMicrolink(
  username: string
): Promise<AvatarResolveResult | null> {
  const user = normalizeUser(username).toLowerCase();
  const target = `https://kick.com/${encodeURIComponent(user)}`;
  const api = `https://api.microlink.io?url=${encodeURIComponent(target)}&meta=true`;
  try {
    const { status, body } = await fetchText(api, {
      headers: { Accept: 'application/json' },
    });
    if (status >= 400) return null;
    const data = JSON.parse(body) as {
      status?: string;
      data?: {
        image?: { url?: string };
        logo?: { url?: string };
      };
    };
    if (data.status && data.status !== 'success') return null;
    const candidates = [data.data?.image?.url, data.data?.logo?.url].filter(
      Boolean
    ) as string[];
    for (const url of candidates) {
      // Prefer real Kick CDN avatars over generic favicons
      if (
        isLikelyImageUrl(url) &&
        (url.includes('files.kick.com') ||
          url.includes('images.kick.com') ||
          url.includes('kick.com/images'))
      ) {
        return { url, platform: 'kick', source: 'microlink' };
      }
    }
    // Accept non-favicon images as last resort
    for (const url of candidates) {
      if (
        isLikelyImageUrl(url) &&
        !url.includes('favicon') &&
        !url.includes('gstatic.com/favicon')
      ) {
        return { url, platform: 'kick', source: 'microlink' };
      }
    }
  } catch (err) {
    console.warn('[avatar] kick microlink failed', err);
  }
  return null;
}

async function resolveKick(username: string): Promise<AvatarResolveResult | null> {
  const user = normalizeUser(username).toLowerCase();

  // 1) Official Kick Dev API (if KICK_CLIENT_ID / KICK_CLIENT_SECRET set)
  const official = await resolveKickOfficial(user);
  if (official) return official;

  // 2) Legacy website API (often Cloudflare-blocked from servers)
  const urls = [
    `https://kick.com/api/v2/channels/${encodeURIComponent(user)}`,
    `https://kick.com/api/v1/channels/${encodeURIComponent(user)}`,
  ];
  for (const url of urls) {
    try {
      const { status, body } = await fetchText(url, {
        headers: {
          Accept: 'application/json',
          Referer: 'https://kick.com/',
        },
      });
      if (status >= 400) continue;
      const data = JSON.parse(body) as {
        user?: { profile_pic?: string; profilepic?: string };
        profile_pic?: string;
      };
      const pic =
        data.user?.profile_pic ||
        data.user?.profilepic ||
        data.profile_pic ||
        null;
      if (pic && isLikelyImageUrl(pic)) {
        return { url: pic, platform: 'kick', source: 'kick-api' };
      }
    } catch {
      /* continue */
    }
  }

  // 3) Page scrape (also often blocked)
  try {
    const { status, body } = await fetchText(`https://kick.com/${encodeURIComponent(user)}`, {
      headers: { Referer: 'https://kick.com/' },
    });
    if (status < 400 && body.length > 200) {
      const m =
        body.match(/"profile_picture"\s*:\s*"([^"]+)"/) ||
        body.match(/"profile_pic"\s*:\s*"([^"]+)"/) ||
        body.match(/property="og:image" content="([^"]+)"/);
      if (m?.[1]) {
        const url = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
        if (isLikelyImageUrl(url) && !url.includes('kick-logo')) {
          return { url, platform: 'kick', source: 'kick-page' };
        }
      }
    }
  } catch {
    /* ignore */
  }

  // 4) Microlink Open Graph proxy (works when Kick blocks our IP)
  const viaMicro = await resolveKickViaMicrolink(user);
  if (viaMicro) return viaMicro;

  return null;
}

async function resolveX(username: string): Promise<AvatarResolveResult | null> {
  const user = normalizeUser(username);
  // unavatar is the most reliable no-key option for X
  for (const path of [
    `https://unavatar.io/x/${encodeURIComponent(user)}`,
    `https://unavatar.io/twitter/${encodeURIComponent(user)}`,
  ]) {
    if (await headOk(path)) {
      return { url: path, platform: 'x', source: 'unavatar' };
    }
  }
  return null;
}

async function resolveUnavatar(
  platform: Platform,
  username: string
): Promise<AvatarResolveResult | null> {
  const user = normalizeUser(username);
  const map: Partial<Record<Platform, string>> = {
    twitch: `https://unavatar.io/twitch/${encodeURIComponent(user)}`,
    youtube: `https://unavatar.io/youtube/${encodeURIComponent(user)}`,
    x: `https://unavatar.io/x/${encodeURIComponent(user)}`,
  };
  const url = map[platform];
  if (!url) return null;
  if (await headOk(url)) {
    return { url, platform, source: 'unavatar' };
  }
  return null;
}

export async function resolveAvatar(options: {
  platform: Platform;
  username: string;
  externalId?: string | null;
}): Promise<AvatarResolveResult> {
  const { platform, username, externalId } = options;
  if (!username?.trim()) {
    throw Object.assign(new Error('username is required'), { status: 400 });
  }

  let result: AvatarResolveResult | null = null;

  switch (platform) {
    case 'twitch':
      result = (await resolveTwitch(username)) || (await resolveUnavatar('twitch', username));
      break;
    case 'youtube':
      result = await resolveYouTube(username, externalId);
      break;
    case 'rumble':
      result = await resolveRumble(username);
      break;
    case 'kick':
      result = await resolveKick(username);
      break;
    case 'x':
      result = await resolveX(username);
      break;
    default: {
      const _e: never = platform;
      throw Object.assign(new Error(`Unsupported platform: ${_e}`), {
        status: 400,
      });
    }
  }

  if (!result) {
    throw Object.assign(
      new Error(
        `Could not resolve an avatar for ${platform}/@${normalizeUser(username)}. You can paste an image URL manually.`
      ),
      { status: 404 }
    );
  }

  return result;
}
