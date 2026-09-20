export const PLATFORMS = ['twitch', 'kick', 'youtube', 'rumble', 'x'] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface StreamerPlatform {
  id?: number;
  streamer_id?: number;
  platform: Platform;
  username: string;
  external_id?: string | null;
  is_primary?: boolean | number;
}

export interface StreamSchedule {
  id?: number;
  streamer_id?: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  enabled?: boolean | number;
}

export interface Streamer {
  id: number;
  display_name: string;
  notes: string | null;
  timezone: string;
  avatar_url?: string | null;
  sort_order?: number;
  created_at: string;
  updated_at: string;
  platforms: StreamerPlatform[];
  schedules: StreamSchedule[];
  is_scheduled_now?: boolean;
}

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
  /** YouTube live video id or Rumble embed id when resolved */
  videoId?: string | null;
  /** Rumble chat popup content id */
  chatId?: string | null;
}

export interface YouTubeLiveResolve {
  live: boolean;
  videoId: string | null;
  watchUrl: string | null;
  playerUrl: string | null;
  chatUrl: string | null;
  resolvedFrom: string | null;
  message?: string;
}

export interface RumbleLiveResolve {
  live: boolean;
  videoId: string | null;
  chatId: string | null;
  chatUrl: string | null;
  watchUrl: string | null;
  playerUrl: string | null;
  resolvedFrom: string | null;
  title?: string | null;
  message?: string;
}

export interface StreamerDetail extends Streamer {
  embeds: EmbedUrls[];
}

export interface StreamerFormData {
  display_name: string;
  notes: string;
  timezone: string;
  avatar_url: string;
  platforms: StreamerPlatform[];
  schedules: StreamSchedule[];
}

export interface AvatarResolveResult {
  url: string;
  platform: Platform;
  source: string;
}

export interface PlatformMeta {
  id: Platform;
  label: string;
  color: string;
  icon: string;
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const DAY_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const PLATFORM_COLORS: Record<Platform, string> = {
  twitch: '#9146FF',
  kick: '#53FC18',
  youtube: '#FF0000',
  rumble: '#85C742',
  x: '#E7E9EA',
};

export const PLATFORM_LABELS: Record<Platform, string> = {
  twitch: 'Twitch',
  kick: 'Kick',
  youtube: 'YouTube',
  rumble: 'Rumble',
  x: 'X',
};

/** Logged-in following / subscriptions page for each platform. */
export const PLATFORM_FOLLOW_PAGES: Record<
  Platform,
  { url: string; pageLabel: string }
> = {
  twitch: { url: 'https://www.twitch.tv/directory/following', pageLabel: 'Following' },
  kick: { url: 'https://kick.com/following', pageLabel: 'Following' },
  youtube: { url: 'https://www.youtube.com/feed/subscriptions', pageLabel: 'Subscriptions' },
  rumble: { url: 'https://rumble.com/subscriptions', pageLabel: 'Subscriptions' },
  x: { url: 'https://x.com/home', pageLabel: 'Following' },
};
