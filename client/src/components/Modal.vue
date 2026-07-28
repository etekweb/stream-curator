<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';

defineProps<{
  title: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2>{{ title }}</h2>
        <button type="button" class="btn btn-ghost btn-icon" aria-label="Close" @click="emit('close')">
          ✕
        </button>
      </div>
      <div class="modal-body">
        <slot />
      </div>
    </div>
  </div>
</template>
