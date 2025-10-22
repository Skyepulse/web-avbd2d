<template>
  <canvas id="webgpuCanvas" ref="webgpuCanvas" class="w-full h-full"></canvas>
</template>

<script setup lang="ts">
  import { ref, onMounted } from 'vue';
  import { startupGame } from './components/main';

  const webgpuCanvas = ref<HTMLCanvasElement | null>(null);
  const currentRenderer = ref<any>(null);

  //================================//
  async function startGame() {

      if (currentRenderer.value && typeof currentRenderer.value.cleanup === 'function') {
          await currentRenderer.value.cleanup();
          currentRenderer.value = null;
      }

      if (webgpuCanvas.value) {
          const fn = startupGame;
          if (fn) currentRenderer.value = await fn(webgpuCanvas.value);
      }
  }

  //================================//
  onMounted(() => {
      startGame();
  });
</script>