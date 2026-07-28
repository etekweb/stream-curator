export const PLATFORMS = ['twitch', 'kick', 'youtube', 'rumble', 'x'] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface Streamer {
  id: number;
  display_name: string;
  notes: string | null;
  timezone: string;
  avatar_url: string | null;
  sort_order: number;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface StreamerPlatform {
  id: number;
  streamer_id: number;
  platform: Platform;
  username: string;
  external_id: string | null;
  is_primary: number | boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface StreamSchedule {
  id: number;
  streamer_id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  enabled: number | boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface StreamerPlatformInput {
  platform: Platform;
  username: string;
  external_id?: string | null;
  is_primary?: boolean;
}

export interface ScheduleInput {
  day_of_week: number;
  start_time: string;
  end_time: string;
  enabled?: boolean;
}

export interface StreamerCreateInput {
  display_name: string;
  notes?: string | null;
  timezone?: string;
  avatar_url?: string | null;
  platforms: StreamerPlatformInput[];
  schedules?: ScheduleInput[];
}

export interface StreamerUpdateInput {
  display_name?: string;
  notes?: string | null;
  timezone?: string;
  avatar_url?: string | null;
  platforms?: StreamerPlatformInput[];
  schedules?: ScheduleInput[];
}

export interface StreamerDetail extends Streamer {
  platforms: StreamerPlatform[];
  schedules: StreamSchedule[];
}

export interface StreamerListItem extends Streamer {
  platforms: StreamerPlatform[];
  schedules: StreamSchedule[];
  /** True if current time falls in today's enabled schedule window (server-local evaluation uses streamer timezone when possible). */
  is_scheduled_now?: boolean;
}
