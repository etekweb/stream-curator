/**
 * Resolve a Rumble channel's current live stream and embed id.
 * Unofficial scrape of channel HTML + oEmbed (can break if Rumble changes markup).
 */

export interface RumbleLiveResolveResult {
  live: boolean;
  videoId: string | null;
  /** Numeric content id used by https://rumble.com/chat/popup/{chatId} */
  chatId: string | null;
  chatUrl: string | null;
  watchUrl: string | null;
  playerUrl: string | null;
  resolvedFrom: string | null;
  title?: string | null;
  message?: string;
}

interface CacheEntry {
  expires: number;
  result: RumbleLiveResolveResult;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 12_000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** Embed ids look like v7b4lgg or u3kt4.v1io41 */
const EMBED_ID_RE = /^[a-z0-9]+(?:\.[a-z0-9]+)?$/i;

function normalizeUsername(username: string): string {
  return username
    .trim()
    .replace(/^@/, '')
    .replace(/^\/+/, '')
    .replace(/^c\//i, '')
    .replace(/\/+$/, '');
}

function cacheKey(username: string): string {
  return `rumble:${username.toLowerCase()}`;
}

function chatPopupUrl(chatId: string | null | undefined): string | null {
  if (!chatId) return null;
  return `https://rumble.com/chat/popup/${encodeURIComponent(chatId)}`;
}

function offline(
  resolvedFrom: string | null,
  message: string
): RumbleLiveResolveResult {
  return {
    live: false,
    videoId: null,
    chatId: null,
    chatUrl: null,
    watchUrl: null,
    playerUrl: null,
    resolvedFrom,
    message,
  };
}

function liveResult(
  videoId: string,
  watchUrl: string,
  resolvedFrom: string,
  options: { title?: string | null; chatId?: string | null } = {}
): RumbleLiveResolveResult {
  const chatId = options.chatId ? String(options.chatId) : null;
  return {
    live: true,
    videoId,
    chatId,
    chatUrl: chatPopupUrl(chatId),
    watchUrl,
    playerUrl: `https://rumble.com/embed/${videoId}/`,
    resolvedFrom,
    title: options.title || null,
    message: 'Live stream resolved',
  };
}

async function fetchText(url: string): Promise<{ finalUrl: string; html: string; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      },
    });
    const html = await res.text();
    return { finalUrl: res.url, html, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

interface LiveCandidate {
  watchUrl: string;
  title?: string | null;
  /** Numeric content id for chat popup */
  chatId?: string | null;
}

function isLiveStreamUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  return (
    url.includes('live-hls') ||
    url.includes('live_hls') ||
    url.includes('/live-hls-dvr/') ||
    url.includes('livestream')
  );
}

/**
 * Channel pages embed <script type="application/json"> listing items.
 * Live streams use live-hls* playlist URLs.
 */
function extractLiveCandidatesFromHtml(html: string): LiveCandidate[] {
  const candidates: LiveCandidate[] = [];
  const scripts = [
    ...html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi),
  ];

  for (const match of scripts) {
    const raw = match[1]?.trim();
    if (!raw || !raw.includes('items')) continue;
    try {
      const data = JSON.parse(raw) as {
        items?: Array<{
          object_type?: string;
          id?: number | string;
          url?: string;
          relative_url?: string;
          title?: string;
          videos?: Array<{ url?: string; type?: string }>;
          is_live_stream?: boolean;
          is_live?: boolean;
          live?: boolean | { stream_id?: string };
          rumble_votes?: { content_id?: number | string };
        }>;
      };
      if (!Array.isArray(data.items)) continue;

      for (const item of data.items) {
        if (item.object_type && item.object_type !== 'video') continue;
        const streamUrls = (item.videos || []).map((v) => v.url || '');
        // Rumble often sets live:false even while live-hls playlists are present
        const liveFlag =
          item.is_live_stream === true ||
          item.is_live === true ||
          item.live === true ||
          (typeof item.live === 'object' && item.live !== null) ||
          Number((item as { watching_now?: number }).watching_now || 0) > 0 ||
          String((item as { livestream_status?: string }).livestream_status || '')
            .toLowerCase()
            .includes('live');
        const hasLiveHls = streamUrls.some(isLiveStreamUrl);
        const live = liveFlag || hasLiveHls;
        if (!live) continue;

        const watchUrl =
          item.url ||
          (item.relative_url
            ? item.relative_url.startsWith('http')
              ? item.relative_url
              : `https://rumble.com${item.relative_url}`
            : null);
        if (!watchUrl) continue;

        const rawChatId =
          item.id ?? item.rumble_votes?.content_id ?? null;
        const chatId =
          rawChatId !== null && rawChatId !== undefined
            ? String(rawChatId)
            : null;

        candidates.push({
          watchUrl,
          title: item.title || null,
          chatId,
        });
      }
    } catch {
      /* ignore bad JSON blocks */
    }
  }

  // Deduplicate by watch URL
  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (seen.has(c.watchUrl)) return false;
    seen.add(c.watchUrl);
    return true;
  });
}

function extractEmbedIdFromVideoPage(html: string): string | null {
  const playMatch = html.match(
    /Rumble\(\s*["']play["']\s*,\s*\{[^}]*["']video["']\s*:\s*["']([a-z0-9.]+)["']/i
  );
  if (playMatch?.[1] && EMBED_ID_RE.test(playMatch[1])) return playMatch[1];

  const videoField = html.match(/"video"\s*:\s*"([a-z0-9.]+)"/i);
  if (videoField?.[1] && EMBED_ID_RE.test(videoField[1])) return videoField[1];

  const embedPath = html.match(/rumble\.com\/embed\/([a-z0-9.]+)/i);
  if (embedPath?.[1] && EMBED_ID_RE.test(embedPath[1])) return embedPath[1];

  // log.view often contains the id without leading "v" sometimes with it
  const logView = html.match(/\/l\/view[./]*([a-z0-9]+)\./i);
  if (logView?.[1]) {
    const id = logView[1].startsWith('v') ? logView[1] : `v${logView[1]}`;
    if (EMBED_ID_RE.test(id)) return id;
  }

  return null;
}

function extractChatIdFromVideoPage(html: string): string | null {
  const popup = html.match(/chat\/popup\/(\d+)/i);
  if (popup?.[1]) return popup[1];
  const contentId = html.match(/"content_id"\s*:\s*(\d+)/);
  if (contentId?.[1]) return contentId[1];
  const idField = html.match(/"id"\s*:\s*(\d{6,})/);
  if (idField?.[1]) return idField[1];
  return null;
}

async function resolveEmbedId(watchUrl: string): Promise<{
  videoId: string | null;
  chatId?: string | null;
  title?: string | null;
}> {
  // oEmbed is the most reliable public way to get the iframe/embed id
  try {
    const oembedUrl = `https://rumble.com/api/Media/oembed.json?url=${encodeURIComponent(watchUrl)}`;
    const { html, status } = await fetchText(oembedUrl);
    if (status >= 200 && status < 300) {
      const data = JSON.parse(html) as { html?: string; title?: string };
      const m = data.html?.match(/src="https?:\/\/rumble\.com\/embed\/([a-z0-9.]+)\//i);
      if (m?.[1] && EMBED_ID_RE.test(m[1])) {
        return { videoId: m[1], title: data.title || null };
      }
    }
  } catch (err) {
    console.warn('[rumble] oembed failed', watchUrl, err);
  }

  try {
    const { html, status } = await fetchText(watchUrl);
    if (status >= 200 && status < 300) {
      const videoId = extractEmbedIdFromVideoPage(html);
      const chatId = extractChatIdFromVideoPage(html);
      return { videoId, chatId, title: null };
    }
  } catch (err) {
    console.warn('[rumble] video page scrape failed', watchUrl, err);
  }

  return { videoId: null };
}

function isCloudflareChallenge(status: number, html: string): boolean {
  if (status === 403 || status === 503) {
    if (/just a moment/i.test(html) || /cf-browser-verification/i.test(html)) {
      return true;
    }
    if (/cloudflare/i.test(html) && html.length < 20_000) return true;
  }
  return /just a moment/i.test(html) && html.length < 20_000;
}

export async function resolveRumbleLive(options: {
  username: string;
  bypassCache?: boolean;
}): Promise<RumbleLiveResolveResult> {
  const username = normalizeUsername(options.username || '');
  if (!username) {
    return offline(null, 'username is required');
  }

  const key = cacheKey(username);
  if (!options.bypassCache) {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.result;
  }

  const pages = [
    `https://rumble.com/c/${encodeURIComponent(username)}/livestreams`,
    `https://rumble.com/c/${encodeURIComponent(username)}`,
  ];

  let lastFrom: string | null = null;
  let blockedByCloudflare = false;

  for (const pageUrl of pages) {
    lastFrom = pageUrl;
    try {
      const { html, status } = await fetchText(pageUrl);
      if (isCloudflareChallenge(status, html)) {
        blockedByCloudflare = true;
        console.warn(
          '[rumble] Cloudflare challenge (often VPN/system.slice routing).',
          pageUrl,
          'status',
          status
        );
        continue;
      }
      if (status >= 400) {
        console.warn('[rumble] bad status', status, pageUrl);
        continue;
      }

      const candidates = extractLiveCandidatesFromHtml(html);
      console.warn(
        '[rumble] page',
        pageUrl,
        'status',
        status,
        'candidates',
        candidates.length,
        'html',
        html.length
      );

      for (const candidate of candidates) {
        const resolved = await resolveEmbedId(candidate.watchUrl);
        if (resolved.videoId) {
          const result = liveResult(resolved.videoId, candidate.watchUrl, pageUrl, {
            title: resolved.title || candidate.title,
            chatId: candidate.chatId || resolved.chatId || null,
          });
          cache.set(key, { expires: Date.now() + CACHE_TTL_MS, result });
          return result;
        }
        // oEmbed can fail; fall back to scraping the video page only already inside resolveEmbedId
      }

      // Don't hard-stop on the main channel page if livestreams had candidates we failed to embed
      if (candidates.length === 0 && pageUrl.endsWith('/livestreams')) {
        continue;
      }
    } catch (err) {
      console.warn('[rumble] channel page failed', pageUrl, err);
    }
  }

  const message = blockedByCloudflare
    ? 'Rumble blocked the request (Cloudflare). If this app runs under system Supervisor while ProtonVPN split-tunnel is on, run it as a user service instead — see deploy/systemd-user/.'
    : 'No live stream found (offline or could not resolve)';
  const result = offline(lastFrom, message);
  cache.set(key, { expires: Date.now() + Math.min(CACHE_TTL_MS, 30_000), result });
  return result;
}
