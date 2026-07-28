<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  PLATFORMS,
  PLATFORM_LABELS,
  DAY_FULL,
  type Platform,
  type Streamer,
  type StreamerFormData,
  type StreamerPlatform,
} from '../types';
import { emptyWeekSchedule, mergeSchedules } from '../utils/schedule';
import { resolveAvatar } from '../api/client';

const props = defineProps<{
  streamer?: Streamer | null;
  saving?: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{
  submit: [data: StreamerFormData];
  cancel: [];
}>();

const form = reactive<StreamerFormData>({
  display_name: '',
  notes: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  avatar_url: '',
  platforms: [],
  schedules: emptyWeekSchedule(),
});

const selectedPlatforms = reactive<Record<Platform, boolean>>({
  twitch: false,
  kick: false,
  youtube: false,
  rumble: false,
  x: false,
});

const platformDetails = reactive<
  Record<Platform, { username: string; external_id: string; is_primary: boolean }>
>({
  twitch: { username: '', external_id: '', is_primary: false },
  kick: { username: '', external_id: '', is_primary: false },
  youtube: { username: '', external_id: '', is_primary: false },
  rumble: { username: '', external_id: '', is_primary: false },
  x: { username: '', external_id: '', is_primary: false },
});

const avatarPulling = ref<Platform | null>(null);
const avatarError = ref<string | null>(null);
const avatarBroken = ref(false);

const isEdit = computed(() => Boolean(props.streamer));

const timezones = Intl.supportedValuesOf
  ? Intl.supportedValuesOf('timeZone')
  : [
      'UTC',
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'Europe/London',
      'Europe/Berlin',
      'Asia/Tokyo',
    ];

function resetFromStreamer(s?: Streamer | null) {
  for (const p of PLATFORMS) {
    selectedPlatforms[p] = false;
    platformDetails[p] = { username: '', external_id: '', is_primary: false };
  }
  avatarError.value = null;
  avatarBroken.value = false;

  if (!s) {
    form.display_name = '';
    form.notes = '';
    form.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    form.avatar_url = '';
    form.schedules = emptyWeekSchedule();
    return;
  }

  form.display_name = s.display_name;
  form.notes = s.notes || '';
  form.timezone = s.timezone || 'UTC';
  form.avatar_url = s.avatar_url || '';
  form.schedules = mergeSchedules(s.schedules);

  for (const p of s.platforms) {
    selectedPlatforms[p.platform] = true;
    platformDetails[p.platform] = {
      username: p.username,
      external_id: p.external_id || '',
      is_primary: Boolean(p.is_primary),
    };
  }
}

watch(
  () => props.streamer,
  (s) => resetFromStreamer(s),
  { immediate: true }
);

watch(
  () => form.avatar_url,
  () => {
    avatarBroken.value = false;
  }
);

function onDisplayNameBlur() {
  const base = form.display_name.trim().replace(/\s+/g, '');
  if (!base) return;
  for (const p of PLATFORMS) {
    if (selectedPlatforms[p] && !platformDetails[p].username) {
      platformDetails[p].username = base;
    }
  }
}

function togglePlatform(p: Platform) {
  selectedPlatforms[p] = !selectedPlatforms[p];
  if (selectedPlatforms[p] && !platformDetails[p].username && form.display_name) {
    platformDetails[p].username = form.display_name.trim().replace(/\s+/g, '');
  }
}

function setPrimary(p: Platform) {
  for (const key of PLATFORMS) {
    platformDetails[key].is_primary = key === p;
  }
}

async function pullIcon(p: Platform) {
  const d = platformDetails[p];
  if (!selectedPlatforms[p] || !d.username.trim()) {
    avatarError.value = `Enter a ${PLATFORM_LABELS[p]} username first`;
    return;
  }
  avatarPulling.value = p;
  avatarError.value = null;
  try {
    const result = await resolveAvatar({
      platform: p,
      username: d.username.trim(),
      external_id: d.external_id.trim() || null,
    });
    form.avatar_url = result.url;
    avatarBroken.value = false;
  } catch (e) {
    avatarError.value =
      e instanceof Error ? e.message : `Failed to pull icon from ${PLATFORM_LABELS[p]}`;
  } finally {
    avatarPulling.value = null;
  }
}

function clearAvatar() {
  form.avatar_url = '';
  avatarBroken.value = false;
  avatarError.value = null;
}

function onSubmit() {
  const platforms: StreamerPlatform[] = [];
  for (const p of PLATFORMS) {
    if (!selectedPlatforms[p]) continue;
    const d = platformDetails[p];
    if (!d.username.trim()) {
      continue;
    }
    platforms.push({
      platform: p,
      username: d.username.trim(),
      external_id: d.external_id.trim() || null,
      is_primary: d.is_primary,
    });
  }

  emit('submit', {
    display_name: form.display_name.trim(),
    notes: form.notes,
    timezone: form.timezone,
    avatar_url: form.avatar_url.trim(),
    platforms,
    schedules: form.schedules.map((s) => ({
      ...s,
      enabled: Boolean(s.enabled),
    })),
  });
}
</script>

<template>
  <form class="streamer-form" @submit.prevent="onSubmit">
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div class="form-row">
      <div class="form-group">
        <label for="display_name">Display name</label>
        <input
          id="display_name"
          v-model="form.display_name"
          type="text"
          required
          placeholder="e.g. xQc"
          @blur="onDisplayNameBlur"
        />
      </div>
      <div class="form-group">
        <label for="timezone">Timezone</label>
        <select id="timezone" v-model="form.timezone">
          <option v-for="tz in timezones" :key="tz" :value="tz">{{ tz }}</option>
        </select>
      </div>
    </div>

    <div class="form-group">
      <label for="notes">Notes</label>
      <textarea id="notes" v-model="form.notes" placeholder="Optional notes…" rows="2" />
    </div>

    <section class="section">
      <h3>Avatar</h3>
      <p class="hint">
        Pull a profile image from a platform below, or paste an image URL. Shown on cards and the
        watch page.
      </p>
      <div class="avatar-row">
        <div class="avatar-preview" aria-hidden="true">
          <img
            v-if="form.avatar_url && !avatarBroken"
            :src="form.avatar_url"
            alt=""
            @error="avatarBroken = true"
          />
          <span v-else class="avatar-fallback">
            {{ (form.display_name || '?').slice(0, 1).toUpperCase() }}
          </span>
        </div>
        <div class="avatar-fields">
          <input
            id="avatar_url"
            v-model="form.avatar_url"
            type="url"
            placeholder="https://… image URL"
          />
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="!form.avatar_url"
            @click="clearAvatar"
          >
            Clear
          </button>
        </div>
      </div>
      <div v-if="avatarError" class="alert alert-error avatar-err">{{ avatarError }}</div>
    </section>

    <section class="section">
      <h3>Platforms</h3>
      <p class="hint">
        Select services they stream on. Customize the username per platform if it differs.
        For YouTube, optionally set channel ID (starts with UC) for live player embeds. Use
        <strong>Pull icon</strong> to fetch that platform’s avatar.
      </p>

      <div class="platform-list">
        <div
          v-for="p in PLATFORMS"
          :key="p"
          class="platform-row"
          :class="{ active: selectedPlatforms[p] }"
        >
          <label class="check-row">
            <input
              type="checkbox"
              :checked="selectedPlatforms[p]"
              @change="togglePlatform(p)"
            />
            <span class="plat-label">{{ PLATFORM_LABELS[p] }}</span>
          </label>

          <template v-if="selectedPlatforms[p]">
            <input
              v-model="platformDetails[p].username"
              type="text"
              class="uname-input"
              :placeholder="`${PLATFORM_LABELS[p]} username`"
              required
            />
            <input
              v-if="p === 'youtube'"
              v-model="platformDetails[p].external_id"
              type="text"
              class="ext-input"
              placeholder="Channel ID (UC…)"
            />
            <button
              type="button"
              class="btn btn-ghost btn-sm pull-btn"
              :disabled="avatarPulling === p || !platformDetails[p].username.trim()"
              @click="pullIcon(p)"
            >
              {{ avatarPulling === p ? 'Pulling…' : 'Pull icon' }}
            </button>
            <label class="check-row primary-check">
              <input
                type="radio"
                name="primary_platform"
                :checked="platformDetails[p].is_primary"
                @change="setPrimary(p)"
              />
              Primary
            </label>
          </template>
        </div>
      </div>
    </section>

    <section class="section">
      <h3>Stream schedule</h3>
      <p class="hint">
        Typical hours live each day (in the streamer’s timezone). Leave a day unchecked if they
        don’t usually stream.
      </p>

      <div class="schedule-grid">
        <div
          v-for="(day, idx) in form.schedules"
          :key="idx"
          class="schedule-row"
          :class="{ enabled: day.enabled }"
        >
          <label class="check-row day-check">
            <input v-model="day.enabled" type="checkbox" />
            <span>{{ DAY_FULL[idx] }}</span>
          </label>
          <input
            v-model="day.start_time"
            type="time"
            :disabled="!day.enabled"
            required
          />
          <span class="to">to</span>
          <input
            v-model="day.end_time"
            type="time"
            :disabled="!day.enabled"
            required
          />
        </div>
      </div>
    </section>

    <div class="form-actions">
      <button type="button" class="btn btn-ghost" @click="emit('cancel')">Cancel</button>
      <button type="submit" class="btn btn-primary" :disabled="saving">
        {{ saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add streamer' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.section {
  margin: 1.25rem 0;
}

.section h3 {
  margin: 0 0 0.35rem;
  font-size: 0.95rem;
  font-weight: 700;
}

.hint {
  margin: 0 0 0.85rem;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.avatar-row {
  display: flex;
  gap: 0.85rem;
  align-items: center;
}

.avatar-preview {
  width: 64px;
  height: 64px;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: linear-gradient(145deg, #2a3550, #1a2030);
  flex-shrink: 0;
  display: grid;
  place-items: center;
}

.avatar-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-fallback {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--accent-hover);
}

.avatar-fields {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  min-width: 0;
}

.avatar-fields input {
  flex: 1;
  min-width: 160px;
}

.avatar-err {
  margin-top: 0.65rem;
  margin-bottom: 0;
}

.platform-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.platform-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  padding: 0.65rem 0.75rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg);
}

.platform-row.active {
  border-color: var(--border);
  background: var(--bg-card);
}

.plat-label {
  font-weight: 600;
  min-width: 72px;
}

.uname-input,
.ext-input {
  flex: 1;
  min-width: 120px;
}

.pull-btn {
  flex-shrink: 0;
}

.primary-check {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.schedule-grid {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.schedule-row {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.65rem;
  border-radius: var(--radius-sm);
  background: var(--bg);
  border: 1px solid transparent;
  opacity: 0.55;
}

.schedule-row.enabled {
  opacity: 1;
  border-color: var(--border-subtle);
  background: var(--bg-card);
}

.day-check {
  font-weight: 500;
}

.to {
  color: var(--text-dim);
  font-size: 0.8rem;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-subtle);
}

@media (max-width: 560px) {
  .schedule-row {
    grid-template-columns: 1fr 1fr;
  }
  .day-check {
    grid-column: 1 / -1;
  }
  .to {
    display: none;
  }
}
</style>
