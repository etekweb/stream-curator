<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { EmbedUrls, Platform, Streamer, StreamerPlatform } from '../types';
import { PLATFORM_COLORS, PLATFORM_LABELS } from '../types';
import { resolveRumbleLive, resolveYouTubeLive } from '../api/client';
import { buildEmbedUrls, popOutEmbed } from '../utils/embeds';

const props = defineProps<{
  streamer: Streamer;
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  close: [];
}>();

const router = useRouter();
const root = ref<HTMLElement | null>(null);
const pos = ref({ left: 0, top: 0 });

type ResolveState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  live: boolean | null;
  videoId: string | null;
  chatId: string | null;
  chatUrl: string | null;
  watchUrl: string | null;
  playerUrl: string | null;
  message: string | null;
};

function emptyResolve(): ResolveState {
  return {
    status: 'idle',
    live: null,
    videoId: null,
    chatId: null,
    chatUrl: null,
    watchUrl: null,
    playerUrl: null,
    message: null,
  };
}

const ytResolve = ref<ResolveState>(emptyResolve());
const rumbleResolve = ref<ResolveState>(emptyResolve());
/** Platform currently waiting on a chat open after resolve */
const chatOpening = ref<Platform | null>(null);
/** In-flight resolve promises so chat clicks can await the same query */
let ytInflight: Promise<void> | null = null;
let rumbleInflight: Promise<void> | null = null;

const platforms = computed(() =>
  [...props.streamer.platforms].sort((a, b) => {
    const ap = a.is_primary ? 0 : 1;
    const bp = b.is_primary ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return PLATFORM_LABELS[a.platform].localeCompare(PLATFORM_LABELS[b.platform]);
  })
);

function platformOf(kind: Platform): StreamerPlatform | undefined {
  return props.streamer.platforms.find((p) => p.platform === kind);
}

function embedFor(p: StreamerPlatform): EmbedUrls {
  if (p.platform === 'youtube') {
    return buildEmbedUrls(
      p.platform,
      p.username,
      p.external_id,
      ytResolve.value.videoId
    );
  }
  if (p.platform === 'rumble') {
    return buildEmbedUrls(
      p.platform,
      p.username,
      p.external_id,
      rumbleResolve.value.videoId,
      rumbleResolve.value.chatId
    );
  }
  return buildEmbedUrls(p.platform, p.username, p.external_id);
}

function canPlayIntegrated(_p: StreamerPlatform): boolean {
  return true;
}

function canPopStream(p: StreamerPlatform): boolean {
  const e = embedFor(p);
  if (p.platform === 'youtube' && ytResolve.value.watchUrl) return true;
  if (p.platform === 'rumble' && rumbleResolve.value.watchUrl) return true;
  return Boolean(e.profileUrl || e.playerUrl);
}

/** Whether chat is known available without needing another query. */
function chatReady(p: StreamerPlatform): boolean {
  if (p.platform === 'youtube') {
    const e = embedFor(p);
    return Boolean(ytResolve.value.chatUrl || e.chatUrl || e.chatPopoutUrl);
  }
  if (p.platform === 'rumble') {
    const e = embedFor(p);
    return Boolean(
      rumbleResolve.value.chatUrl || e.chatUrl || e.chatPopoutUrl
    );
  }
  const e = embedFor(p);
  return Boolean(e.chatPopoutUrl || e.chatUrl);
}

function chatResolving(p: StreamerPlatform): boolean {
  if (p.platform === 'youtube') return ytResolve.value.status === 'loading';
  if (p.platform === 'rumble') return rumbleResolve.value.status === 'loading';
  return false;
}

/**
 * Chat button enabled when:
 * - Twitch/Kick: chat URL always available
 * - YouTube/Rumble: while resolving, or once a live chat URL is known
 * - X: never
 */
function canPopChat(p: StreamerPlatform): boolean {
  if (p.platform === 'x') return false;
  if (p.platform === 'youtube' || p.platform === 'rumble') {
    if (chatReady(p)) return true;
    // Still looking up live — allow click to wait on the query
    if (chatResolving(p) || chatOpening.value === p.platform) return true;
    // Resolve finished with no stream/chat → gray out
    const st =
      p.platform === 'youtube' ? ytResolve.value.status : rumbleResolve.value.status;
    if (st === 'done' || st === 'error') return false;
    // idle / not started yet — allow (open will kick off resolve)
    return true;
  }
  return chatReady(p);
}

function chatTitle(p: StreamerPlatform): string {
  if (p.platform === 'x') return 'Chat not available on X';
  if (p.platform === 'youtube') {
    if (ytResolve.value.status === 'loading' || chatOpening.value === 'youtube') {
      return 'Resolving YouTube live chat…';
    }
    if (chatReady(p)) return 'Open chat in new window';
    if (ytResolve.value.status === 'done' && !ytResolve.value.live) {
      return ytResolve.value.message || 'Not live — no chat';
    }
    if (ytResolve.value.status === 'error') {
      return ytResolve.value.message || 'Could not resolve YouTube chat';
    }
    return 'Open chat in new window';
  }
  if (p.platform === 'rumble') {
    if (rumbleResolve.value.status === 'loading' || chatOpening.value === 'rumble') {
      return 'Resolving Rumble live chat…';
    }
    if (chatReady(p)) return 'Open chat in new window';
    if (rumbleResolve.value.status === 'done' && !rumbleResolve.value.live) {
      return rumbleResolve.value.message || 'Not live — no chat';
    }
    if (rumbleResolve.value.status === 'error') {
      return rumbleResolve.value.message || 'Could not resolve Rumble chat';
    }
    return 'Open chat in new window';
  }
  if (!chatReady(p)) return 'Chat not available';
  return 'Open chat in new window';
}

async function resolveYouTube(refresh = false): Promise<void> {
  const p = platformOf('youtube');
  if (!p) return;
  // Reuse in-flight query unless a forced refresh is requested mid-flight
  if (ytInflight && !refresh) {
    await ytInflight;
    return;
  }
  if (ytInflight && refresh) {
    await ytInflight;
  }

  ytResolve.value = {
    ...ytResolve.value,
    status: 'loading',
    message: null,
  };

  ytInflight = (async () => {
    try {
      const result = await resolveYouTubeLive({
        username: p.username,
        channelId: p.external_id,
        refresh,
      });
      ytResolve.value = {
        status: 'done',
        live: result.live,
        videoId: result.videoId,
        chatId: null,
        chatUrl: result.chatUrl,
        watchUrl: result.watchUrl,
        playerUrl: result.playerUrl,
        message: result.message || null,
      };
    } catch (e) {
      ytResolve.value = {
        ...emptyResolve(),
        status: 'error',
        message: e instanceof Error ? e.message : 'YouTube resolve failed',
      };
    } finally {
      ytInflight = null;
    }
  })();

  await ytInflight;
}

async function resolveRumble(refresh = false): Promise<void> {
  const p = platformOf('rumble');
  if (!p) return;
  if (rumbleInflight && !refresh) {
    await rumbleInflight;
    return;
  }
  if (rumbleInflight && refresh) {
    await rumbleInflight;
  }

  rumbleResolve.value = {
    ...rumbleResolve.value,
    status: 'loading',
    message: null,
  };

  rumbleInflight = (async () => {
    try {
      const result = await resolveRumbleLive({
        username: p.username,
        refresh,
      });
      rumbleResolve.value = {
        status: 'done',
        live: result.live,
        videoId: result.videoId,
        chatId: result.chatId,
        chatUrl: result.chatUrl,
        watchUrl: result.watchUrl,
        playerUrl: result.playerUrl,
        message: result.message || null,
      };
    } catch (e) {
      rumbleResolve.value = {
        ...emptyResolve(),
        status: 'error',
        message: e instanceof Error ? e.message : 'Rumble resolve failed',
      };
    } finally {
      rumbleInflight = null;
    }
  })();

  await rumbleInflight;
}

/** Kick off live resolves for YT/Rumble when the menu opens. */
function startLiveResolves() {
  ytInflight = null;
  rumbleInflight = null;
  ytResolve.value = emptyResolve();
  rumbleResolve.value = emptyResolve();
  chatOpening.value = null;
  if (platformOf('youtube')) void resolveYouTube(false);
  if (platformOf('rumble')) void resolveRumble(false);
}

function openIntegrated(p: StreamerPlatform) {
  emit('close');
  void router.push({
    name: 'streamer',
    params: { id: props.streamer.id },
    query: { platform: p.platform, mode: 'player' },
  });
}

function openStreamTab(p: StreamerPlatform) {
  // Prefer live watch URL when resolved; keep menu open
  let url: string | null = null;
  if (p.platform === 'youtube' && ytResolve.value.watchUrl) {
    url = ytResolve.value.watchUrl;
  } else if (p.platform === 'rumble' && rumbleResolve.value.watchUrl) {
    url = rumbleResolve.value.watchUrl;
  } else {
    const e = embedFor(p);
    url = e.profileUrl || e.playerUrl;
  }
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function ensureChatEmbed(p: StreamerPlatform): Promise<EmbedUrls | null> {
  if (p.platform === 'youtube') {
    chatOpening.value = 'youtube';
    try {
      if (!chatReady(p)) {
        // Wait for in-flight open query, or re-query if done/error without chat
        const needRefresh = ytResolve.value.status === 'done' || ytResolve.value.status === 'error';
        await resolveYouTube(needRefresh);
      } else if (ytResolve.value.status === 'loading' || ytInflight) {
        await resolveYouTube(false);
      }
    } finally {
      chatOpening.value = null;
    }
    const e = embedFor(p);
    if (ytResolve.value.chatUrl) {
      return {
        ...e,
        chatUrl: ytResolve.value.chatUrl,
        chatPopoutUrl: ytResolve.value.chatUrl,
      };
    }
    if (e.chatUrl || e.chatPopoutUrl) return e;
    return null;
  }

  if (p.platform === 'rumble') {
    chatOpening.value = 'rumble';
    try {
      if (!chatReady(p)) {
        const needRefresh =
          rumbleResolve.value.status === 'done' || rumbleResolve.value.status === 'error';
        await resolveRumble(needRefresh);
      } else if (rumbleResolve.value.status === 'loading' || rumbleInflight) {
        await resolveRumble(false);
      }
    } finally {
      chatOpening.value = null;
    }
    const e = embedFor(p);
    if (rumbleResolve.value.chatUrl) {
      return {
        ...e,
        chatUrl: rumbleResolve.value.chatUrl,
        chatPopoutUrl: rumbleResolve.value.chatUrl,
      };
    }
    if (e.chatUrl || e.chatPopoutUrl) return e;
    return null;
  }

  const e = embedFor(p);
  if (e.chatPopoutUrl || e.chatUrl) return e;
  return null;
}

async function openChatWindow(p: StreamerPlatform) {
  // Keep menu open for pop-outs
  const embed = await ensureChatEmbed(p);
  if (!embed) return;
  popOutEmbed('chat', embed);
}

function clampPosition() {
  const el = root.value;
  if (!el) return;
  const pad = 8;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let left = props.x;
  let top = props.y;
  if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;
  if (top + h > window.innerHeight - pad) top = window.innerHeight - h - pad;
  left = Math.max(pad, left);
  top = Math.max(pad, top);
  pos.value = { left, top };
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}

function onPointerDownOutside(e: PointerEvent) {
  const t = e.target as Node | null;
  if (root.value && t && !root.value.contains(t)) emit('close');
}

watch(
  () => [props.x, props.y, props.streamer.id] as const,
  async () => {
    await nextTick();
    clampPosition();
  },
  { immediate: true }
);

watch(
  () => props.streamer.id,
  () => {
    startLiveResolves();
  },
  { immediate: true }
);

// Re-clamp when resolve finishes (row status text may change height slightly)
watch([ytResolve, rumbleResolve], async () => {
  await nextTick();
  clampPosition();
});

onMounted(async () => {
  await nextTick();
  clampPosition();
  window.addEventListener('keydown', onKeydown);
  window.setTimeout(() => {
    window.addEventListener('pointerdown', onPointerDownOutside, true);
  }, 0);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('pointerdown', onPointerDownOutside, true);
});

function platformStyle(platform: Platform) {
  return { '--platform-color': PLATFORM_COLORS[platform] };
}

function showChatSpinner(p: StreamerPlatform): boolean {
  return chatResolving(p) || chatOpening.value === p.platform;
}

function chatDisabled(p: StreamerPlatform): boolean {
  return !canPopChat(p);
}

/** Platforms confirmed live (for header badges). */
const livePlatforms = computed(() => {
  const list: Platform[] = [];
  if (ytResolve.value.live && platformOf('youtube')) list.push('youtube');
  if (rumbleResolve.value.live && platformOf('rumble')) list.push('rumble');
  return list;
});

const isResolvingLive = computed(
  () =>
    ytResolve.value.status === 'loading' || rumbleResolve.value.status === 'loading'
);
</script>

<template>
  <Teleport to="body">
    <div
      ref="root"
      class="streamer-menu"
      role="menu"
      :aria-label="`${streamer.display_name} platforms`"
      :style="{ left: pos.left + 'px', top: pos.top + 'px' }"
      @contextmenu.prevent
    >
      <header class="menu-head">
        <div class="avatar" aria-hidden="true">
          <img
            v-if="streamer.avatar_url"
            :src="streamer.avatar_url"
            alt=""
            class="avatar-img"
          />
          <span v-else>{{ streamer.display_name.slice(0, 1).toUpperCase() }}</span>
        </div>
        <div class="head-text">
          <div class="name-row">
            <div class="name">{{ streamer.display_name }}</div>
            <div v-if="livePlatforms.length" class="live-badges" aria-label="Live now">
              <span
                v-for="plat in livePlatforms"
                :key="plat"
                class="live-badge"
                :style="{ '--platform-color': PLATFORM_COLORS[plat] }"
                :title="`${PLATFORM_LABELS[plat]} is live`"
              >
                <span class="live-dot" aria-hidden="true" />
                LIVE
              </span>
            </div>
            <span
              v-else-if="isResolvingLive"
              class="live-checking"
              title="Checking live status"
            >…</span>
          </div>
          <div class="sub">Open platform</div>
        </div>
      </header>

      <ul class="menu-list">
        <li
          v-for="p in platforms"
          :key="p.platform"
          class="menu-row"
          :style="platformStyle(p.platform)"
          role="none"
        >
          <div class="plat-meta">
            <span class="plat-dot" aria-hidden="true" />
            <span class="plat-name">{{ PLATFORM_LABELS[p.platform] }}</span>
            <span class="plat-user">@{{ p.username.replace(/^@/, '') }}</span>
          </div>
          <div class="actions" role="group" :aria-label="PLATFORM_LABELS[p.platform]">
            <button
              type="button"
              class="icon-btn"
              role="menuitem"
              title="Play in integrated player"
              aria-label="Play in integrated player"
              :disabled="!canPlayIntegrated(p)"
              @click="openIntegrated(p)"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86a1 1 0 0 0-1.5.86z"
                />
              </svg>
            </button>
            <button
              type="button"
              class="icon-btn"
              role="menuitem"
              title="Open stream in new tab"
              aria-label="Open stream in new tab"
              :disabled="!canPopStream(p)"
              @click="openStreamTab(p)"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z"
                />
              </svg>
            </button>
            <button
              type="button"
              class="icon-btn"
              :class="{ busy: showChatSpinner(p) }"
              role="menuitem"
              :title="chatTitle(p)"
              :aria-label="chatTitle(p)"
              :disabled="chatDisabled(p)"
              @click="openChatWindow(p)"
            >
              <span v-if="showChatSpinner(p)" class="spin" aria-hidden="true" />
              <svg
                v-else
                viewBox="0 0 24 24"
                width="16"
                height="16"
                aria-hidden="true"
              >
                <path
                  fill="currentColor"
                  d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm2 4v2h12V8H6zm0 4v2h8v-2H6z"
                />
              </svg>
            </button>
          </div>
        </li>
      </ul>

      <p v-if="platforms.length === 0" class="empty">No platforms linked</p>
    </div>
  </Teleport>
</template>

<style scoped>
.streamer-menu {
  position: fixed;
  z-index: 10050;
  min-width: 280px;
  max-width: min(360px, calc(100vw - 16px));
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
  overflow: hidden;
  animation: menu-in 0.12s ease-out;
}

@keyframes menu-in {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.menu-head {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.75rem 0.85rem;
  border-bottom: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--bg-card) 80%, transparent);
}

.avatar {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: linear-gradient(145deg, #2a3550, #1a2030);
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
  font-weight: 700;
  color: var(--accent-hover);
  flex-shrink: 0;
  overflow: hidden;
  font-size: 0.9rem;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.head-text {
  min-width: 0;
}

.name-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
  min-width: 0;
}

.name {
  font-weight: 700;
  font-size: 0.95rem;
  letter-spacing: -0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.live-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  align-items: center;
}

.live-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  padding: 0.12rem 0.4rem 0.12rem 0.32rem;
  border-radius: 999px;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--platform-color);
  background: color-mix(in srgb, var(--platform-color) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--platform-color) 35%, transparent);
  white-space: nowrap;
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--platform-color);
  box-shadow: 0 0 8px color-mix(in srgb, var(--platform-color) 70%, transparent);
  animation: live-pulse 1.5s ease-in-out infinite;
}

@keyframes live-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.live-checking {
  font-size: 0.75rem;
  color: var(--text-dim);
  letter-spacing: 0.08em;
}

.sub {
  font-size: 0.72rem;
  color: var(--text-dim);
  margin-top: 0.1rem;
}

.menu-list {
  list-style: none;
  margin: 0;
  padding: 0.35rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.menu-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.4rem 0.45rem 0.4rem 0.55rem;
  border-radius: 8px;
}

.menu-row:hover {
  background: var(--bg-hover);
}

.plat-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  flex: 1;
}

.plat-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--platform-color);
  box-shadow: 0 0 8px color-mix(in srgb, var(--platform-color) 45%, transparent);
  flex-shrink: 0;
}

.plat-name {
  font-weight: 650;
  font-size: 0.86rem;
  color: var(--text);
  flex-shrink: 0;
}

.plat-user {
  font-size: 0.75rem;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.actions {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  flex-shrink: 0;
}

.icon-btn {
  width: 2rem;
  height: 2rem;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  padding: 0;
}

.icon-btn:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent-hover);
  border-color: color-mix(in srgb, var(--accent) 30%, transparent);
}

.icon-btn:disabled {
  opacity: 0.28;
  cursor: not-allowed;
}

.icon-btn.busy {
  opacity: 1;
  color: var(--accent-hover);
}

.spin {
  width: 14px;
  height: 14px;
  border: 2px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-top-color: var(--accent-hover);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.empty {
  margin: 0;
  padding: 0.85rem 1rem;
  font-size: 0.85rem;
  color: var(--text-dim);
  text-align: center;
}
</style>
