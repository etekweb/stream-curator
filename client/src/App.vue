<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { computed } from 'vue';

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
      <nav class="header-actions">
        <RouterLink to="/" class="btn btn-ghost btn-sm">Dashboard</RouterLink>
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
  gap: 0.5rem;
  align-items: center;
}
</style>
