<script setup lang="ts">
import type { EmbedUrls } from '../types';
import { PLATFORM_LABELS, PLATFORM_COLORS } from '../types';
import { popOutEmbed } from '../utils/embeds';

defineProps<{
  embeds: EmbedUrls[];
}>();
</script>

<template>
  <div class="multi-chat">
    <div
      v-for="embed in embeds"
      :key="embed.platform"
      class="chat-col"
    >
      <div
        class="chat-header"
        :style="{ borderColor: PLATFORM_COLORS[embed.platform] }"
      >
        <span
          class="dot"
          :style="{ background: PLATFORM_COLORS[embed.platform] }"
        />
        <strong>{{ PLATFORM_LABELS[embed.platform] }}</strong>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          @click="popOutEmbed('chat', embed)"
        >
          Pop out
        </button>
      </div>
      <div class="chat-body">
        <iframe
          v-if="embed.supportsChatEmbed && embed.chatUrl"
          :src="embed.chatUrl"
          :title="`${PLATFORM_LABELS[embed.platform]} chat`"
          frameborder="0"
        />
        <div v-else class="no-chat">
          <p>Chat embed not available for this platform.</p>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            @click="popOutEmbed('chat', embed)"
          >
            Pop out chat
          </button>
          <a
            :href="embed.profileUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-ghost btn-sm"
          >
            Open {{ PLATFORM_LABELS[embed.platform] }}
          </a>
        </div>
      </div>
    </div>
    <div v-if="embeds.length === 0" class="empty">No platforms configured.</div>
  </div>
</template>

<style scoped>
.multi-chat {
  display: flex;
  gap: 0.5rem;
  height: 100%;
  min-height: 360px;
  padding: 0.5rem;
  overflow-x: auto;
  background: var(--bg);
}

.chat-col {
  flex: 1 1 280px;
  min-width: 260px;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--bg-card);
}

.chat-header {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.6rem;
  border-bottom: 2px solid;
  background: var(--bg-elevated);
  font-size: 0.85rem;
}

.chat-header strong {
  flex: 1;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.chat-body {
  flex: 1;
  position: relative;
  min-height: 300px;
}

iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}

.no-chat {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: var(--text-muted);
  font-size: 0.85rem;
  padding: 1rem;
  text-align: center;
}

.empty {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--text-muted);
}
</style>
