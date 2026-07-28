<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { Streamer, StreamerFormData } from '../types';
import {
  createStreamer,
  deleteStreamer,
  fetchStreamers,
  reorderStreamers,
  updateStreamer,
} from '../api/client';
import StreamerCard from '../components/StreamerCard.vue';
import StreamerForm from '../components/StreamerForm.vue';
import ScheduleWeekView from '../components/ScheduleWeekView.vue';
import StreamerPlatformMenu from '../components/StreamerPlatformMenu.vue';
import Modal from '../components/Modal.vue';

const PIN_PREF_KEY = 'stream-curator:pin-scheduled-now';
const VIEW_PREF_KEY = 'stream-curator:list-view';

type ListViewMode = 'grid' | 'schedule';

const streamers = ref<Streamer[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const search = ref('');
const showForm = ref(false);
const editing = ref<Streamer | null>(null);
const saving = ref(false);
const formError = ref<string | null>(null);
/** Pin "Scheduled now" cards to the top (default on; optional) */
const pinScheduledNow = ref(true);
const reordering = ref(false);
/** Grid cards vs weekly schedule */
const viewMode = ref<ListViewMode>('schedule');
/** Right-click / long-press platform menu */
const platformMenu = ref<{
  streamer: Streamer;
  x: number;
  y: number;
} | null>(null);

function openPlatformMenu(streamer: Streamer, x: number, y: number) {
  platformMenu.value = { streamer, x, y };
}

function closePlatformMenu() {
  platformMenu.value = null;
}

const dragId = ref<number | null>(null);
const dragOverId = ref<number | null>(null);

const isFiltering = computed(() => Boolean(search.value.trim()));

/** Reorder only in grid view when not searching and pin is off. */
const canReorder = computed(
  () =>
    viewMode.value === 'grid' &&
    !isFiltering.value &&
    !pinScheduledNow.value &&
    streamers.value.length > 1
);

const filtered = computed(() => {
  let list = [...streamers.value];
  const q = search.value.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (s) =>
        s.display_name.toLowerCase().includes(q) ||
        s.platforms.some((p) => p.username.toLowerCase().includes(q)) ||
        (s.notes || '').toLowerCase().includes(q)
    );
  }
  // Pin scheduled-now to top, keep relative order within each group
  if (pinScheduledNow.value) {
    const live: Streamer[] = [];
    const rest: Streamer[] = [];
    for (const s of list) {
      if (s.is_scheduled_now) live.push(s);
      else rest.push(s);
    }
    list = [...live, ...rest];
  }
  return list;
});

const scheduledNowCount = computed(
  () => streamers.value.filter((s) => s.is_scheduled_now).length
);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    streamers.value = await fetchStreamers();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load streamers';
  } finally {
    loading.value = false;
  }
}

function openAdd() {
  editing.value = null;
  formError.value = null;
  showForm.value = true;
}

function openEdit(s: Streamer) {
  editing.value = s;
  formError.value = null;
  showForm.value = true;
}

function closeForm() {
  showForm.value = false;
  editing.value = null;
  formError.value = null;
}

async function onSubmit(data: StreamerFormData) {
  if (!data.display_name) {
    formError.value = 'Display name is required';
    return;
  }
  if (data.platforms.length === 0) {
    formError.value = 'Select at least one platform with a username';
    return;
  }
  saving.value = true;
  formError.value = null;
  try {
    if (editing.value) {
      await updateStreamer(editing.value.id, data);
    } else {
      await createStreamer(data);
    }
    closeForm();
    await load();
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Save failed';
  } finally {
    saving.value = false;
  }
}

async function onDelete(s: Streamer) {
  if (!confirm(`Delete streamer “${s.display_name}”? This cannot be undone.`)) return;
  try {
    await deleteStreamer(s.id);
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Delete failed';
  }
}

function onDragStart(s: Streamer, e: DragEvent) {
  if (!canReorder.value) {
    e.preventDefault();
    return;
  }
  dragId.value = s.id;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(s.id));
  }
}

function onDragOver(s: Streamer, _e: DragEvent) {
  if (!canReorder.value || dragId.value === null) return;
  dragOverId.value = s.id;
}

async function onDrop(target: Streamer, _e: DragEvent) {
  if (dragId.value === null || !canReorder.value) return;
  const fromId = dragId.value;
  const toId = target.id;
  dragOverId.value = null;
  dragId.value = null;

  if (fromId === toId) return;

  const list = [...streamers.value];
  const fromIdx = list.findIndex((s) => s.id === fromId);
  const toIdx = list.findIndex((s) => s.id === toId);
  if (fromIdx < 0 || toIdx < 0) return;

  const [moved] = list.splice(fromIdx, 1);
  if (!moved) return;
  list.splice(toIdx, 0, moved);

  streamers.value = list;
  reordering.value = true;
  error.value = null;
  try {
    streamers.value = await reorderStreamers(list.map((s) => s.id));
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to save order';
    await load();
  } finally {
    reordering.value = false;
  }
}

function onDragEnd() {
  dragId.value = null;
  dragOverId.value = null;
}

// Persist pin preference
watch(pinScheduledNow, (v) => {
  try {
    localStorage.setItem(PIN_PREF_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
});

watch(viewMode, (v) => {
  try {
    localStorage.setItem(VIEW_PREF_KEY, v);
  } catch {
    /* ignore */
  }
});

onMounted(() => {
  try {
    const saved = localStorage.getItem(PIN_PREF_KEY);
    if (saved === '0') pinScheduledNow.value = false;
    if (saved === '1') pinScheduledNow.value = true;
    const view = localStorage.getItem(VIEW_PREF_KEY);
    if (view === 'grid' || view === 'schedule') viewMode.value = view;
  } catch {
    /* keep defaults */
  }
  load();
});
</script>

<template>
  <div class="dashboard">
    <div class="page-header">
      <div>
        <h1>Streamers</h1>
        <p class="subtitle">
          Track multi-platform streamers, schedules, and jump into live players & chat.
        </p>
      </div>
      <button type="button" class="btn btn-primary" @click="openAdd">+ Add streamer</button>
    </div>

    <div class="toolbar">
      <input
        v-model="search"
        type="search"
        class="search"
        placeholder="Search by name or username…"
      />
      <div class="view-toggle" role="group" aria-label="List view">
        <button
          type="button"
          class="view-btn"
          :class="{ active: viewMode === 'grid' }"
          title="Card grid"
          @click="viewMode = 'grid'"
        >
          Cards
        </button>
        <button
          type="button"
          class="view-btn"
          :class="{ active: viewMode === 'schedule' }"
          title="Weekly schedule"
          @click="viewMode = 'schedule'"
        >
          Schedule
        </button>
      </div>
      <label
        v-if="viewMode === 'grid'"
        class="check-row filter"
        title="Keep currently scheduled streamers at the top (disables reordering while on)"
      >
        <input v-model="pinScheduledNow" type="checkbox" />
        Pin scheduled now
        <span v-if="scheduledNowCount > 0" class="pin-count">({{ scheduledNowCount }})</span>
      </label>
      <button type="button" class="btn btn-ghost btn-sm" :disabled="loading" @click="load">
        Refresh
      </button>
      <span v-if="canReorder" class="reorder-hint">Drag ⋮⋮ to reorder</span>
      <span
        v-else-if="viewMode === 'grid' && pinScheduledNow && streamers.length > 1 && !isFiltering"
        class="reorder-hint muted"
      >
        Turn off pin to reorder
      </span>
      <span v-else-if="viewMode === 'grid' && isFiltering && streamers.length > 1" class="reorder-hint muted">
        Clear search to reorder
      </span>
      <span v-if="reordering" class="reorder-hint">Saving order…</span>
    </div>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div v-if="loading" class="empty-state">Loading streamers…</div>

    <div v-else-if="filtered.length === 0" class="empty-state card">
      <h3>{{ streamers.length === 0 ? 'No streamers yet' : 'No matches' }}</h3>
      <p v-if="streamers.length === 0">
        Add your first streamer to start curating multi-platform streams.
      </p>
      <button v-if="streamers.length === 0" type="button" class="btn btn-primary" @click="openAdd">
        Add streamer
      </button>
    </div>

    <ScheduleWeekView
      v-else-if="viewMode === 'schedule'"
      :streamers="filtered"
      @open-menu="openPlatformMenu"
    />

    <div v-else class="grid">
      <StreamerCard
        v-for="s in filtered"
        :key="s.id"
        :streamer="s"
        :reorderable="canReorder"
        :dragging="dragId === s.id"
        :drag-over="dragOverId === s.id && dragId !== s.id"
        @edit="openEdit"
        @delete="onDelete"
        @drag-start="onDragStart"
        @drag-over="onDragOver"
        @drop="onDrop"
        @drag-end="onDragEnd"
        @open-menu="openPlatformMenu"
      />
    </div>

    <Modal
      v-if="showForm"
      :title="editing ? 'Edit streamer' : 'Add streamer'"
      @close="closeForm"
    >
      <StreamerForm
        :streamer="editing"
        :saving="saving"
        :error="formError"
        @submit="onSubmit"
        @cancel="closeForm"
      />
    </Modal>

    <StreamerPlatformMenu
      v-if="platformMenu"
      :streamer="platformMenu.streamer"
      :x="platformMenu.x"
      :y="platformMenu.y"
      @close="closePlatformMenu"
    />
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

h1 {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.subtitle {
  margin: 0.35rem 0 0;
  color: var(--text-muted);
  max-width: 480px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 1.25rem;
}

.search {
  flex: 1;
  min-width: 200px;
  max-width: 360px;
}

.view-toggle {
  display: inline-flex;
  padding: 0.2rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg);
  gap: 0.15rem;
}

.view-btn {
  padding: 0.35rem 0.75rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-weight: 600;
  font-size: 0.82rem;
  transition: background 0.12s, color 0.12s;
}

.view-btn:hover {
  color: var(--text);
  background: var(--bg-hover);
}

.view-btn.active {
  background: var(--accent-soft);
  color: var(--accent-hover);
}

.filter {
  font-size: 0.9rem;
  color: var(--text-muted);
}

.pin-count {
  color: var(--text-dim);
  font-size: 0.85em;
}

.reorder-hint {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.reorder-hint.muted {
  color: var(--text-dim);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
}
</style>
