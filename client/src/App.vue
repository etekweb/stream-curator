<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { computed } from 'vue';
import {
  PLATFORMS,
  PLATFORM_COLORS,
  PLATFORM_FOLLOW_PAGES,
  PLATFORM_LABELS,
} from './types';

const route = useRoute();
const isWatch = computed(() => route.name === 'streamer');
</script>

<template>
  <div class="app-shell">
    <header v-if="!isWatch" class="app-header">
      <RouterLink to="/" class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 8v8M8 5v14M12 9v6M16 6v12M20 10v4" stroke-linecap="round" />
          </svg>
        </span>
        Stream Curator
      </RouterLink>
      <nav class="header-actions" aria-label="Platform following pages">
        <a
          v-for="p in PLATFORMS"
          :key="p"
          class="platform-launch"
          :href="PLATFORM_FOLLOW_PAGES[p].url"
          :style="{ '--platform-color': PLATFORM_COLORS[p] }"
          target="_blank"
          rel="noopener noreferrer"
          :title="`Open ${PLATFORM_LABELS[p]} ${PLATFORM_FOLLOW_PAGES[p].pageLabel.toLowerCase()}`"
        >
          {{ PLATFORM_LABELS[p] }}
        </a>
      </nav>
    </header>
    <main class="app-main" :class="{ 'full-width': isWatch }">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
  justify-content: flex-end;
}

.platform-launch {
  display: inline-flex;
  align-items: center;
  padding: 0.28rem 0.65rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
  line-height: 1.2;
  color: var(--platform-color);
  background: color-mix(in srgb, var(--platform-color) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--platform-color) 38%, transparent);
  transition: background 0.15s, border-color 0.15s, transform 0.1s;
}

.platform-launch:hover {
  color: var(--platform-color);
  background: color-mix(in srgb, var(--platform-color) 26%, transparent);
  border-color: color-mix(in srgb, var(--platform-color) 55%, transparent);
}

.platform-launch:active {
  transform: scale(0.97);
}
</style>
