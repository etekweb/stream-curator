<script setup lang="ts">
import { PLATFORM_COLORS, PLATFORM_LABELS, type Platform } from '../types';

defineProps<{
  platform: Platform;
  username?: string;
}>();
</script>

<template>
  <span
    class="platform-pill"
    :style="{ '--platform-color': PLATFORM_COLORS[platform] }"
    :title="username ? `${PLATFORM_LABELS[platform]}: ${username}` : PLATFORM_LABELS[platform]"
  >
    {{ PLATFORM_LABELS[platform] }}
    <span v-if="username" class="uname">@{{ username.replace(/^@/, '') }}</span>
  </span>
</template>

<style scoped>
.uname {
  opacity: 0.75;
  font-weight: 500;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
