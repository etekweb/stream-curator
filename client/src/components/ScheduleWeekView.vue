<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Streamer } from '../types';
import {
  buildWeekScheduleBlocks,
  getViewerTimezone,
  layoutWeekBlocks,
  timezoneShortLabel,
  weekDayHeaders,
  type WeekScheduleBlock,
} from '../utils/schedule';
import { useLongPressMenu } from '../composables/useLongPressMenu';

const props = defineProps<{
  streamers: Streamer[];
}>();

const emit = defineEmits<{
  openMenu: [streamer: Streamer, x: number, y: number];
}>();

const router = useRouter();

/** Cursor-following tooltip for schedule blocks */
const tip = ref<{
  block: WeekScheduleBlock;
  x: number;
  y: number;
} | null>(null);

function streamerById(id: number): Streamer | undefined {
  return props.streamers.find((s) => s.id === id);
}

const longPress = useLongPressMenu<Streamer>((s, x, y) => {
  hideTip();
  emit('openMenu', s, x, y);
});

const viewerTz = getViewerTimezone();
const tzShort = timezoneShortLabel(viewerTz);

const headers = computed(() => weekDayHeaders(viewerTz));

/**
 * Mobile list: today first, then the next 6 days (prior days wrap to the end).
 * e.g. Wed today → Wed Thu Fri Sat Sun Mon Tue
 */
const mobileHeaders = computed(() => {
  const all = headers.value;
  const todayIdx = all.findIndex((h) => h.isToday);
  if (todayIdx <= 0) return all;
  return [...all.slice(todayIdx), ...all.slice(0, todayIdx)];
});

const blocks = computed(() =>
  layoutWeekBlocks(buildWeekScheduleBlocks(props.streamers, viewerTz))
);

const blocksByDay = computed(() => {
  const map: WeekScheduleBlock[][] = Array.from({ length: 7 }, () => []);
  for (const b of blocks.value) {
    if (b.dayOfWeek >= 0 && b.dayOfWeek <= 6) {
      map[b.dayOfWeek]!.push(b);
    }
  }
  // Keep start-time order within each day for mobile lists
  for (const day of map) {
    day.sort((a, b) => {
      if (a.startMinutes !== b.startMinutes) {
        return a.startMinutes - b.startMinutes;
      }
      return (a.col ?? 0) - (b.col ?? 0);
    });
  }
  return map;
});

const hasAny = computed(() => blocks.value.length > 0);

const maxOverlap = computed(() =>
  blocks.value.reduce((m, b) => Math.max(m, b.colCount ?? 1), 1)
);

/** Hour range for the time-grid (inclusive start, exclusive end), default evening bias. */
const hourRange = computed(() => {
  if (blocks.value.length === 0) return { start: 12, end: 24 };
  let minM = Infinity;
  let maxM = -Infinity;
  for (const b of blocks.value) {
    minM = Math.min(minM, b.startMinutes);
    maxM = Math.max(maxM, Math.min(b.endMinutes, b.startMinutes + 24 * 60));
  }
  // Pad 1 hour; clamp to full day for the primary column (overnight tails extend past midnight)
  let startH = Math.max(0, Math.floor(minM / 60) - 1);
  let endH = Math.min(24, Math.ceil(maxM / 60) + 1);
  // Minimum span of 8 hours for readability
  if (endH - startH < 8) {
    endH = Math.min(24, startH + 8);
    if (endH - startH < 8) startH = Math.max(0, endH - 8);
  }
  return { start: startH, end: endH };
});

const hours = computed(() => {
  const list: number[] = [];
  for (let h = hourRange.value.start; h < hourRange.value.end; h++) {
    list.push(h);
  }
  return list;
});

const totalMinutes = computed(
  () => (hourRange.value.end - hourRange.value.start) * 60
);

const nowLine = computed(() => {
  const today = headers.value.find((h) => h.isToday);
  if (!today) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: viewerTz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const mins = hour * 60 + minute;
  const start = hourRange.value.start * 60;
  const end = hourRange.value.end * 60;
  if (mins < start || mins > end) return null;
  return {
    dayOfWeek: today.dayOfWeek,
    topPct: ((mins - start) / totalMinutes.value) * 100,
  };
});

function formatHourLabel(h: number): string {
  if (h === 0 || h === 24) return '12 AM';
  if (h === 12) return '12 PM';
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

const COLORS = [
  '#6c8cff',
  '#a78bfa',
  '#3dd68c',
  '#f5b942',
  '#ff5c7a',
  '#22d3ee',
  '#fb923c',
  '#e879f9',
  '#4ade80',
  '#60a5fa',
  '#f472b6',
  '#34d399',
];

function blockColor(b: WeekScheduleBlock): string {
  return COLORS[b.colorIndex % COLORS.length]!;
}

function blockStyle(b: WeekScheduleBlock): Record<string, string> {
  const rangeStart = hourRange.value.start * 60;
  const rangeEnd = hourRange.value.end * 60;
  const start = Math.max(b.startMinutes, rangeStart);
  // Cap visual end at range end; overnight remainder is indicated in the label
  const end = Math.min(b.endMinutes, rangeEnd);
  if (end <= start) {
    return { display: 'none' };
  }
  const top = ((start - rangeStart) / totalMinutes.value) * 100;
  const height = Math.max(
    ((end - start) / totalMinutes.value) * 100,
    3.5 // minimum ~visible chip
  );

  // Side-by-side lanes for concurrent streams (with optional multi-lane span)
  const colCount = Math.max(1, b.colCount ?? 1);
  const colSpan = Math.min(Math.max(1, b.colSpan ?? 1), colCount);
  const col = Math.min(b.col ?? 0, colCount - colSpan);
  const gapPx = colCount > 1 ? 2 : 0;
  const insetPx = 3;
  // Unit width of one lane; span multiplies for expanded free space
  const unit = `((100% - ${insetPx * 2}px - ${(colCount - 1) * gapPx}px) / ${colCount})`;
  const width = `calc(${unit} * ${colSpan} + ${gapPx * (colSpan - 1)}px)`;
  const left = `calc(${insetPx}px + ${col} * (${unit} + ${gapPx}px))`;

  const visualLanes = colCount / colSpan;
  const color = blockColor(b);
  const dense = visualLanes >= 3;
  const veryDense = visualLanes >= 5;

  return {
    top: `${top}%`,
    height: `${height}%`,
    left,
    width,
    right: 'auto',
    background: `color-mix(in srgb, ${color} 22%, var(--bg-card))`,
    borderColor: `color-mix(in srgb, ${color} 55%, transparent)`,
    color,
    '--block-accent': color,
    zIndex: String(2 + col + (b.isScheduledNow ? 2 : 0)),
    ...(dense ? { padding: '0.2rem 0.25rem' } : {}),
    ...(veryDense ? { fontSize: '0.65rem' } : {}),
  };
}

function visualLaneDensity(b: WeekScheduleBlock): number {
  const colCount = Math.max(1, b.colCount ?? 1);
  const colSpan = Math.min(Math.max(1, b.colSpan ?? 1), colCount);
  return colCount / colSpan;
}

function blockCompact(b: WeekScheduleBlock): boolean {
  return visualLaneDensity(b) >= 3;
}

function blockVeryCompact(b: WeekScheduleBlock): boolean {
  return visualLaneDensity(b) >= 5;
}

function tipOffset(x: number, y: number): { x: number; y: number } {
  // Keep tooltip near cursor, nudge so it doesn't cover the pointer
  const pad = 14;
  const tipW = 240;
  const tipH = 72;
  let nx = x + pad;
  let ny = y + pad;
  if (typeof window !== 'undefined') {
    if (nx + tipW > window.innerWidth - 8) nx = x - tipW - pad;
    if (ny + tipH > window.innerHeight - 8) ny = y - tipH - pad;
    nx = Math.max(8, nx);
    ny = Math.max(8, ny);
  }
  return { x: nx, y: ny };
}

function showTip(b: WeekScheduleBlock, e: MouseEvent) {
  const { x, y } = tipOffset(e.clientX, e.clientY);
  tip.value = { block: b, x, y };
}

function showTipFromFocus(b: WeekScheduleBlock, e: FocusEvent) {
  const el = e.currentTarget as HTMLElement | null;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const { x, y } = tipOffset(r.left + r.width / 2, r.top);
  tip.value = { block: b, x, y };
}

function moveTip(e: MouseEvent) {
  if (!tip.value) return;
  const { x, y } = tipOffset(e.clientX, e.clientY);
  tip.value = { ...tip.value, x, y };
}

function hideTip() {
  tip.value = null;
}

const tipStyle = computed(() => {
  if (!tip.value) return {};
  const color = blockColor(tip.value.block);
  return {
    left: `${tip.value.x}px`,
    top: `${tip.value.y}px`,
    '--block-accent': color,
    borderColor: `color-mix(in srgb, ${color} 45%, var(--border))`,
  };
});

function openStreamer(id: number) {
  if (longPress.shouldSuppressClick()) return;
  hideTip();
  router.push({ name: 'streamer', params: { id } });
}

function onBlockContextMenu(b: WeekScheduleBlock, e: MouseEvent) {
  const s = streamerById(b.streamerId);
  if (!s) return;
  longPress.onContextMenu(s, e);
}

function onBlockPointerDown(b: WeekScheduleBlock, e: PointerEvent) {
  const s = streamerById(b.streamerId);
  if (!s) return;
  longPress.onPointerDown(s, e);
}

function onLegendContextMenu(b: WeekScheduleBlock, e: MouseEvent) {
  const s = streamerById(b.streamerId);
  if (!s) return;
  longPress.onContextMenu(s, e);
}

function onLegendPointerDown(b: WeekScheduleBlock, e: PointerEvent) {
  const s = streamerById(b.streamerId);
  if (!s) return;
  longPress.onPointerDown(s, e);
}

function dayBlocks(day: number): WeekScheduleBlock[] {
  return blocksByDay.value[day] ?? [];
}

/** Unique streamers that appear on the week grid (for legend). */
const legendStreamers = computed(() => {
  const seen = new Map<number, WeekScheduleBlock>();
  for (const b of blocks.value) {
    if (!seen.has(b.streamerId)) seen.set(b.streamerId, b);
  }
  return [...seen.values()];
});
</script>

<template>
  <div class="week-view">
    <div class="week-meta">
      <span class="tz-pill" :title="viewerTz">
        Times in your timezone · {{ tzShort }}
      </span>
      <span v-if="hasAny" class="count">
        {{ blocks.length }} scheduled slot{{ blocks.length === 1 ? '' : 's' }}
        <template v-if="maxOverlap > 1">
          · up to {{ maxOverlap }} concurrent
        </template>
      </span>
    </div>

    <div v-if="!hasAny" class="empty-state card">
      <h3>No schedules this week</h3>
      <p>Add weekly stream times on a streamer to see them here.</p>
    </div>

    <template v-else>
      <!-- Desktop / tablet: time grid -->
      <div class="grid-wrap card" aria-label="Weekly schedule grid">
        <div class="grid" :style="{ '--hour-count': hours.length }">
          <!-- Corner -->
          <div class="corner" aria-hidden="true" />

          <!-- Day headers -->
          <div
            v-for="h in headers"
            :key="'h-' + h.dayOfWeek"
            class="day-head"
            :class="{ today: h.isToday }"
          >
            <span class="dow">{{ h.dayLabel }}</span>
            <span class="date">{{ h.dateLabel }}</span>
          </div>

          <!-- Hour labels column -->
          <div class="hours" aria-hidden="true">
            <div
              v-for="hr in hours"
              :key="'hr-' + hr"
              class="hour-label"
            >
              {{ formatHourLabel(hr) }}
            </div>
          </div>

          <!-- Day columns -->
          <div
            v-for="h in headers"
            :key="'col-' + h.dayOfWeek"
            class="day-col"
            :class="{ today: h.isToday }"
          >
            <div
              v-for="hr in hours"
              :key="'line-' + h.dayOfWeek + '-' + hr"
              class="hour-line"
            />

            <button
              v-for="b in dayBlocks(h.dayOfWeek)"
              :key="b.key"
              type="button"
              class="block"
              :class="{
                live: b.isScheduledNow,
                compact: blockCompact(b),
                'very-compact': blockVeryCompact(b),
                stacked: (b.colCount ?? 1) > 1,
              }"
              :style="blockStyle(b)"
              @mouseenter="showTip(b, $event)"
              @mousemove="moveTip"
              @mouseleave="hideTip"
              @focus="showTipFromFocus(b, $event)"
              @blur="hideTip"
              @contextmenu="onBlockContextMenu(b, $event)"
              @pointerdown="onBlockPointerDown(b, $event)"
              @pointermove="longPress.onPointerMove"
              @pointerup="longPress.onPointerEnd"
              @pointercancel="longPress.onPointerEnd"
              @click="openStreamer(b.streamerId)"
            >
              <span class="block-name">
                <template v-if="blockVeryCompact(b)">
                  {{ b.displayName.slice(0, 1).toUpperCase() }}
                </template>
                <template v-else>{{ b.displayName }}</template>
              </span>
              <span v-if="!blockCompact(b)" class="block-time">{{ b.rangeLabel }}</span>
              <span v-else-if="!blockVeryCompact(b)" class="block-time">{{ b.startLabel }}</span>
            </button>

            <!-- Drawn above blocks; pointer-events none so clicks/right-clicks hit items -->
            <div
              v-if="nowLine && nowLine.dayOfWeek === h.dayOfWeek"
              class="now-line"
              :style="{ top: nowLine.topPct + '%' }"
              aria-hidden="true"
            />
          </div>
        </div>
      </div>

      <!-- Mobile: day cards (today first, then rest of week wrapping) -->
      <div class="mobile-days" aria-label="Weekly schedule list">
        <section
          v-for="h in mobileHeaders"
          :key="'m-' + h.dayOfWeek"
          class="mobile-day card"
          :class="{ today: h.isToday }"
        >
          <header class="mobile-day-head">
            <span class="dow">{{ h.dayLabel }}</span>
            <span class="date">{{ h.dateLabel }}</span>
            <span v-if="h.isToday" class="today-tag">Today</span>
          </header>
          <ul v-if="dayBlocks(h.dayOfWeek).length" class="mobile-list">
            <li v-for="b in dayBlocks(h.dayOfWeek)" :key="b.key">
              <button
                type="button"
                class="mobile-block"
                :class="{
                  live: b.isScheduledNow,
                  overlap: (b.overlapCount ?? 0) > 0,
                }"
                :style="{ '--block-accent': blockColor(b) }"
                @mouseenter="showTip(b, $event)"
                @mousemove="moveTip"
                @mouseleave="hideTip"
                @contextmenu="onBlockContextMenu(b, $event)"
                @pointerdown="onBlockPointerDown(b, $event)"
                @pointermove="longPress.onPointerMove"
                @pointerup="longPress.onPointerEnd"
                @pointercancel="longPress.onPointerEnd"
                @click="openStreamer(b.streamerId)"
              >
                <span class="swatch" aria-hidden="true" />
                <span class="info">
                  <span class="block-name">{{ b.displayName }}</span>
                  <span class="block-time">{{ b.rangeLabel }}</span>
                </span>
                <span
                  v-if="(b.overlapCount ?? 0) > 0"
                  class="badge badge-overlap"
                >
                  +{{ b.overlapCount }}
                </span>
                <span v-if="b.isScheduledNow" class="badge badge-live">Now</span>
              </button>
            </li>
          </ul>
          <p v-else class="mobile-empty">No streams</p>
        </section>
      </div>

      <!-- Legend -->
      <div v-if="legendStreamers.length > 1" class="legend">
        <button
          v-for="b in legendStreamers"
          :key="'leg-' + b.streamerId"
          type="button"
          class="legend-item"
          :style="{ '--block-accent': blockColor(b) }"
          @contextmenu="onLegendContextMenu(b, $event)"
          @pointerdown="onLegendPointerDown(b, $event)"
          @pointermove="longPress.onPointerMove"
          @pointerup="longPress.onPointerEnd"
          @pointercancel="longPress.onPointerEnd"
          @click="openStreamer(b.streamerId)"
        >
          <span class="swatch" />
          {{ b.displayName }}
        </button>
      </div>

      <!-- Cursor-following tooltip (Teleport to body so it isn't clipped) -->
      <Teleport to="body">
        <div
          v-if="tip"
          class="sched-tip"
          :style="tipStyle"
          role="tooltip"
        >
          <div class="sched-tip-accent" aria-hidden="true" />
          <div class="sched-tip-body">
            <div class="sched-tip-name">{{ tip.block.displayName }}</div>
            <div class="sched-tip-time">{{ tip.block.rangeLabel }}</div>
            <div v-if="tip.block.isScheduledNow" class="sched-tip-live">
              Scheduled now
            </div>
            <div
              v-else-if="(tip.block.overlapCount ?? 0) > 0"
              class="sched-tip-meta"
            >
              Overlaps {{ tip.block.overlapCount }} other{{
                tip.block.overlapCount === 1 ? '' : 's'
              }}
            </div>
          </div>
        </div>
      </Teleport>
    </template>
  </div>
</template>

<style scoped>
.week-view {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.week-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.tz-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.65rem;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-hover);
  font-weight: 600;
  font-size: 0.78rem;
}

.count {
  color: var(--text-dim);
}

/* —— Time grid (desktop) —— */
.grid-wrap {
  overflow-x: auto;
  padding: 0.75rem;
}

.grid {
  --hour-count: 12;
  --row-h: 3.25rem;
  display: grid;
  /* Wider min day cols so concurrent lanes stay readable */
  grid-template-columns: 3.5rem repeat(7, minmax(7.5rem, 1fr));
  grid-template-rows: auto minmax(calc(var(--hour-count) * var(--row-h)), auto);
  min-width: 720px;
  gap: 0;
}

.corner {
  grid-column: 1;
  grid-row: 1;
}

.day-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
  padding: 0.45rem 0.25rem 0.65rem;
  border-bottom: 1px solid var(--border-subtle);
  text-align: center;
}

.day-head .dow {
  font-weight: 700;
  font-size: 0.8rem;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.day-head .date {
  font-size: 0.78rem;
  color: var(--text-dim);
}

.day-head.today .dow {
  color: var(--accent-hover);
}

.day-head.today .date {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.6rem;
  height: 1.6rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--accent);
  color: #0b0d12;
  font-weight: 700;
}

.hours {
  grid-column: 1;
  grid-row: 2;
  display: grid;
  grid-template-rows: repeat(var(--hour-count), var(--row-h));
  position: relative;
}

.hour-label {
  font-size: 0.68rem;
  color: var(--text-dim);
  font-family: var(--mono);
  transform: translateY(-0.45em);
  text-align: right;
  padding-right: 0.45rem;
  line-height: 1;
}

.day-col {
  grid-row: 2;
  position: relative;
  display: grid;
  grid-template-rows: repeat(var(--hour-count), var(--row-h));
  border-left: 1px solid var(--border-subtle);
}

.day-col.today {
  background: color-mix(in srgb, var(--accent) 4%, transparent);
}

.hour-line {
  border-top: 1px solid var(--border-subtle);
  pointer-events: none;
}

.now-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--danger);
  box-shadow: 0 0 8px rgba(255, 92, 122, 0.55);
  /* Above blocks (incl. stacked lanes / hover) but never capture clicks */
  z-index: 30;
  pointer-events: none;
}

.now-line::before {
  content: '';
  position: absolute;
  left: -3px;
  top: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
  pointer-events: none;
}

.block {
  position: absolute;
  /* left/width set inline for overlap lanes */
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 0.1rem;
  padding: 0.3rem 0.4rem;
  border-radius: 6px;
  border: 1px solid;
  border-left-width: 3px;
  border-left-color: var(--block-accent);
  text-align: left;
  overflow: hidden;
  cursor: pointer;
  transition: filter 0.12s, box-shadow 0.12s;
  min-height: 0;
  min-width: 0;
  box-sizing: border-box;
  font: inherit;
  line-height: 1.25;
}

.block.stacked {
  /* Subtle depth so side-by-side chips read as separate */
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--block-accent) 12%, transparent);
}

.block:hover {
  filter: brightness(1.12);
  z-index: 8 !important;
}

.block:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
  z-index: 8 !important;
}

.block.live {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--success) 50%, transparent),
    0 0 12px color-mix(in srgb, var(--success) 25%, transparent);
}

.block.compact {
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 0.15rem 0.2rem;
  border-left-width: 2px;
}

.block.very-compact {
  padding: 0.1rem;
}

.block.very-compact .block-name {
  font-size: 0.7rem;
  letter-spacing: 0.02em;
}

.block-name {
  font-weight: 700;
  font-size: 0.72rem;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.block-time {
  font-size: 0.65rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.block.compact .block-name {
  font-size: 0.68rem;
}

/* —— Mobile list —— */
.mobile-days {
  display: none;
  flex-direction: column;
  gap: 0.65rem;
}

.mobile-day {
  padding: 0.75rem 0.9rem;
}

.mobile-day.today {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border-subtle));
}

.mobile-day-head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 0.55rem;
}

.mobile-day-head .dow {
  font-weight: 700;
  font-size: 0.9rem;
}

.mobile-day-head .date {
  color: var(--text-dim);
  font-size: 0.8rem;
}

.today-tag {
  margin-left: auto;
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--accent-hover);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.mobile-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.mobile-block {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.55rem 0.65rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg);
  cursor: pointer;
  text-align: left;
  transition: background 0.12s, border-color 0.12s;
}

.mobile-block:hover {
  background: var(--bg-hover);
  border-color: #3a4560;
}

.mobile-block.live {
  border-color: color-mix(in srgb, var(--success) 45%, transparent);
}

.mobile-block.overlap {
  border-left: 3px solid var(--block-accent);
}

.badge-overlap {
  flex-shrink: 0;
  background: var(--bg-hover);
  color: var(--text-muted);
  border-color: var(--border);
  font-variant-numeric: tabular-nums;
}

.swatch {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--block-accent);
  flex-shrink: 0;
  box-shadow: 0 0 8px color-mix(in srgb, var(--block-accent) 50%, transparent);
}

.mobile-block .info {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
  flex: 1;
}

.mobile-block .block-name {
  font-size: 0.88rem;
}

.mobile-block .block-time {
  font-size: 0.78rem;
}

.mobile-empty {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-dim);
}

/* Legend */
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
}

.legend-item:hover {
  color: var(--text);
  border-color: #3a4560;
  background: var(--bg-hover);
}

.legend-item .swatch {
  width: 7px;
  height: 7px;
}

@media (max-width: 720px) {
  .grid-wrap {
    display: none;
  }
  .mobile-days {
    display: flex;
  }
}
</style>

<!-- Teleported tooltip lives on body; keep styles unscoped for reliability -->
<style>
.sched-tip {
  position: fixed;
  z-index: 10000;
  pointer-events: none;
  display: flex;
  max-width: min(260px, calc(100vw - 16px));
  border-radius: 10px;
  border: 1px solid var(--border, #2a3142);
  background: color-mix(in srgb, var(--bg-elevated, #12151d) 92%, #000);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(10px);
  overflow: hidden;
  font-family: var(--font, system-ui, sans-serif);
}

.sched-tip-accent {
  width: 4px;
  flex-shrink: 0;
  background: var(--block-accent, #6c8cff);
}

.sched-tip-body {
  padding: 0.55rem 0.7rem 0.6rem;
  min-width: 0;
}

.sched-tip-name {
  font-weight: 700;
  font-size: 0.9rem;
  color: var(--text, #e8ecf4);
  line-height: 1.25;
  word-break: break-word;
}

.sched-tip-time {
  margin-top: 0.2rem;
  font-size: 0.8rem;
  color: var(--text-muted, #8b95a8);
  font-variant-numeric: tabular-nums;
}

.sched-tip-live {
  margin-top: 0.35rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--success, #3dd68c);
  letter-spacing: 0.02em;
}

.sched-tip-meta {
  margin-top: 0.3rem;
  font-size: 0.72rem;
  color: var(--text-dim, #5c6578);
}
</style>
