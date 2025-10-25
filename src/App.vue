<template>
  <canvas id="webgpuCanvas" ref="webgpuCanvas" class="w-full h-full"></canvas>

  <!-- Utils -->
  <div id="utils" class="absolute top-2 left-2 z-10 bg-gray-800 p-2 rounded">
    <utils v-if="gameManager" :gameManager="gameManager" />
  </div>
</template>

<script setup lang="ts">
  import { ref, onMounted } from 'vue';
  import { shallowRef } from 'vue';
  import { startupGame } from './components/main';
  import GameManager from './components/src/game/GameManager';
  import utils from './components/utils.vue';
  
  const webgpuCanvas = ref<HTMLCanvasElement | null>(null);
  const gameManager = shallowRef<GameManager | null>(null);

  //================================//
  async function startGame() {

      if (gameManager.value) {
          await gameManager.value.cleanup();
          gameManager.value = null;
      }

      if (webgpuCanvas.value) {
          gameManager.value = await startupGame(webgpuCanvas.value);
      }
  }

  //================================//
  onMounted(() => {
      startGame();
  });
</script>