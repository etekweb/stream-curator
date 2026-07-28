<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { EmbedUrls, Platform, StreamerDetail } from '../types';
import { PLATFORMS, PLATFORM_COLORS, PLATFORM_LABELS } from '../types';
import {
  fetchStreamer,
  resolveYouTubeLive,
  resolveRumbleLive,
} from '../api/client';
import { embedsForPlatforms, popOutEmbed } from '../utils/embeds';
import { dualScheduleRows } from '../utils/schedule';
import EmbedPlayer from '../components/EmbedPlayer.vue';
import MultiChat from '../components/MultiChat.vue';
import PlatformBadge from '../components/PlatformBadge.vue';

const props = defineProps<{
  id: string;
}>();

const router = useRouter();
const route = useRoute();

const PLATFORM_SET = new Set<string>(PLATFORMS);

const streamer = ref<StreamerDetail | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const activePlatform = ref<Platform | null>(null);
const viewMode = ref<'player' | 'multi-chat'>('player');
const showInlineChat = ref(true);
const multiChatPlatforms = ref<Platform[]>([]);
/** Once the user toggles multi-chat checkboxes (or URL sets chats), never auto-select */
const multiChatUserLocked = ref(false);
/** Desktop sidebar visibility (ignored on single-column layout) */
const sidebarOpen = ref(true);

/** Avoid feedback loops between state ↔ query */
let applyingRouteQuery = false;
let writingRouteQuery = false;

function isPlatform(v: string): v is Platform {
  return PLATFORM_SET.has(v);
}

function parseMode(raw: unknown): 'player' | 'multi-chat' {
  const v = String(raw ?? '').toLowerCase();
  if (v === 'multi-chat' || v === 'multichat' || v === 'chats' || v === 'chat') {
    return 'multi-chat';
  }
  return 'player';
}

function parsePlatformParam(raw: unknown): Platform | null {
  const v = String(raw ?? '').toLowerCase();
  return isPlatform(v) ? v : null;
}

function parseChatsParam(raw: unknown): Platform[] | null {
  // null = param absent (use defaults); [] = explicit empty selection
  if (raw === undefined || raw === null) return null;
  const s = Array.isArray(raw) ? raw.join(',') : String(raw);
  if (s.trim() === '') return [];
  return s
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(isPlatform);
}

function readStateFromQuery() {
  applyingRouteQuery = true;
  try {
    viewMode.value = parseMode(route.query.mode);
    const plat = parsePlatformParam(route.query.platform);
    if (plat) activePlatform.value = plat;

    const chats = parseChatsParam(route.query.chats);
    if (chats !== null) {
      multiChatPlatforms.value = chats;
      multiChatUserLocked.value = true;
    }
  } finally {
    applyingRouteQuery = false;
  }
}

function writeStateToQuery() {
  if (applyingRouteQuery || writingRouteQuery) return;

  const next: Record<string, string> = {
    mode: viewMode.value,
  };
  if (activePlatform.value) {
    next.platform = activePlatform.value;
  }
  // Persist chats whenever locked or non-empty so refresh keeps selection
  if (multiChatUserLocked.value || multiChatPlatforms.value.length > 0) {
    next.chats = multiChatPlatforms.value.join(',');
  }

  const cur = route.query;
  if (
    String(cur.mode ?? 'player') === next.mode &&
    String(cur.platform ?? '') === (next.platform ?? '') &&
    String(cur.chats ?? '') === (next.chats ?? '')
  ) {
    return;
  }

  writingRouteQuery = true;
  void router
    .replace({
      name: 'streamer',
      params: { id: props.id },
      query: next,
    })
    .finally(() => {
      writingRouteQuery = false;
    });
}

/** YouTube live resolve state */
const ytVideoId = ref<string | null>(null);
const ytResolving = ref(false);
const ytLive = ref<boolean | null>(null);
const ytMessage = ref<string | null>(null);
const ytLastChecked = ref<Date | null>(null);

/** Rumble live resolve state */
const rumbleVideoId = ref<string | null>(null);
const rumbleChatId = ref<string | null>(null);
const rumbleResolving = ref(false);
const rumbleLive = ref<boolean | null>(null);
const rumbleMessage = ref<string | null>(null);
const rumbleLastChecked = ref<Date | null>(null);
const rumbleTitle = ref<string | null>(null);

let ytPollTimer: ReturnType<typeof setInterval> | null = null;
let rumblePollTimer: ReturnType<typeof setInterval> | null = null;
const LIVE_POLL_MS = 120_000; // re-check every 2 minutes

const embeds = computed<EmbedUrls[]>(() => {
  if (!streamer.value) return [];
  return embedsForPlatforms(streamer.value.platforms, streamer.value.embeds, {
    youtube: ytVideoId.value,
    rumble: rumbleVideoId.value,
    rumbleChatId: rumbleChatId.value,
  });
});

const activeEmbed = computed(
  () =>
    embeds.value.find((e) => e.platform === activePlatform.value) ??
    embeds.value[0] ??
    null
);

const multiEmbeds = computed(() =>
  embeds.value.filter((e) => multiChatPlatforms.value.includes(e.platform))
);

const scheduleRows = computed(() => {
  if (!streamer.value) return [];
  return dualScheduleRows(streamer.value.schedules, streamer.value.timezone);
});

const hasYouTube = computed(() =>
  Boolean(streamer.value?.platforms.some((p) => p.platform === 'youtube'))
);

const hasRumble = computed(() =>
  Boolean(streamer.value?.platforms.some((p) => p.platform === 'rumble'))
);

const youtubePlatform = computed(
  () => streamer.value?.platforms.find((p) => p.platform === 'youtube') ?? null
);

const rumblePlatform = computed(
  () => streamer.value?.platforms.find((p) => p.platform === 'rumble') ?? null
);

function isPlatformLive(platform: Platform): boolean {
  if (platform === 'youtube') return ytLive.value === true;
  if (platform === 'rumble') return rumbleLive.value === true;
  return false;
}

function resolveStatusFor(
  platform: Platform | null
): 'idle' | 'checking' | 'live' | 'offline' | 'error' {
  if (platform === 'youtube') {
    if (ytResolving.value) return 'checking';
    if (ytLive.value === true) return 'live';
    if (ytLive.value === false) {
      return ytMessage.value?.toLowerCase().includes('fail') ? 'error' : 'offline';
    }
    return 'idle';
  }
  if (platform === 'rumble') {
    if (rumbleResolving.value) return 'checking';
    if (rumbleLive.value === true) return 'live';
    if (rumbleLive.value === false) {
      return rumbleMessage.value?.toLowerCase().includes('fail')
        ? 'error'
        : 'offline';
    }
    return 'idle';
  }
  return 'idle';
}

function resolveMessageFor(platform: Platform | null): string | null {
  if (platform === 'youtube') return ytMessage.value;
  if (platform === 'rumble') return rumbleMessage.value;
  return null;
}

async function resolveYoutube(refresh = false) {
  const yt = youtubePlatform.value;
  if (!yt) return;

  ytResolving.value = true;
  try {
    const result = await resolveYouTubeLive({
      username: yt.username,
      channelId: yt.external_id,
      refresh,
    });
    ytLive.value = result.live;
    ytVideoId.value = result.live ? result.videoId : null;
    ytMessage.value = result.message || null;
    ytLastChecked.value = new Date();
    // Do not auto-toggle multi-chat selection on poll — that re-shows chats the user hid
  } catch (e) {
    ytLive.value = false;
    ytVideoId.value = null;
    ytMessage.value = e instanceof Error ? e.message : 'YouTube resolve failed';
  } finally {
    ytResolving.value = false;
  }
}

async function resolveRumble(refresh = false) {
  const rb = rumblePlatform.value;
  if (!rb) return;

  rumbleResolving.value = true;
  try {
    const result = await resolveRumbleLive({
      username: rb.username,
      refresh,
    });
    rumbleLive.value = result.live;
    rumbleVideoId.value = result.live ? result.videoId : null;
    rumbleChatId.value = result.live ? result.chatId : null;
    rumbleMessage.value = result.message || null;
    rumbleTitle.value = result.title || null;
    rumbleLastChecked.value = new Date();
    // Do not auto-toggle multi-chat selection on poll — that re-shows chats the user hid
  } catch (e) {
    rumbleLive.value = false;
    rumbleVideoId.value = null;
    rumbleChatId.value = null;
    rumbleTitle.value = null;
    rumbleMessage.value =
      e instanceof Error ? e.message : 'Rumble resolve failed';
  } finally {
    rumbleResolving.value = false;
  }
}

function startYtPoll() {
  stopYtPoll();
  if (!hasYouTube.value) return;
  ytPollTimer = setInterval(() => {
    void resolveYoutube(false);
  }, LIVE_POLL_MS);
}

function stopYtPoll() {
  if (ytPollTimer) {
    clearInterval(ytPollTimer);
    ytPollTimer = null;
  }
}

function startRumblePoll() {
  stopRumblePoll();
  if (!hasRumble.value) return;
  rumblePollTimer = setInterval(() => {
    void resolveRumble(false);
  }, LIVE_POLL_MS);
}

function stopRumblePoll() {
  if (rumblePollTimer) {
    clearInterval(rumblePollTimer);
    rumblePollTimer = null;
  }
}

function stopAllPolls() {
  stopYtPoll();
  stopRumblePoll();
}

async function load() {
  loading.value = true;
  error.value = null;
  ytVideoId.value = null;
  ytLive.value = null;
  ytMessage.value = null;
  rumbleVideoId.value = null;
  rumbleChatId.value = null;
  rumbleLive.value = null;
  rumbleMessage.value = null;
  rumbleTitle.value = null;
  try {
    const data = await fetchStreamer(Number(props.id));
    streamer.value = data;
    const available = new Set(data.platforms.map((p) => p.platform));

    // Restore / validate platform from URL (or defaults)
    if (activePlatform.value && !available.has(activePlatform.value)) {
      activePlatform.value = null;
    }
    if (!activePlatform.value && data.platforms.length) {
      const fromQuery = parsePlatformParam(route.query.platform);
      if (fromQuery && available.has(fromQuery)) {
        activePlatform.value = fromQuery;
      } else {
        const primary = data.platforms.find((p) => p.is_primary);
        activePlatform.value = primary?.platform ?? data.platforms[0]!.platform;
      }
    }

    // Multi-chat: URL wins; otherwise default once
    const chatsFromQuery = parseChatsParam(route.query.chats);
    if (chatsFromQuery !== null) {
      multiChatPlatforms.value = chatsFromQuery.filter((p) => available.has(p));
      multiChatUserLocked.value = true;
    } else if (!multiChatUserLocked.value && multiChatPlatforms.value.length === 0) {
      multiChatPlatforms.value = data.platforms
        .filter((p) => {
          const emb = embedsForPlatforms([p], data.embeds)[0];
          return emb?.supportsChatEmbed;
        })
        .map((p) => p.platform);
      if (multiChatPlatforms.value.length === 0) {
        multiChatPlatforms.value = data.platforms.map((p) => p.platform);
      }
    } else {
      // Drop platforms no longer on this streamer
      multiChatPlatforms.value = multiChatPlatforms.value.filter((p) =>
        available.has(p)
      );
    }

    // Mode from URL (already applied on mount/id change; re-apply for safety)
    if (route.query.mode !== undefined) {
      viewMode.value = parseMode(route.query.mode);
    }

    writeStateToQuery();

    const hasYt = data.platforms.some((p) => p.platform === 'youtube');
    const hasRb = data.platforms.some((p) => p.platform === 'rumble');

    if (hasYt) {
      void resolveYoutube(true).then(() => startYtPoll());
    } else {
      stopYtPoll();
    }

    if (hasRb) {
      void resolveRumble(true).then(() => startRumblePoll());
    } else {
      stopRumblePoll();
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load streamer';
  } finally {
    loading.value = false;
  }
}

function toggleMultiChat(p: Platform) {
  multiChatUserLocked.value = true;
  const idx = multiChatPlatforms.value.indexOf(p);
  if (idx >= 0) {
    multiChatPlatforms.value = multiChatPlatforms.value.filter((x) => x !== p);
  } else {
    multiChatPlatforms.value = [...multiChatPlatforms.value, p];
  }
}

function popAllChats() {
  for (const e of multiEmbeds.value) {
    popOutEmbed('chat', e);
  }
}

function popAllStreams() {
  for (const e of embeds.value) {
    popOutEmbed('player', e);
  }
}

function openActiveChannel() {
  const url = activeEmbed.value?.profileUrl;
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

/** Channel home for each platform (not live-specific watch URLs). */
function platformProfileUrl(p: {
  platform: Platform;
  username: string;
  external_id?: string | null;
}): string {
  const user = p.username.replace(/^@/, '').trim();
  switch (p.platform) {
    case 'twitch':
      return `https://www.twitch.tv/${encodeURIComponent(user)}`;
    case 'kick':
      return `https://kick.com/${encodeURIComponent(user)}`;
    case 'youtube':
      return p.external_id
        ? `https://www.youtube.com/channel/${encodeURIComponent(p.external_id)}`
        : `https://www.youtube.com/@${encodeURIComponent(user)}`;
    case 'rumble':
      return `https://rumble.com/c/${encodeURIComponent(user.replace(/^c\//i, ''))}`;
    case 'x':
      return `https://x.com/${encodeURIComponent(user)}`;
  }
}

// Persist UI state to the URL
watch(
  [viewMode, activePlatform, multiChatPlatforms],
  () => {
    writeStateToQuery();
  },
  { deep: true }
);

// External query changes (back/forward)
watch(
  () => route.query,
  () => {
    if (writingRouteQuery) return;
    if (String(route.params.id) !== String(props.id)) return;
    readStateFromQuery();
  },
  { deep: true }
);

watch(
  () => props.id,
  () => {
    activePlatform.value = null;
    multiChatPlatforms.value = [];
    multiChatUserLocked.value = false;
    viewMode.value = 'player';
    stopAllPolls();
    // Pull mode/platform/chats for this navigation (may be empty)
    readStateFromQuery();
    load();
  }
);

onMounted(() => {
  readStateFromQuery();
  load();
});
onUnmounted(stopAllPolls);
</script>

<template>
  <div class="watch-layout">
    <header class="watch-header">
      <div class="left">
        <button type="button" class="btn btn-ghost btn-sm" @click="router.push('/')">
          ← Dashboard
        </button>
        <template v-if="streamer">
          <div class="header-identity">
            <div class="header-avatar" aria-hidden="true">
              <img
                v-if="streamer.avatar_url"
                :src="streamer.avatar_url"
                alt=""
              />
              <span v-else>{{ streamer.display_name.slice(0, 1).toUpperCase() }}</span>
            </div>
            <div>
              <h1>{{ streamer.display_name }}</h1>
              <div class="pills">
                <PlatformBadge
                  v-for="p in streamer.platforms"
                  :key="p.platform"
                  :platform="p.platform"
                  :username="p.username"
                />
              </div>
            </div>
          </div>
        </template>
      </div>
      <div class="right">
        <div class="mode-toggle">
          <button
            type="button"
            class="btn btn-sm"
            :class="viewMode === 'player' ? 'btn-primary' : 'btn-ghost'"
            @click="viewMode = 'player'"
          >
            Player
          </button>
          <button
            type="button"
            class="btn btn-sm"
            :class="viewMode === 'multi-chat' ? 'btn-primary' : 'btn-ghost'"
            @click="viewMode = 'multi-chat'"
          >
            Multi-chat
          </button>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" @click="popAllStreams">
          Pop out all streams
        </button>
        <button type="button" class="btn btn-ghost btn-sm" @click="popAllChats">
          Pop out chats
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm sidebar-toggle"
          :aria-expanded="sidebarOpen"
          :aria-label="sidebarOpen ? 'Hide sidebar' : 'Show sidebar'"
          @click="sidebarOpen = !sidebarOpen"
        >
          {{ sidebarOpen ? 'Hide info' : 'Show info' }}
        </button>
      </div>
    </header>

    <!-- Stage first in DOM so single-column stacks player then sidebar -->
    <div class="watch-body" :class="{ 'sidebar-collapsed': !sidebarOpen }">
      <section class="stage">
        <div v-if="viewMode === 'player' && embeds.length" class="tabs-bar">
          <div class="tabs">
            <button
              v-for="e in embeds"
              :key="e.platform"
              type="button"
              class="tab"
              :class="{ active: activePlatform === e.platform }"
              @click="activePlatform = e.platform"
            >
              <span
                class="dot"
                :style="{ background: PLATFORM_COLORS[e.platform] }"
              />
              {{ PLATFORM_LABELS[e.platform] }}
              <span
                v-if="isPlatformLive(e.platform)"
                class="tab-live"
              >LIVE</span>
            </button>
          </div>
          <div v-if="activeEmbed" class="tab-actions">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="!activeEmbed.playerUrl && !activeEmbed.profileUrl"
              @click="popOutEmbed('player', activeEmbed)"
            >
              Pop out stream
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              :disabled="
                !activeEmbed.chatPopoutUrl &&
                !activeEmbed.chatUrl &&
                !activeEmbed.profileUrl
              "
              :title="
                activeEmbed.chatPopoutUrl || activeEmbed.chatUrl
                  ? 'Open chat in a popup window'
                  : 'No dedicated chat URL — opens the channel page in a popup'
              "
              @click="popOutEmbed('chat', activeEmbed)"
            >
              Pop out chat
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              @click="openActiveChannel"
            >
              Open channel
            </button>
          </div>
        </div>

        <div class="stage-content">
          <div v-if="loading" class="state">Loading…</div>
          <div v-else-if="error" class="state alert alert-error stage-error">
            <p>{{ error }}</p>
            <button type="button" class="btn btn-ghost btn-sm" @click="load">
              Retry
            </button>
          </div>
          <EmbedPlayer
            v-else-if="viewMode === 'player' && activeEmbed"
            :key="activeEmbed.platform + (activeEmbed.videoId || activeEmbed.playerUrl || '')"
            :embed="activeEmbed"
            :show-chat="showInlineChat"
            :resolve-status="resolveStatusFor(activeEmbed.platform)"
            :resolve-message="resolveMessageFor(activeEmbed.platform)"
          />
          <MultiChat
            v-else-if="viewMode === 'multi-chat' && streamer"
            :embeds="multiEmbeds"
          />
          <div v-else class="state">No platforms configured for this streamer.</div>
        </div>
      </section>

      <aside class="sidebar" :aria-hidden="!sidebarOpen">
        <template v-if="streamer">
          <div class="side-section">
            <h3>Platforms</h3>
            <a
              v-for="p in streamer.platforms"
              :key="p.platform"
              class="plat-btn plat-link"
              :href="platformProfileUrl(p)"
              target="_blank"
              rel="noopener noreferrer"
              :title="`Open ${PLATFORM_LABELS[p.platform]} in a new tab`"
            >
              <span
                class="dot"
                :style="{ background: PLATFORM_COLORS[p.platform] }"
              />
              <span class="plat-name">{{ PLATFORM_LABELS[p.platform] }}</span>
              <span class="plat-user">@{{ p.username.replace(/^@/, '') }}</span>
            </a>
          </div>

          <div v-if="hasYouTube" class="side-section">
            <h3>YouTube live</h3>
            <div class="live-status">
              <span v-if="ytResolving" class="badge">Checking…</span>
              <span v-else-if="ytLive === true" class="badge badge-live">Live</span>
              <span v-else-if="ytLive === false" class="badge">Offline</span>
              <span v-else class="badge">—</span>
            </div>
            <p v-if="ytVideoId" class="hint mono">video: {{ ytVideoId }}</p>
            <p v-if="ytMessage" class="hint">{{ ytMessage }}</p>
            <p v-if="ytLastChecked" class="hint">
              Checked {{ ytLastChecked.toLocaleTimeString() }}
            </p>
            <button
              type="button"
              class="btn btn-ghost btn-sm live-refresh"
              :disabled="ytResolving"
              @click="resolveYoutube(true)"
            >
              {{ ytResolving ? 'Resolving…' : 'Refresh live status' }}
            </button>
          </div>

          <div v-if="hasRumble" class="side-section">
            <h3>Rumble live</h3>
            <div class="live-status">
              <span v-if="rumbleResolving" class="badge">Checking…</span>
              <span v-else-if="rumbleLive === true" class="badge badge-live">Live</span>
              <span v-else-if="rumbleLive === false" class="badge">Offline</span>
              <span v-else class="badge">—</span>
            </div>
            <p v-if="rumbleTitle" class="hint">{{ rumbleTitle }}</p>
            <p v-if="rumbleVideoId" class="hint mono">embed: {{ rumbleVideoId }}</p>
            <p v-if="rumbleChatId" class="hint mono">chat: {{ rumbleChatId }}</p>
            <p v-if="rumbleMessage" class="hint">{{ rumbleMessage }}</p>
            <p v-if="rumbleLastChecked" class="hint">
              Checked {{ rumbleLastChecked.toLocaleTimeString() }}
            </p>
            <button
              type="button"
              class="btn btn-ghost btn-sm live-refresh"
              :disabled="rumbleResolving"
              @click="resolveRumble(true)"
            >
              {{ rumbleResolving ? 'Resolving…' : 'Refresh live status' }}
            </button>
          </div>

          <div class="side-section">
            <h3>View options</h3>
            <label v-if="viewMode === 'player'" class="check-row opt">
              <input v-model="showInlineChat" type="checkbox" />
              Show chat beside player
            </label>
            <div v-if="viewMode === 'multi-chat'" class="multi-select">
              <p class="hint">Chats to show side-by-side:</p>
              <label
                v-for="p in streamer.platforms"
                :key="p.platform"
                class="check-row opt"
              >
                <input
                  type="checkbox"
                  :checked="multiChatPlatforms.includes(p.platform)"
                  @change="toggleMultiChat(p.platform)"
                />
                {{ PLATFORM_LABELS[p.platform] }}
              </label>
            </div>
          </div>

          <div class="side-section">
            <h3>Schedule</h3>
            <ul v-if="scheduleRows.length" class="sched-list dual">
              <li v-for="s in scheduleRows" :key="s.dayOfWeek + s.streamerDayLabel">
                <div class="sched-day-block">
                  <div class="sched-line et">
                    <span class="tz-tag">ET</span>
                    <span class="day">{{ s.easternDayLabel }}</span>
                    <span class="range">{{ s.easternRange }}</span>
                  </div>
                  <div class="sched-line streamer">
                    <span class="tz-tag streamer-tag" :title="streamer.timezone">Streamer</span>
                    <span class="day">{{ s.streamerDayLabel }}</span>
                    <span class="range">{{ s.streamerRange }}</span>
                  </div>
                </div>
              </li>
            </ul>
            <p v-if="scheduleRows.length" class="hint tz-footnote">
              Streamer = {{ streamer.timezone }}
            </p>
            <p v-else class="hint">No schedule set.</p>
          </div>

          <div v-if="streamer.notes" class="side-section">
            <h3>Notes</h3>
            <p class="notes">{{ streamer.notes }}</p>
          </div>
        </template>
        <div v-else class="side-section">
          <p class="hint">{{ loading ? 'Loading streamer…' : 'Streamer unavailable' }}</p>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.watch-layout {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  overflow: hidden;
}

.watch-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
  background: rgba(11, 13, 18, 0.92);
  backdrop-filter: blur(10px);
  flex-wrap: wrap;
  flex-shrink: 0;
  z-index: 40;
}

.left,
.right {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
}

.header-identity {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-width: 0;
}

.header-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--border);
  background: linear-gradient(145deg, #2a3550, #1a2030);
  display: grid;
  place-items: center;
  font-weight: 700;
  color: var(--accent-hover);
  flex-shrink: 0;
}

.header-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.left h1 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.2rem;
}

.mode-toggle {
  display: flex;
  gap: 0.25rem;
  padding: 0.2rem;
  background: var(--bg-card);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
}

.watch-body {
  flex: 1;
  display: grid;
  /* Stage is first in DOM; place sidebar on the left on desktop */
  grid-template-columns: 260px 1fr;
  grid-template-areas: 'sidebar stage';
  min-height: 0;
  overflow: hidden;
}

.watch-body.sidebar-collapsed {
  grid-template-columns: 1fr;
  grid-template-areas: 'stage';
}

.sidebar {
  grid-area: sidebar;
  border-right: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  padding: 1rem 0.85rem;
  overflow-y: auto;
  min-height: 0;
}

.watch-body.sidebar-collapsed .sidebar {
  display: none;
}

.side-section {
  margin-bottom: 1.25rem;
}

.side-section h3 {
  margin: 0 0 0.55rem;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-dim);
  font-weight: 700;
}

.tz {
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  color: var(--text-muted);
  font-family: var(--mono);
  font-size: 0.7rem;
}

.plat-btn {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  column-gap: 0.5rem;
  row-gap: 0.1rem;
  align-items: center;
  text-align: left;
  padding: 0.55rem 0.6rem;
  margin-bottom: 0.3rem;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text);
  text-decoration: none;
  box-sizing: border-box;
}

a.plat-link {
  cursor: pointer;
}

.plat-btn .dot {
  grid-row: 1 / 3;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.plat-btn .plat-name {
  font-weight: 600;
  font-size: 0.9rem;
}

.plat-btn .plat-user {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-family: var(--mono);
}

.plat-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-subtle);
  color: var(--text);
}

.opt {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 0.4rem;
}

.hint {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  color: var(--text-dim);
}

.hint.mono {
  font-family: var(--mono);
  font-size: 0.72rem;
  word-break: break-all;
}

.live-status {
  margin-bottom: 0.45rem;
}

.live-refresh {
  margin-top: 0.35rem;
  width: 100%;
}

.tab-live {
  margin-left: 0.35rem;
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--success);
  letter-spacing: 0.04em;
}

.sched-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.sched-list.dual li {
  padding: 0.45rem 0;
  border-bottom: 1px solid var(--border-subtle);
}

.sched-day-block {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.sched-line {
  display: grid;
  grid-template-columns: 4.25rem 2rem 1fr;
  align-items: baseline;
  gap: 0.35rem;
  font-size: 0.8rem;
}

.tz-tag {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--accent-hover);
  background: var(--accent-soft);
  border-radius: 4px;
  padding: 0.05rem 0.28rem;
  text-align: center;
  white-space: nowrap;
}

.tz-tag.streamer-tag {
  color: var(--text-muted);
  background: var(--bg-hover);
}

.day {
  font-weight: 600;
  color: var(--text-muted);
}

.range {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text);
  text-align: right;
}

.tz-footnote {
  margin-top: 0.45rem;
  word-break: break-all;
}

.notes {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-muted);
  white-space: pre-wrap;
}

.stage {
  grid-area: stage;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.tabs-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border-subtle);
  padding-right: 0.5rem;
}

.tabs-bar .tabs {
  flex: 1;
  min-width: 0;
  border-bottom: none;
}

.tab-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0;
  flex-shrink: 0;
}

.stage-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.stage-content > * {
  flex: 1;
  min-height: 0;
}

.state {
  padding: 2rem;
  text-align: center;
  color: var(--text-muted);
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}

.stage-error {
  margin: 1rem;
  max-width: 480px;
  align-self: center;
}

@media (max-width: 860px) {
  .sidebar-toggle {
    display: none;
  }

  /* Stacked layout: allow page scroll so sidebar remains reachable */
  .watch-layout {
    height: auto;
    min-height: 100vh;
    min-height: 100dvh;
    overflow: visible;
  }

  .watch-body,
  .watch-body.sidebar-collapsed {
    grid-template-columns: 1fr;
    /* Stage first, sidebar after (DOM order already stage → sidebar) */
    grid-template-areas:
      'stage'
      'sidebar';
    overflow: visible;
  }

  .watch-body.sidebar-collapsed .sidebar {
    display: block;
  }

  .sidebar {
    border-right: none;
    border-top: 1px solid var(--border-subtle);
    border-bottom: none;
  }

  .stage {
    min-height: 70vh;
    overflow: visible;
  }
}
</style>
