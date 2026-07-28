<script setup lang="ts">
import { computed } from 'vue';
import type { EmbedUrls } from '../types';
import { PLATFORM_LABELS } from '../types';
import { popOutEmbed } from '../utils/embeds';

const props = defineProps<{
  embed: EmbedUrls;
  showChat?: boolean;
  /** Optional status while live-resolving (youtube/rumble) */
  resolveStatus?: 'idle' | 'checking' | 'live' | 'offline' | 'error';
  resolveMessage?: string | null;
}>();

const showPlayerIframe = computed(
  () => Boolean(props.embed.playerUrl && props.embed.supportsPlayerEmbed)
);

/** Only split layout when chat can actually embed */
const showChatPanel = computed(
  () =>
    Boolean(
      props.showChat &&
        props.embed.supportsChatEmbed &&
        props.embed.chatUrl
    )
);

const playerFallbackText = computed(() => {
  if (props.resolveStatus === 'checking') {
    return 'Checking for a live stream…';
  }
  if (props.resolveStatus === 'offline') {
    return (
      props.resolveMessage ||
      `${PLATFORM_LABELS[props.embed.platform]} does not appear to be live right now.`
    );
  }
  if (props.resolveStatus === 'error') {
    return (
      props.resolveMessage ||
      `Could not resolve ${PLATFORM_LABELS[props.embed.platform]} live stream.`
    );
  }
  // Avoid showing chat-oriented notes in the player pane
  if (
    props.embed.notes &&
    !/chat/i.test(props.embed.notes) &&
    !/open channel for chat/i.test(props.embed.notes)
  ) {
    return props.embed.notes;
  }
  return `${PLATFORM_LABELS[props.embed.platform]} player is not available yet.`;
});

function openProfile() {
  window.open(props.embed.profileUrl, '_blank', 'noopener,noreferrer');
}
</script>

<template>
  <div class="embed-player">
    <div class="player-stage" :class="{ 'with-chat': showChatPanel }">
      <div class="player-frame">
        <iframe
          v-if="showPlayerIframe"
          :key="embed.playerUrl || embed.platform"
          :src="embed.playerUrl!"
          :title="`${PLATFORM_LABELS[embed.platform]} player`"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerpolicy="strict-origin-when-cross-origin"
          frameborder="0"
          scrolling="no"
        />
        <div v-else class="fallback">
          <p>{{ playerFallbackText }}</p>
          <button type="button" class="btn btn-primary" @click="openProfile">
            Open on {{ PLATFORM_LABELS[embed.platform] }}
          </button>
          <button
            type="button"
            class="btn btn-ghost"
            @click="popOutEmbed('player', embed)"
          >
            Pop out
          </button>
        </div>
      </div>

      <div v-if="showChatPanel" class="chat-frame">
        <iframe
          :key="embed.chatUrl || ''"
          :src="embed.chatUrl!"
          :title="`${PLATFORM_LABELS[embed.platform]} chat`"
          frameborder="0"
        />
      </div>
    </div>

    <p
      v-if="showChat && !embed.supportsChatEmbed"
      class="chat-unavailable"
    >
      Chat is not embeddable for {{ PLATFORM_LABELS[embed.platform] }} —
      <button type="button" class="linkish" @click="popOutEmbed('chat', embed)">
        pop out chat
      </button>
      (opens channel)
      or
      <button type="button" class="linkish" @click="openProfile">open channel</button>.
    </p>
  </div>
</template>

<style scoped>
.embed-player {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #000;
}

.player-stage {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr;
  min-height: 0;
  height: 100%;
}

.player-stage.with-chat {
  grid-template-columns: 1fr minmax(280px, 340px);
}

.player-frame,
.chat-frame {
  min-height: 0;
  position: relative;
  background: #0a0a0a;
  height: 100%;
}

/* Fill the stage when chat is not beside the player */
.player-stage:not(.with-chat) .player-frame {
  min-height: min(70vh, 100%);
}

.player-stage.with-chat .player-frame,
.player-stage.with-chat .chat-frame {
  height: 100%;
}

iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}

.fallback {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 1.5rem;
  text-align: center;
  color: var(--text-muted);
  background: var(--bg-card);
}

.fallback p {
  margin: 0;
  max-width: 360px;
  font-size: 0.9rem;
}

.chat-unavailable {
  flex-shrink: 0;
  margin: 0;
  padding: 0.45rem 0.75rem;
  font-size: 0.8rem;
  color: var(--text-dim);
  background: var(--bg-elevated);
  border-top: 1px solid var(--border-subtle);
}

.linkish {
  background: none;
  border: none;
  padding: 0;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
}

@media (max-width: 900px) {
  .player-stage.with-chat {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(220px, 50vh) minmax(240px, 40vh);
  }
}
</style>
