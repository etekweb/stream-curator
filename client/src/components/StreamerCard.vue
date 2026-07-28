<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { Streamer } from '../types';
import PlatformBadge from './PlatformBadge.vue';
import {
  nextStreamRelativeLabel,
  scheduleSummaryEastern,
} from '../utils/schedule';
import { useLongPressMenu } from '../composables/useLongPressMenu';

const props = defineProps<{
  streamer: Streamer;
  /** Allow drag-to-reorder from the grip handle */
  reorderable?: boolean;
  dragging?: boolean;
  dragOver?: boolean;
}>();

const avatarFailed = ref(false);
watch(
  () => props.streamer.avatar_url,
  () => {
    avatarFailed.value = false;
  }
);

const emit = defineEmits<{
  edit: [streamer: Streamer];
  delete: [streamer: Streamer];
  dragStart: [streamer: Streamer, event: DragEvent];
  dragOver: [streamer: Streamer, event: DragEvent];
  drop: [streamer: Streamer, event: DragEvent];
  dragEnd: [];
  openMenu: [streamer: Streamer, x: number, y: number];
}>();

const router = useRouter();

const summary = computed(() =>
  scheduleSummaryEastern(props.streamer.schedules, props.streamer.timezone)
);

/** Viewer-local plain English for next stream (hidden while "Scheduled now") */
const upcomingLabel = computed(() => {
  if (props.streamer.is_scheduled_now) return null;
  return nextStreamRelativeLabel(
    props.streamer.schedules,
    props.streamer.timezone
  );
});

const longPress = useLongPressMenu<Streamer>((s, x, y) => {
  emit('openMenu', s, x, y);
});

function open() {
  if (longPress.shouldSuppressClick()) return;
  router.push({ name: 'streamer', params: { id: props.streamer.id } });
}
</script>

<template>
  <article
    class="card streamer-card"
    :class="{ dragging, 'drag-over': dragOver, reorderable }"
    role="button"
    tabindex="0"
    @click="open"
    @keydown.enter="open"
    @contextmenu="longPress.onContextMenu(streamer, $event)"
    @pointerdown="longPress.onPointerDown(streamer, $event)"
    @pointermove="longPress.onPointerMove"
    @pointerup="longPress.onPointerEnd"
    @pointercancel="longPress.onPointerEnd"
    @dragover.prevent="reorderable && emit('dragOver', streamer, $event)"
    @drop.prevent="reorderable && emit('drop', streamer, $event)"
    @dragend="reorderable && emit('dragEnd')"
  >
    <div class="card-top">
      <div class="identity">
        <button
          v-if="reorderable"
          type="button"
          class="drag-handle"
          title="Drag to reorder"
          aria-label="Drag to reorder"
          draggable="true"
          @click.stop
          @pointerdown.stop
          @contextmenu.stop
          @dragstart.stop="emit('dragStart', streamer, $event)"
        >
          ⋮⋮
        </button>
        <div class="avatar" :aria-hidden="true">
          <img
            v-if="streamer.avatar_url && !avatarFailed"
            :src="streamer.avatar_url"
            alt=""
            class="avatar-img"
            @error="avatarFailed = true"
          />
          <span v-else>{{ streamer.display_name.slice(0, 1).toUpperCase() }}</span>
        </div>
        <div>
          <h3 class="name">{{ streamer.display_name }}</h3>
          <div class="meta">
            <span v-if="streamer.is_scheduled_now" class="badge badge-live">
              Scheduled now
            </span>
            <span
              v-else-if="upcomingLabel"
              class="badge badge-upcoming"
              :title="upcomingLabel"
            >
              {{ upcomingLabel }}
            </span>
          </div>
        </div>
      </div>
      <div class="actions" @click.stop @pointerdown.stop @contextmenu.stop>
        <button class="btn btn-ghost btn-sm" type="button" @click="emit('edit', streamer)">
          Edit
        </button>
        <button class="btn btn-danger btn-sm" type="button" @click="emit('delete', streamer)">
          Delete
        </button>
      </div>
    </div>

    <div class="platforms">
      <PlatformBadge
        v-for="p in streamer.platforms"
        :key="p.platform"
        :platform="p.platform"
        :username="p.username"
      />
    </div>

    <p class="schedule" :title="`${summary} (Eastern Time)`">
      <span class="sched-label">ET</span>
      {{ summary }}
    </p>
    <p v-if="streamer.notes" class="notes">{{ streamer.notes }}</p>
  </article>
</template>

<style scoped>
.streamer-card {
  padding: 1.15rem 1.25rem;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.12s, background 0.15s, opacity 0.15s;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.streamer-card:hover {
  border-color: #3a4560;
  background: var(--bg-hover);
  transform: translateY(-1px);
}

.streamer-card.dragging {
  opacity: 0.45;
  transform: scale(0.98);
}

.streamer-card.drag-over {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
}

.identity {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  min-width: 0;
}

.drag-handle {
  flex-shrink: 0;
  width: 1.5rem;
  height: 2rem;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text-dim);
  font-size: 0.75rem;
  letter-spacing: -0.08em;
  cursor: grab;
  line-height: 1;
  padding: 0;
  user-select: none;
}

.drag-handle:active {
  cursor: grabbing;
}

.drag-handle:hover {
  color: var(--text);
  border-color: #3a4560;
  background: var(--bg-hover);
}

.avatar {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: linear-gradient(145deg, #2a3550, #1a2030);
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
  font-weight: 700;
  color: var(--accent-hover);
  flex-shrink: 0;
  overflow: hidden;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.name {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.meta {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-top: 0.2rem;
  flex-wrap: wrap;
}

.actions {
  display: flex;
  gap: 0.35rem;
  flex-shrink: 0;
}

.platforms {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.schedule {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sched-label {
  display: inline-block;
  margin-right: 0.35rem;
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--accent-hover);
  background: var(--accent-soft);
  vertical-align: 0.05em;
}

.notes {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-dim);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
