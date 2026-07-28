import { z } from 'zod';
import { PLATFORMS } from './types.js';

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

export const platformInputSchema = z.object({
  platform: z.enum(PLATFORMS),
  username: z.string().trim().min(1).max(255),
  external_id: z.string().trim().max(255).nullable().optional(),
  is_primary: z.boolean().optional(),
});

export const scheduleInputSchema = z
  .object({
    day_of_week: z.number().int().min(0).max(6),
    start_time: z.string().regex(timeRegex, 'start_time must be HH:MM or HH:MM:SS'),
    end_time: z.string().regex(timeRegex, 'end_time must be HH:MM or HH:MM:SS'),
    enabled: z.boolean().optional(),
  })
  .refine(
    (s) => {
      const start = normalizeTime(s.start_time);
      const end = normalizeTime(s.end_time);
      // Allow overnight ranges (end < start) as valid "spans midnight"
      return start !== end;
    },
    { message: 'start_time and end_time must differ' }
  );

const avatarUrlSchema = z
  .union([z.string().trim().url().max(1024), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : v));

export const streamerCreateSchema = z.object({
  display_name: z.string().trim().min(1).max(128),
  notes: z.string().max(5000).nullable().optional(),
  timezone: z.string().trim().min(1).max(64).optional().default('UTC'),
  avatar_url: avatarUrlSchema,
  platforms: z.array(platformInputSchema).min(1, 'At least one platform is required'),
  schedules: z.array(scheduleInputSchema).optional().default([]),
});

export const streamerUpdateSchema = z.object({
  display_name: z.string().trim().min(1).max(128).optional(),
  notes: z.string().max(5000).nullable().optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  avatar_url: avatarUrlSchema,
  platforms: z.array(platformInputSchema).min(1).optional(),
  schedules: z.array(scheduleInputSchema).optional(),
});

export function normalizeTime(t: string): string {
  const parts = t.split(':');
  const h = parts[0]!.padStart(2, '0');
  const m = (parts[1] || '00').padStart(2, '0');
  const s = (parts[2] || '00').padStart(2, '0');
  return `${h}:${m}:${s}`;
}
