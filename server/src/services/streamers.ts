import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import { pool, query, withTransaction } from '../db.js';
import { normalizeTime } from '../validation.js';
import type {
  ScheduleInput,
  StreamerCreateInput,
  StreamerDetail,
  StreamerListItem,
  StreamerPlatform,
  StreamerPlatformInput,
  StreamerUpdateInput,
  StreamSchedule,
  Streamer,
} from '../types.js';

type StreamerRow = Streamer & RowDataPacket;
type PlatformRow = StreamerPlatform & RowDataPacket;
type ScheduleRow = StreamSchedule & RowDataPacket;

async function fetchPlatforms(
  streamerIds: number[],
  conn?: PoolConnection
): Promise<Map<number, StreamerPlatform[]>> {
  const map = new Map<number, StreamerPlatform[]>();
  if (streamerIds.length === 0) return map;

  const placeholders = streamerIds.map(() => '?').join(',');
  const sql = `SELECT * FROM streamer_platforms WHERE streamer_id IN (${placeholders}) ORDER BY is_primary DESC, platform ASC`;
  const executor = conn ?? pool;
  const [rows] = await executor.execute<PlatformRow[]>(sql, streamerIds);

  for (const row of rows) {
    const list = map.get(row.streamer_id) ?? [];
    list.push(row);
    map.set(row.streamer_id, list);
  }
  return map;
}

async function fetchSchedules(
  streamerIds: number[],
  conn?: PoolConnection
): Promise<Map<number, StreamSchedule[]>> {
  const map = new Map<number, StreamSchedule[]>();
  if (streamerIds.length === 0) return map;

  const placeholders = streamerIds.map(() => '?').join(',');
  const sql = `SELECT * FROM stream_schedules WHERE streamer_id IN (${placeholders}) ORDER BY day_of_week ASC`;
  const executor = conn ?? pool;
  const [rows] = await executor.execute<ScheduleRow[]>(sql, streamerIds);

  for (const row of rows) {
    const list = map.get(row.streamer_id) ?? [];
    list.push(normalizeScheduleRow(row));
    map.set(row.streamer_id, list);
  }
  return map;
}

function normalizeScheduleRow(row: StreamSchedule): StreamSchedule {
  return {
    ...row,
    start_time: String(row.start_time).slice(0, 8),
    end_time: String(row.end_time).slice(0, 8),
  };
}

/** Evaluate if "now" is inside any enabled schedule for the streamer's timezone. */
export function isScheduledNow(
  schedules: StreamSchedule[],
  timezone: string,
  now = new Date()
): boolean {
  const enabled = schedules.filter((s) => Boolean(s.enabled));
  if (enabled.length === 0) return false;

  let day: number;
  let minutes: number;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);

    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    const dayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    day = dayMap[weekday] ?? 0;
    minutes = hour * 60 + minute;
  } catch {
    day = now.getUTCDay();
    minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  }

  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  for (const s of enabled) {
    if (s.day_of_week !== day) continue;
    const start = toMinutes(String(s.start_time));
    const end = toMinutes(String(s.end_time));
    if (start < end) {
      if (minutes >= start && minutes < end) return true;
    } else {
      // Overnight window
      if (minutes >= start || minutes < end) return true;
    }
  }
  return false;
}

export async function listStreamers(): Promise<StreamerListItem[]> {
  const streamers = await query<StreamerRow>(
    'SELECT * FROM streamers ORDER BY sort_order ASC, id ASC'
  );
  const ids = streamers.map((s) => s.id);
  const [platforms, schedules] = await Promise.all([
    fetchPlatforms(ids),
    fetchSchedules(ids),
  ]);

  return streamers.map((s) => {
    const sched = schedules.get(s.id) ?? [];
    return {
      ...s,
      platforms: platforms.get(s.id) ?? [],
      schedules: sched,
      is_scheduled_now: isScheduledNow(sched, s.timezone),
    };
  });
}

export async function getStreamer(id: number): Promise<StreamerDetail | null> {
  const streamer = await query<StreamerRow>(
    'SELECT * FROM streamers WHERE id = ? LIMIT 1',
    [id]
  ).then((rows) => rows[0] ?? null);

  if (!streamer) return null;

  const [platforms, schedules] = await Promise.all([
    fetchPlatforms([id]),
    fetchSchedules([id]),
  ]);

  return {
    ...streamer,
    platforms: platforms.get(id) ?? [],
    schedules: schedules.get(id) ?? [],
  };
}

async function replacePlatforms(
  conn: PoolConnection,
  streamerId: number,
  platforms: StreamerPlatformInput[]
): Promise<void> {
  await conn.execute('DELETE FROM streamer_platforms WHERE streamer_id = ?', [
    streamerId,
  ]);

  for (const p of platforms) {
    await conn.execute(
      `INSERT INTO streamer_platforms (streamer_id, platform, username, external_id, is_primary)
       VALUES (?, ?, ?, ?, ?)`,
      [
        streamerId,
        p.platform,
        p.username.trim(),
        p.external_id ?? null,
        p.is_primary ? 1 : 0,
      ]
    );
  }
}

async function replaceSchedules(
  conn: PoolConnection,
  streamerId: number,
  schedules: ScheduleInput[]
): Promise<void> {
  await conn.execute('DELETE FROM stream_schedules WHERE streamer_id = ?', [
    streamerId,
  ]);

  for (const s of schedules) {
    await conn.execute(
      `INSERT INTO stream_schedules (streamer_id, day_of_week, start_time, end_time, enabled)
       VALUES (?, ?, ?, ?, ?)`,
      [
        streamerId,
        s.day_of_week,
        normalizeTime(s.start_time),
        normalizeTime(s.end_time),
        s.enabled === false ? 0 : 1,
      ]
    );
  }
}

export async function createStreamer(
  input: StreamerCreateInput
): Promise<StreamerDetail> {
  const id = await withTransaction(async (conn) => {
    const [maxRows] = await conn.execute<RowDataPacket[]>(
      'SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM streamers'
    );
    const nextOrder = Number((maxRows[0] as { max_order: number })?.max_order ?? 0) + 10;

    const [result] = await conn.execute<ResultSetHeader>(
      `INSERT INTO streamers (display_name, notes, timezone, avatar_url, sort_order) VALUES (?, ?, ?, ?, ?)`,
      [
        input.display_name.trim(),
        input.notes ?? null,
        input.timezone || 'UTC',
        input.avatar_url?.trim() || null,
        nextOrder,
      ]
    );
    const streamerId = result.insertId;
    await replacePlatforms(conn, streamerId, input.platforms);
    await replaceSchedules(conn, streamerId, input.schedules ?? []);
    return streamerId;
  });

  const created = await getStreamer(id);
  if (!created) throw new Error('Failed to load created streamer');
  return created;
}

export async function updateStreamer(
  id: number,
  input: StreamerUpdateInput
): Promise<StreamerDetail | null> {
  const existing = await getStreamer(id);
  if (!existing) return null;

  await withTransaction(async (conn) => {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (input.display_name !== undefined) {
      fields.push('display_name = ?');
      values.push(input.display_name.trim());
    }
    if (input.notes !== undefined) {
      fields.push('notes = ?');
      values.push(input.notes);
    }
    if (input.timezone !== undefined) {
      fields.push('timezone = ?');
      values.push(input.timezone);
    }
    if (input.avatar_url !== undefined) {
      fields.push('avatar_url = ?');
      values.push(input.avatar_url?.trim() || null);
    }

    if (fields.length > 0) {
      values.push(id);
      await conn.execute(
        `UPDATE streamers SET ${fields.join(', ')} WHERE id = ?`,
        values
      );
    }

    if (input.platforms) {
      await replacePlatforms(conn, id, input.platforms);
    }
    if (input.schedules) {
      await replaceSchedules(conn, id, input.schedules);
    }
  });

  return getStreamer(id);
}

export async function deleteStreamer(id: number): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    'DELETE FROM streamers WHERE id = ?',
    [id]
  );
  return result.affectedRows > 0;
}

/**
 * Persist custom card order. `ids` is the full ordered list of streamer ids.
 */
export async function reorderStreamers(ids: number[]): Promise<void> {
  if (ids.length === 0) return;

  await withTransaction(async (conn) => {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      await conn.execute(
        'UPDATE streamers SET sort_order = ? WHERE id = ?',
        [(i + 1) * 10, id]
      );
    }
  });
}
