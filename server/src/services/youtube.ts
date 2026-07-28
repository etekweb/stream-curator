/**
 * Resolve a channel's current live video ID by following /live and parsing the page.
 * Unofficial (no API key). Can be flaky if YouTube changes HTML or rate-limits.
 */

export interface YouTubeLiveResolveResult {
  live: boolean;
  videoId: string | null;
  watchUrl: string | null;
  playerUrl: string | null;
  chatUrl: string | null;
  resolvedFrom: string | null;
  message?: string;
}

interface CacheEntry {
  expires: number;
  result: YouTubeLiveResolveResult;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000; // 1 minute
const FETCH_TIMEOUT_MS = 12_000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

function normalizeHandle(username: string): string {
  return username.replace(/^@/, '').trim();
}

function cacheKey(channelId?: string | null, username?: string | null): string {
  return `ch:${channelId || ''}|u:${username || ''}`;
}

function videoIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const v = u.searchParams.get('v');
    if (v && VIDEO_ID_RE.test(v)) return v;

    const liveMatch = u.pathname.match(/\/live\/([a-zA-Z0-9_-]{11})/);
    if (liveMatch?.[1]) return liveMatch[1];

    const embedMatch = u.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (embedMatch?.[1]) return embedMatch[1];

    const shortsMatch = u.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shortsMatch?.[1]) return shortsMatch[1];
  } catch {
    /* ignore */
  }
  return null;
}

function extractVideoIdsFromHtml(html: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /"videoId":"([a-zA-Z0-9_-]{11})"/g,
    /watch\?v=([a-zA-Z0-9_-]{11})/g,
    /\/embed\/([a-zA-Z0-9_-]{11})/g,
    /\/live\/([a-zA-Z0-9_-]{11})/g,
    /canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})"/g,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      if (m[1] && VIDEO_ID_RE.test(m[1])) found.add(m[1]);
    }
  }
  return [...found];
}

function pageLooksLive(html: string): boolean {
  if (pageClearlyOffline(html)) return false;

  // Strong live signals (YouTube HTML varies a lot by request / bot checks)
  if (/"isLiveNow"\s*:\s*true/.test(html)) return true;
  if (/"videoDetails"\s*:\s*\{[^}]{0,800}?"isLive"\s*:\s*true/.test(html)) return true;
  if (/"isLive"\s*:\s*true[^}]{0,400}?"videoDetails"/.test(html)) return true;
  // videoViewCountRenderer often has isLive + "watching now" even on sparse shells
  if (/"isLive"\s*:\s*true/.test(html) && /watching now/i.test(html)) return true;
  if (/"isLive"\s*:\s*true/.test(html) && /"videoPrimaryInfoRenderer"/.test(html)) {
    return true;
  }
  if (/liveStreamability/.test(html) && !/LIVE_STREAM_OFFLINE/.test(html)) return true;
  if (/"isLiveContent"\s*:\s*true/.test(html) && /"isLive"\s*:\s*true/.test(html)) {
    return true;
  }
  if (html.includes('hqdefault_live.jpg') || html.includes('LIVE_STREAMING')) return true;
  if (html.includes('BADGE_STYLE_TYPE_LIVE_NOW')) return true;
  // /live page with an OK playable player often means live even without isLiveNow
  if (
    /"playabilityStatus"\s*:\s*\{\s*"status"\s*:\s*"OK"/.test(html) &&
    /"videoDetails"\s*:\s*\{\s*"videoId"\s*:\s*"[a-zA-Z0-9_-]{11}"/.test(html) &&
    /"lengthSeconds"\s*:\s*"0"/.test(html)
  ) {
    return true;
  }
  return false;
}

function pageClearlyOffline(html: string): boolean {
  return (
    /"reason"\s*:\s*"This channel is not live"/.test(html) ||
    html.includes('LIVE_STREAM_OFFLINE') ||
    html.includes('is not currently live') ||
    html.includes("isn't live right now") ||
    html.includes('This live event has ended') ||
    /"status"\s*:\s*"LIVE_STREAM_OFFLINE"/.test(html)
  );
}

/** Prefer the actual live video id over related/sidebar video ids. */
function extractPrimaryLiveVideoId(html: string): string | null {
  const patterns = [
    /"videoDetails"\s*:\s*\{\s*"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/,
    /"liveStreamabilityRenderer"\s*:\s*\{\s*"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/,
    // Nested JSON: currentVideoEndpoint → watchEndpoint.videoId (bot shells use this)
    /"currentVideoEndpoint"[\s\S]{0,800}?"watchEndpoint"\s*:\s*\{\s*"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/,
    /"currentVideoEndpoint"[\s\S]{0,500}?"url"\s*:\s*"\/watch\?v=([a-zA-Z0-9_-]{11})"/,
    /"currentVideoEndpoint"[^}]{0,200}"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/,
    /"isLiveNow"\s*:\s*true[\s\S]{0,300}"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"/,
    /"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"[\s\S]{0,200}"isLiveNow"\s*:\s*true/,
    /"videoId"\s*:\s*"([a-zA-Z0-9_-]{11})"[^}]{0,120}"isLive"\s*:\s*true/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1] && VIDEO_ID_RE.test(m[1])) return m[1];
  }
  return null;
}

function buildResult(
  videoId: string | null,
  live: boolean,
  resolvedFrom: string | null,
  embedDomain: string,
  message?: string
): YouTubeLiveResolveResult {
  if (!videoId || !live) {
    return {
      live: false,
      videoId: null,
      watchUrl: null,
      playerUrl: null,
      chatUrl: null,
      resolvedFrom,
      message: message || (videoId ? 'Channel does not appear to be live' : 'No live stream found'),
    };
  }

  const domain = embedDomain.replace(/^https?:\/\//, '').split('/')[0] || 'localhost';
  return {
    live: true,
    videoId,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    playerUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1`,
    chatUrl: `https://www.youtube.com/live_chat?v=${encodeURIComponent(videoId)}&embed_domain=${encodeURIComponent(domain)}`,
    resolvedFrom,
    message: 'Live stream resolved',
  };
}

async function fetchLivePage(url: string): Promise<{ finalUrl: string; html: string; status: number }> {
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
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        // Reduce consent interstitial / sparse bot shells
        Cookie: 'CONSENT=YES+; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgLOWngY',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });
    const html = await res.text();
    return { finalUrl: res.url, html, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

async function tryUrl(
  url: string,
  embedDomain: string
): Promise<YouTubeLiveResolveResult | null> {
  try {
    const { finalUrl, html, status } = await fetchLivePage(url);
    if (status >= 400) {
      console.warn('[youtube] bad status', status, url);
      return null;
    }

    const fromFinal = videoIdFromUrl(finalUrl);
    const offline = pageClearlyOffline(html);
    const looksLive = pageLooksLive(html);
    const primaryId = extractPrimaryLiveVideoId(html);
    const ids = extractVideoIdsFromHtml(html);

    if (offline && !looksLive) {
      return buildResult(null, false, url, embedDomain, 'Channel is not live');
    }

    // Redirected straight to a watch URL while live
    if (fromFinal && finalUrl.includes('watch')) {
      if (looksLive || !offline) {
        return buildResult(fromFinal, true, url, embedDomain);
      }
    }

    const videoId = primaryId || fromFinal || (looksLive ? ids[0] : null) || null;
    if (videoId && (looksLive || primaryId)) {
      return buildResult(videoId, true, url, embedDomain);
    }

    // /live URL with a clear primary video id even when live flags are sparse
    if (primaryId && url.includes('/live')) {
      return buildResult(primaryId, true, url, embedDomain);
    }

    return null;
  } catch (err) {
    console.warn('[youtube] resolve failed for', url, err);
    return null;
  }
}

export async function resolveYouTubeLive(options: {
  channelId?: string | null;
  username?: string | null;
  embedDomain?: string;
  bypassCache?: boolean;
}): Promise<YouTubeLiveResolveResult> {
  const channelId = options.channelId?.trim() || null;
  const username = options.username ? normalizeHandle(options.username) : null;
  const embedDomain = options.embedDomain || 'localhost';

  if (!channelId && !username) {
    return buildResult(null, false, null, embedDomain, 'channelId or username is required');
  }

  const key = cacheKey(channelId, username) + `|d:${embedDomain}`;
  if (!options.bypassCache) {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) {
      return hit.result;
    }
  }

  const candidates: string[] = [];
  if (channelId) {
    candidates.push(`https://www.youtube.com/channel/${encodeURIComponent(channelId)}/live`);
  }
  if (username) {
    candidates.push(`https://www.youtube.com/@${encodeURIComponent(username)}/live`);
    candidates.push(`https://www.youtube.com/c/${encodeURIComponent(username)}/live`);
    candidates.push(`https://www.youtube.com/user/${encodeURIComponent(username)}/live`);
  }

  for (const url of candidates) {
    const result = await tryUrl(url, embedDomain);
    if (result?.live && result.videoId) {
      cache.set(key, { expires: Date.now() + CACHE_TTL_MS, result });
      return result;
    }
    // Explicit offline from a good candidate — stop early for channelId
    if (result && !result.live && result.message === 'Channel is not live' && channelId) {
      cache.set(key, { expires: Date.now() + CACHE_TTL_MS, result });
      return result;
    }
  }

  const offline = buildResult(
    null,
    false,
    candidates[0] || null,
    embedDomain,
    'No live stream found (offline or could not resolve)'
  );
  cache.set(key, { expires: Date.now() + Math.min(CACHE_TTL_MS, 30_000), result: offline });
  return offline;
}

export function youtubeEmbedsFromVideoId(
  videoId: string,
  embedDomain: string
): Pick<YouTubeLiveResolveResult, 'playerUrl' | 'chatUrl' | 'watchUrl'> {
  const domain = embedDomain.replace(/^https?:\/\//, '').split('/')[0] || 'localhost';
  return {
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    playerUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1`,
    chatUrl: `https://www.youtube.com/live_chat?v=${encodeURIComponent(videoId)}&embed_domain=${encodeURIComponent(domain)}`,
  };
}
