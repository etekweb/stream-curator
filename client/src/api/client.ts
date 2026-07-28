import type {
  Streamer,
  StreamerDetail,
  StreamerFormData,
  PlatformMeta,
  YouTubeLiveResolve,
  RumbleLiveResolve,
  AvatarResolveResult,
  Platform,
} from '../types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    ...options,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body as T;
}

export async function fetchStreamers(): Promise<Streamer[]> {
  const { data } = await request<{ data: Streamer[] }>('/api/streamers');
  return data;
}

export async function fetchStreamer(id: number): Promise<StreamerDetail> {
  const parent = window.location.hostname;
  const { data } = await request<{ data: StreamerDetail }>(
    `/api/streamers/${id}?parent=${encodeURIComponent(parent)}`
  );
  return data;
}

export async function createStreamer(payload: StreamerFormData): Promise<Streamer> {
  const body = {
    display_name: payload.display_name,
    notes: payload.notes || null,
    timezone: payload.timezone || 'UTC',
    avatar_url: payload.avatar_url?.trim() || null,
    platforms: payload.platforms.map((p) => ({
      platform: p.platform,
      username: p.username,
      external_id: p.external_id || null,
      is_primary: Boolean(p.is_primary),
    })),
    schedules: payload.schedules
      .filter((s) => s.enabled !== false && s.enabled !== 0)
      .map((s) => ({
        day_of_week: s.day_of_week,
        start_time: normalizeTime(s.start_time),
        end_time: normalizeTime(s.end_time),
        enabled: true,
      })),
  };
  const { data } = await request<{ data: Streamer }>('/api/streamers', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return data;
}

export async function updateStreamer(
  id: number,
  payload: StreamerFormData
): Promise<Streamer> {
  const body = {
    display_name: payload.display_name,
    notes: payload.notes || null,
    timezone: payload.timezone || 'UTC',
    avatar_url: payload.avatar_url?.trim() || null,
    platforms: payload.platforms.map((p) => ({
      platform: p.platform,
      username: p.username,
      external_id: p.external_id || null,
      is_primary: Boolean(p.is_primary),
    })),
    schedules: payload.schedules.map((s) => ({
      day_of_week: s.day_of_week,
      start_time: normalizeTime(s.start_time),
      end_time: normalizeTime(s.end_time),
      enabled: s.enabled !== false && s.enabled !== 0,
    })),
  };
  const { data } = await request<{ data: Streamer }>(`/api/streamers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return data;
}

export async function deleteStreamer(id: number): Promise<void> {
  await request<void>(`/api/streamers/${id}`, { method: 'DELETE' });
}

export async function reorderStreamers(ids: number[]): Promise<Streamer[]> {
  const { data } = await request<{ data: Streamer[] }>('/api/streamers/reorder', {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  });
  return data;
}

export async function resolveAvatar(options: {
  platform: Platform;
  username: string;
  external_id?: string | null;
}): Promise<AvatarResolveResult> {
  const { data } = await request<{ data: AvatarResolveResult }>('/api/avatars/resolve', {
    method: 'POST',
    body: JSON.stringify({
      platform: options.platform,
      username: options.username,
      external_id: options.external_id || null,
    }),
  });
  return data;
}

export async function fetchPlatforms(): Promise<PlatformMeta[]> {
  const { data } = await request<{ data: PlatformMeta[] }>('/api/platforms');
  return data;
}

export async function resolveYouTubeLive(options: {
  username?: string | null;
  channelId?: string | null;
  refresh?: boolean;
}): Promise<YouTubeLiveResolve> {
  const params = new URLSearchParams();
  if (options.username) params.set('username', options.username);
  if (options.channelId) params.set('channelId', options.channelId);
  params.set('embedDomain', window.location.hostname);
  params.set('parent', window.location.hostname);
  if (options.refresh) params.set('refresh', '1');

  const { data } = await request<{ data: YouTubeLiveResolve }>(
    `/api/youtube/resolve-live?${params.toString()}`
  );
  return data;
}

export async function resolveRumbleLive(options: {
  username: string;
  refresh?: boolean;
}): Promise<RumbleLiveResolve> {
  const params = new URLSearchParams();
  params.set('username', options.username);
  if (options.refresh) params.set('refresh', '1');

  const { data } = await request<{ data: RumbleLiveResolve }>(
    `/api/rumble/resolve-live?${params.toString()}`
  );
  return data;
}

function normalizeTime(t: string): string {
  if (!t) return '00:00:00';
  const parts = t.split(':');
  const h = (parts[0] || '00').padStart(2, '0');
  const m = (parts[1] || '00').padStart(2, '0');
  const s = (parts[2] || '00').padStart(2, '0');
  return `${h}:${m}:${s}`;
}
