import type { StreamSchedule } from '../types';
import { DAY_LABELS } from '../types';

/** Display timezone for cards and dual schedule view */
export const EASTERN_TZ = 'America/New_York';

export function emptyWeekSchedule(
  defaultStart = '18:00',
  defaultEnd = '22:00'
): StreamSchedule[] {
  return DAY_LABELS.map((_, day) => ({
    day_of_week: day,
    start_time: defaultStart,
    end_time: defaultEnd,
    enabled: false,
  }));
}

export function mergeSchedules(existing: StreamSchedule[]): StreamSchedule[] {
  const base = emptyWeekSchedule();
  for (const s of existing) {
    const idx = s.day_of_week;
    if (idx >= 0 && idx <= 6) {
      base[idx] = {
        day_of_week: idx,
        start_time: String(s.start_time).slice(0, 5),
        end_time: String(s.end_time).slice(0, 5),
        enabled: s.enabled !== false && s.enabled !== 0,
      };
    }
  }
  return base;
}

export function formatTime12h(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const hour = h ?? 0;
  const min = m ?? 0;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
}

export function formatTimeRange(start: string, end: string): string {
  return `${formatTime12h(start)} – ${formatTime12h(end)}`;
}

function parseHm(t: string): { hour: number; minute: number } {
  const [h, m] = String(t).slice(0, 5).split(':').map(Number);
  return { hour: h || 0, minute: m || 0 };
}

function getPartsInZone(
  date: Date,
  timeZone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: dayMap[get('weekday')] ?? 0,
  };
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC Date.
 * Iteratively corrects for the zone offset (handles DST).
 */
export function wallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i++) {
    const p = getPartsInZone(new Date(utcMs), timeZone);
    const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
    utcMs += desired - asIfUtc;
  }
  return new Date(utcMs);
}

/** Calendar Y-M-D + weekday for "today" in a timezone. */
function todayInZone(timeZone: string, now = new Date()) {
  return getPartsInZone(now, timeZone);
}

/**
 * Find the calendar date (in source TZ) for the next/this week's occurrence
 * of dayOfWeek (0=Sun), relative to "today" in that zone.
 */
function calendarDateForWeekday(
  dayOfWeek: number,
  timeZone: string,
  now = new Date()
): { year: number; month: number; day: number } {
  const today = todayInZone(timeZone, now);
  const delta = (dayOfWeek - today.weekday + 7) % 7;
  // Build from today + delta days using a UTC noon walk to avoid edge issues
  const baseUtc = wallTimeToUtc(today.year, today.month, today.day, 12, 0, timeZone);
  const target = new Date(baseUtc.getTime() + delta * 24 * 60 * 60 * 1000);
  const p = getPartsInZone(target, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

export interface ConvertedInstant {
  dayOfWeek: number;
  dayLabel: string;
  time: string; // HH:MM 24h wall in target zone
  timeLabel: string; // 12h
}

/** Convert one wall time from sourceTz into targetTz (using this week's weekday). */
export function convertScheduleInstant(
  dayOfWeek: number,
  time: string,
  sourceTz: string,
  targetTz: string,
  now = new Date()
): ConvertedInstant {
  const { hour, minute } = parseHm(time);
  const srcDate = calendarDateForWeekday(dayOfWeek, sourceTz || 'UTC', now);
  const utc = wallTimeToUtc(
    srcDate.year,
    srcDate.month,
    srcDate.day,
    hour,
    minute,
    sourceTz || 'UTC'
  );
  const dest = getPartsInZone(utc, targetTz);
  const hm = `${String(dest.hour).padStart(2, '0')}:${String(dest.minute).padStart(2, '0')}`;
  return {
    dayOfWeek: dest.weekday,
    dayLabel: DAY_LABELS[dest.weekday] ?? '?',
    time: hm,
    timeLabel: formatTime12h(hm),
  };
}

export interface ConvertedRange {
  /** Day label for the start instant in the target zone */
  dayLabel: string;
  dayOfWeek: number;
  startLabel: string;
  endLabel: string;
  /** True if end day differs from start day in target zone */
  crossesDay: boolean;
  endDayLabel?: string;
  rangeLabel: string;
}

export function convertScheduleRange(
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  sourceTz: string,
  targetTz: string,
  now = new Date()
): ConvertedRange {
  const start = convertScheduleInstant(dayOfWeek, startTime, sourceTz, targetTz, now);
  // End may be same calendar day or next day in source (overnight stream)
  const startHm = parseHm(startTime);
  const endHm = parseHm(endTime);
  const endMinutes = endHm.hour * 60 + endHm.minute;
  const startMinutes = startHm.hour * 60 + startHm.minute;
  const overnight = endMinutes <= startMinutes;

  let endDay = dayOfWeek;
  if (overnight) {
    endDay = (dayOfWeek + 1) % 7;
  }
  const end = convertScheduleInstant(endDay, endTime, sourceTz, targetTz, now);
  const crossesDay = end.dayOfWeek !== start.dayOfWeek;

  const rangeLabel = crossesDay
    ? `${start.timeLabel} – ${end.dayLabel} ${end.timeLabel}`
    : `${start.timeLabel} – ${end.timeLabel}`;

  return {
    dayLabel: start.dayLabel,
    dayOfWeek: start.dayOfWeek,
    startLabel: start.timeLabel,
    endLabel: end.timeLabel,
    crossesDay,
    endDayLabel: crossesDay ? end.dayLabel : undefined,
    rangeLabel,
  };
}

function timeToMinutes(hm: string): number {
  const { hour, minute } = parseHm(hm);
  return hour * 60 + minute;
}

interface CardSlot {
  /** Minutes from Sunday 00:00 ET for the start (0..7*24*60) */
  startWeekMin: number;
  endWeekMin: number;
  label: string;
}

function buildCardSlots(
  schedules: StreamSchedule[],
  sourceTimezone: string,
  now: Date
): CardSlot[] {
  const tz = sourceTimezone || 'UTC';
  const active = schedules.filter((s) => s.enabled !== false && s.enabled !== 0);
  const slots: CardSlot[] = [];

  for (const s of active) {
    const start = String(s.start_time).slice(0, 5);
    const end = String(s.end_time).slice(0, 5);
    const c = convertScheduleRange(s.day_of_week, start, end, tz, EASTERN_TZ, now);

    const startHm = parseHm(start);
    const endHm = parseHm(end);
    const overnightSrc =
      endHm.hour * 60 + endHm.minute <= startHm.hour * 60 + startHm.minute;
    const endSrcDay = overnightSrc ? (s.day_of_week + 1) % 7 : s.day_of_week;

    const startInst = convertScheduleInstant(s.day_of_week, start, tz, EASTERN_TZ, now);
    const endInst = convertScheduleInstant(endSrcDay, end, tz, EASTERN_TZ, now);

    let startWeekMin = startInst.dayOfWeek * 24 * 60 + timeToMinutes(startInst.time);
    let endWeekMin = endInst.dayOfWeek * 24 * 60 + timeToMinutes(endInst.time);
    if (endWeekMin <= startWeekMin) {
      endWeekMin += 7 * 24 * 60; // crosses week boundary in ET
    }

    slots.push({
      startWeekMin,
      endWeekMin,
      label: `${c.dayLabel} ${c.rangeLabel}`,
    });
  }

  return slots;
}

/**
 * Card summary (always Eastern Time):
 * - If currently in a window (incl. overnight from previous day), show that
 * - Else if a stream starts later today (ET), show that
 * - Else show the next upcoming stream this week
 */
export function scheduleSummaryEastern(
  schedules: StreamSchedule[],
  sourceTimezone: string,
  now = new Date()
): string {
  const active = schedules.filter((s) => s.enabled !== false && s.enabled !== 0);
  if (active.length === 0) return 'No schedule set';

  const nowEt = getPartsInZone(now, EASTERN_TZ);
  const nowWeekMin =
    nowEt.weekday * 24 * 60 + nowEt.hour * 60 + nowEt.minute;
  const weekLen = 7 * 24 * 60;
  const todayStart = nowEt.weekday * 24 * 60;
  const todayEnd = todayStart + 24 * 60;

  const slots = buildCardSlots(schedules, sourceTimezone, now);

  // Expand each slot to previous week copy so overnight Sun→Mon works near week edges
  const expanded = slots.flatMap((s) => [
    s,
    {
      ...s,
      startWeekMin: s.startWeekMin - weekLen,
      endWeekMin: s.endWeekMin - weekLen,
    },
    {
      ...s,
      startWeekMin: s.startWeekMin + weekLen,
      endWeekMin: s.endWeekMin + weekLen,
    },
  ]);

  // 1) Currently in range (overnight from yesterday counts)
  const inRange = expanded
    .filter((s) => nowWeekMin >= s.startWeekMin && nowWeekMin < s.endWeekMin)
    .sort((a, b) => a.startWeekMin - b.startWeekMin)[0];
  if (inRange) return inRange.label;

  // 2) Later today (starts on this ET calendar day, still upcoming)
  const laterToday = expanded
    .filter(
      (s) =>
        s.startWeekMin >= nowWeekMin &&
        s.startWeekMin >= todayStart &&
        s.startWeekMin < todayEnd
    )
    .sort((a, b) => a.startWeekMin - b.startWeekMin)[0];
  if (laterToday) return laterToday.label;

  // 3) Next stream (any day, wrap to next week if needed)
  const next = expanded
    .filter((s) => s.startWeekMin >= nowWeekMin)
    .sort((a, b) => a.startWeekMin - b.startWeekMin)[0];
  if (next) return next.label;

  return slots.sort((a, b) => a.startWeekMin - b.startWeekMin)[0]?.label ?? 'No schedule set';
}

export interface DualScheduleRow {
  dayOfWeek: number;
  /** Streamer-local day label (as stored / start day) */
  streamerDayLabel: string;
  streamerRange: string;
  streamerCrossesDay: boolean;
  /** Eastern day + range */
  easternDayLabel: string;
  easternRange: string;
  easternCrossesDay: boolean;
}

export function dualScheduleRows(
  schedules: StreamSchedule[],
  sourceTimezone: string
): DualScheduleRow[] {
  const tz = sourceTimezone || 'UTC';
  return [...schedules]
    .filter((s) => s.enabled !== false && s.enabled !== 0)
    .sort((a, b) => a.day_of_week - b.day_of_week)
    .map((s) => {
      const start = String(s.start_time).slice(0, 5);
      const end = String(s.end_time).slice(0, 5);
      // Same overnight formatting as ET: include end day when range crosses midnight
      const streamer = convertScheduleRange(s.day_of_week, start, end, tz, tz);
      const et = convertScheduleRange(s.day_of_week, start, end, tz, EASTERN_TZ);
      return {
        dayOfWeek: s.day_of_week,
        streamerDayLabel: streamer.dayLabel,
        streamerRange: streamer.rangeLabel,
        streamerCrossesDay: streamer.crossesDay,
        easternDayLabel: et.dayLabel,
        easternRange: et.rangeLabel,
        easternCrossesDay: et.crossesDay,
      };
    });
}

/** @deprecated Prefer scheduleSummaryEastern for display */
export function scheduleSummary(schedules: StreamSchedule[]): string {
  const active = schedules.filter((s) => s.enabled !== false && s.enabled !== 0);
  if (active.length === 0) return 'No schedule set';
  return active
    .map(
      (s) =>
        `${DAY_LABELS[s.day_of_week]} ${formatTimeRange(String(s.start_time).slice(0, 5), String(s.end_time).slice(0, 5))}`
    )
    .join(' · ');
}

/**
 * Absolute next start of a recurring weekday+time slot in the streamer's timezone.
 */
function nextOccurrenceStart(
  dayOfWeek: number,
  time: string,
  sourceTimezone: string,
  now: Date
): Date {
  const tz = sourceTimezone || 'UTC';
  const { hour, minute } = parseHm(time);
  const cal = calendarDateForWeekday(dayOfWeek, tz, now);
  let start = wallTimeToUtc(cal.year, cal.month, cal.day, hour, minute, tz);
  if (start.getTime() <= now.getTime()) {
    // Same weekday next week (recompute from now+7d for DST safety)
    const laterRef = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const cal2 = calendarDateForWeekday(dayOfWeek, tz, laterRef);
    start = wallTimeToUtc(cal2.year, cal2.month, cal2.day, hour, minute, tz);
  }
  return start;
}

/** Next stream start after `now`, or null if no enabled schedule. */
export function findNextStreamStart(
  schedules: StreamSchedule[],
  sourceTimezone: string,
  now = new Date()
): Date | null {
  const active = schedules.filter((s) => s.enabled !== false && s.enabled !== 0);
  if (active.length === 0) return null;

  let best: Date | null = null;
  for (const s of active) {
    const start = nextOccurrenceStart(
      s.day_of_week,
      String(s.start_time).slice(0, 5),
      sourceTimezone,
      now
    );
    if (!best || start.getTime() < best.getTime()) {
      best = start;
    }
  }
  return best;
}

function ymdKeyInZone(date: Date, timeZone: string): string {
  const p = getPartsInZone(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function startOfDayInZone(date: Date, timeZone: string): Date {
  const p = getPartsInZone(date, timeZone);
  return wallTimeToUtc(p.year, p.month, p.day, 0, 0, timeZone);
}

/**
 * Plain-English relative label for the next scheduled start, using the
 * **viewer's local timezone** for "today" / "tomorrow" / hour counts.
 * Returns null when there is no upcoming schedule.
 */
export function nextStreamRelativeLabel(
  schedules: StreamSchedule[],
  sourceTimezone: string,
  now = new Date(),
  viewerTimezone?: string
): string | null {
  const next = findNextStreamStart(schedules, sourceTimezone, now);
  if (!next) return null;

  const viewerTz =
    viewerTimezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'UTC';

  const ms = next.getTime() - now.getTime();
  if (ms <= 0) return 'Scheduled soon';

  const minutes = Math.round(ms / 60_000);
  const hours = Math.round(ms / 3_600_000);

  const todayKey = ymdKeyInZone(now, viewerTz);
  const nextKey = ymdKeyInZone(next, viewerTz);
  const tomorrowStart = new Date(
    startOfDayInZone(now, viewerTz).getTime() + 24 * 60 * 60 * 1000
  );
  const tomorrowKey = ymdKeyInZone(tomorrowStart, viewerTz);

  if (minutes < 1) return 'Scheduled soon';
  if (minutes < 60) {
    return minutes === 1
      ? 'Scheduled in 1 minute'
      : `Scheduled in ${minutes} minutes`;
  }
  if (hours < 24 && nextKey === todayKey) {
    return hours <= 1
      ? 'Scheduled in 1 hour'
      : `Scheduled in ${hours} hours`;
  }
  // Cross-midnight but still within ~24h and calendar tomorrow
  if (nextKey === tomorrowKey) {
    return 'Scheduled tomorrow';
  }
  if (hours < 24) {
    return hours <= 1
      ? 'Scheduled in 1 hour'
      : `Scheduled in ${hours} hours`;
  }

  const days = Math.round(
    (startOfDayInZone(next, viewerTz).getTime() -
      startOfDayInZone(now, viewerTz).getTime()) /
      (24 * 60 * 60 * 1000)
  );

  if (days === 1) return 'Scheduled tomorrow';
  if (days > 1 && days < 7) {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: viewerTz,
      weekday: 'long',
    }).format(next);
    return `Scheduled ${weekday}`;
  }
  if (days >= 7 && days < 14) {
    return `Scheduled in ${days} days`;
  }

  const dateLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: viewerTz,
    month: 'short',
    day: 'numeric',
  }).format(next);
  return `Scheduled ${dateLabel}`;
}

/** Browser / viewer IANA timezone. */
export function getViewerTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * Calendar date for dayOfWeek (0=Sun) in the same Sunday-based week as `now`
 * in `timeZone` (may be in the past earlier this week).
 */
function calendarDateInCurrentWeek(
  dayOfWeek: number,
  timeZone: string,
  now = new Date()
): { year: number; month: number; day: number } {
  const today = todayInZone(timeZone, now);
  const delta = dayOfWeek - today.weekday;
  const baseUtc = wallTimeToUtc(today.year, today.month, today.day, 12, 0, timeZone);
  const target = new Date(baseUtc.getTime() + delta * 24 * 60 * 60 * 1000);
  const p = getPartsInZone(target, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

/** Convert one wall time using the current Sunday-based week in sourceTz. */
function convertScheduleInstantInWeek(
  dayOfWeek: number,
  time: string,
  sourceTz: string,
  targetTz: string,
  now = new Date()
): ConvertedInstant {
  const { hour, minute } = parseHm(time);
  const srcDate = calendarDateInCurrentWeek(dayOfWeek, sourceTz || 'UTC', now);
  const utc = wallTimeToUtc(
    srcDate.year,
    srcDate.month,
    srcDate.day,
    hour,
    minute,
    sourceTz || 'UTC'
  );
  const dest = getPartsInZone(utc, targetTz);
  const hm = `${String(dest.hour).padStart(2, '0')}:${String(dest.minute).padStart(2, '0')}`;
  return {
    dayOfWeek: dest.weekday,
    dayLabel: DAY_LABELS[dest.weekday] ?? '?',
    time: hm,
    timeLabel: formatTime12h(hm),
  };
}

function convertScheduleRangeInWeek(
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  sourceTz: string,
  targetTz: string,
  now = new Date()
): ConvertedRange {
  const start = convertScheduleInstantInWeek(
    dayOfWeek,
    startTime,
    sourceTz,
    targetTz,
    now
  );
  const startHm = parseHm(startTime);
  const endHm = parseHm(endTime);
  const overnight =
    endHm.hour * 60 + endHm.minute <= startHm.hour * 60 + startHm.minute;
  const endDay = overnight ? (dayOfWeek + 1) % 7 : dayOfWeek;
  const end = convertScheduleInstantInWeek(
    endDay,
    endTime,
    sourceTz,
    targetTz,
    now
  );
  const crossesDay = end.dayOfWeek !== start.dayOfWeek;
  const rangeLabel = crossesDay
    ? `${start.timeLabel} – ${end.dayLabel} ${end.timeLabel}`
    : `${start.timeLabel} – ${end.timeLabel}`;

  return {
    dayLabel: start.dayLabel,
    dayOfWeek: start.dayOfWeek,
    startLabel: start.timeLabel,
    endLabel: end.timeLabel,
    crossesDay,
    endDayLabel: crossesDay ? end.dayLabel : undefined,
    rangeLabel,
  };
}

export interface WeekDayHeader {
  dayOfWeek: number;
  dayLabel: string;
  dateLabel: string;
  isToday: boolean;
  year: number;
  month: number;
  day: number;
}

/** Sun–Sat headers for the current week in the viewer timezone. */
export function weekDayHeaders(
  viewerTimezone?: string,
  now = new Date()
): WeekDayHeader[] {
  const tz = viewerTimezone || getViewerTimezone();
  const today = todayInZone(tz, now);
  return DAY_LABELS.map((dayLabel, dayOfWeek) => {
    const cal = calendarDateInCurrentWeek(dayOfWeek, tz, now);
    const isToday =
      cal.year === today.year &&
      cal.month === today.month &&
      cal.day === today.day;
    const dateLabel = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      month: 'short',
      day: 'numeric',
    }).format(wallTimeToUtc(cal.year, cal.month, cal.day, 12, 0, tz));
    return {
      dayOfWeek,
      dayLabel,
      dateLabel,
      isToday,
      year: cal.year,
      month: cal.month,
      day: cal.day,
    };
  });
}

export interface WeekScheduleBlock {
  key: string;
  streamerId: number;
  displayName: string;
  avatarUrl?: string | null;
  isScheduledNow: boolean;
  /** Start day of week in viewer TZ (0=Sun) */
  dayOfWeek: number;
  /** Minutes from midnight (viewer TZ) at start */
  startMinutes: number;
  /** Minutes from midnight (viewer TZ) at end; may exceed 1440 if overnight */
  endMinutes: number;
  startLabel: string;
  endLabel: string;
  rangeLabel: string;
  crossesDay: boolean;
  endDayLabel?: string;
  /** Stable color index for multi-streamer display */
  colorIndex: number;
  /**
   * Horizontal lane within overlapping peers on the same day (0-based).
   * Assigned by `layoutDayBlocks`.
   */
  col?: number;
  /** How many lanes this block spans (usually 1; expands into free space) */
  colSpan?: number;
  /** Total concurrent lanes in this overlap cluster */
  colCount?: number;
  /** How many other blocks overlap this one in time (same day) */
  overlapCount?: number;
}

function intervalsOverlap(
  a: { startMinutes: number; endMinutes: number },
  b: { startMinutes: number; endMinutes: number }
): boolean {
  return a.startMinutes < b.endMinutes && a.endMinutes > b.startMinutes;
}

/**
 * Pack blocks that share a day into side-by-side columns (calendar-style).
 * Mutates and returns the same array with `col`, `colSpan`, `colCount`, and `overlapCount`.
 *
 * Algorithm:
 * 1. Sort by start, then longer duration first
 * 2. Cluster connected components of overlapping intervals
 * 3. Greedy column assignment within each cluster
 * 4. Expand each event rightward into free columns (wider when peers don't overlap)
 */
export function layoutDayBlocks(
  dayBlocks: WeekScheduleBlock[]
): WeekScheduleBlock[] {
  if (dayBlocks.length === 0) return dayBlocks;

  const sorted = [...dayBlocks].sort((a, b) => {
    if (a.startMinutes !== b.startMinutes) {
      return a.startMinutes - b.startMinutes;
    }
    // Longer first → more stable packing for nested ranges
    const da = a.endMinutes - a.startMinutes;
    const db = b.endMinutes - b.startMinutes;
    if (da !== db) return db - da;
    return a.displayName.localeCompare(b.displayName);
  });

  // overlapCount: peers that strictly overlap in time
  for (const b of sorted) {
    let n = 0;
    for (const o of sorted) {
      if (o === b) continue;
      if (intervalsOverlap(o, b)) n++;
    }
    b.overlapCount = n;
  }

  // Connected clusters: walk sorted and expand while any active event overlaps next
  type Cluster = WeekScheduleBlock[];
  const clusters: Cluster[] = [];
  let cluster: Cluster = [];
  let clusterEnd = -1;

  for (const b of sorted) {
    if (cluster.length === 0 || b.startMinutes < clusterEnd) {
      cluster.push(b);
      clusterEnd = Math.max(clusterEnd, b.endMinutes);
    } else {
      clusters.push(cluster);
      cluster = [b];
      clusterEnd = b.endMinutes;
    }
  }
  if (cluster.length) clusters.push(cluster);

  for (const group of clusters) {
    // columnEnds[i] = end minute of last event placed in column i
    const columnEnds: number[] = [];
    const colOf = new Map<WeekScheduleBlock, number>();

    for (const b of group) {
      let placed = -1;
      for (let c = 0; c < columnEnds.length; c++) {
        if (columnEnds[c]! <= b.startMinutes) {
          placed = c;
          break;
        }
      }
      if (placed < 0) {
        placed = columnEnds.length;
        columnEnds.push(b.endMinutes);
      } else {
        columnEnds[placed] = b.endMinutes;
      }
      colOf.set(b, placed);
      b.col = placed;
    }

    const colCount = Math.max(1, columnEnds.length);

    // Expand each event rightward into free columns only (left-fixed avoids
    // two non-overlapping events both claiming the same horizontal space).
    for (const b of group) {
      const col = colOf.get(b) ?? 0;
      let span = 1;

      for (let c = col + 1; c < colCount; c++) {
        const blocked = group.some(
          (o) => o !== b && (colOf.get(o) ?? 0) === c && intervalsOverlap(o, b)
        );
        if (blocked) break;
        span++;
      }

      b.col = col;
      b.colSpan = span;
      b.colCount = colCount;
    }
  }

  return sorted;
}

/** Layout every day of the week independently. */
export function layoutWeekBlocks(
  blocks: WeekScheduleBlock[]
): WeekScheduleBlock[] {
  const byDay: WeekScheduleBlock[][] = Array.from({ length: 7 }, () => []);
  for (const b of blocks) {
    if (b.dayOfWeek >= 0 && b.dayOfWeek <= 6) {
      byDay[b.dayOfWeek]!.push(b);
    }
  }
  const out: WeekScheduleBlock[] = [];
  for (const day of byDay) {
    out.push(...layoutDayBlocks(day));
  }
  return out;
}

export interface WeekScheduleStreamerInput {
  id: number;
  display_name: string;
  avatar_url?: string | null;
  timezone: string;
  schedules: StreamSchedule[];
  is_scheduled_now?: boolean;
}

/**
 * Build week-view blocks for all streamers, with times converted to the
 * viewer timezone. Blocks are placed on the start day in viewer TZ.
 */
export function buildWeekScheduleBlocks(
  streamers: WeekScheduleStreamerInput[],
  viewerTimezone?: string,
  now = new Date()
): WeekScheduleBlock[] {
  const viewerTz = viewerTimezone || getViewerTimezone();
  const blocks: WeekScheduleBlock[] = [];

  streamers.forEach((streamer, colorIndex) => {
    const srcTz = streamer.timezone || 'UTC';
    const active = (streamer.schedules || []).filter(
      (s) => s.enabled !== false && s.enabled !== 0
    );

    for (const s of active) {
      const start = String(s.start_time).slice(0, 5);
      const end = String(s.end_time).slice(0, 5);
      const range = convertScheduleRangeInWeek(
        s.day_of_week,
        start,
        end,
        srcTz,
        viewerTz,
        now
      );

      const startHm = parseHm(start);
      const endHm = parseHm(end);
      const overnightSrc =
        endHm.hour * 60 + endHm.minute <= startHm.hour * 60 + startHm.minute;
      const endSrcDay = overnightSrc ? (s.day_of_week + 1) % 7 : s.day_of_week;

      const startInst = convertScheduleInstantInWeek(
        s.day_of_week,
        start,
        srcTz,
        viewerTz,
        now
      );
      const endInst = convertScheduleInstantInWeek(
        endSrcDay,
        end,
        srcTz,
        viewerTz,
        now
      );

      let startMinutes =
        startInst.dayOfWeek * 24 * 60 + timeToMinutes(startInst.time);
      let endMinutes =
        endInst.dayOfWeek * 24 * 60 + timeToMinutes(endInst.time);
      // If end is earlier in the week than start (e.g. Sat night → Sun morning),
      // treat end as next week for duration math.
      if (endMinutes <= startMinutes) {
        endMinutes += 7 * 24 * 60;
      }

      // Day-local minutes for layout within the start column
      const dayStartMin = timeToMinutes(startInst.time);
      const duration = endMinutes - startMinutes;
      const dayEndMin = dayStartMin + duration;

      blocks.push({
        key: `${streamer.id}-${s.day_of_week}-${start}-${end}`,
        streamerId: streamer.id,
        displayName: streamer.display_name,
        avatarUrl: streamer.avatar_url,
        isScheduledNow: Boolean(streamer.is_scheduled_now),
        dayOfWeek: startInst.dayOfWeek,
        startMinutes: dayStartMin,
        endMinutes: dayEndMin,
        startLabel: range.startLabel,
        endLabel: range.endLabel,
        rangeLabel: range.rangeLabel,
        crossesDay: range.crossesDay,
        endDayLabel: range.endDayLabel,
        colorIndex,
      });
    }
  });

  return blocks.sort((a, b) => {
    if (a.dayOfWeek !== b.dayOfWeek) return a.dayOfWeek - b.dayOfWeek;
    return a.startMinutes - b.startMinutes;
  });
}

/** Short timezone name for UI (e.g. "EDT", "PDT", or the IANA id). */
export function timezoneShortLabel(
  timeZone?: string,
  now = new Date()
): string {
  const tz = timeZone || getViewerTimezone();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(now);
    return parts.find((p) => p.type === 'timeZoneName')?.value || tz;
  } catch {
    return tz;
  }
}
