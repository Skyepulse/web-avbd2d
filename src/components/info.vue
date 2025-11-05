<template>
    <div id="vertical-flex-box" class="flex flex-col space-y-2 mb-2">
        <div id="cpu-frame-time" class="flex flex-row space-x-1">
            <label>CPU Frame Time:</label>
            <span id="cpuFrameTimeValue" ref="cpuFrameTimeValue">0.0 ms</span>
        </div>
        <div id="gpu-frame-time" class="flex flex-row space-x-1">
            <label>GPU Frame Time:</label>
            <span id="gpuFrameTimeValue" ref="gpuFrameTimeValue">0.0 ms</span>
        </div>
        <div id="cpu-solver-time" class="flex flex-row space-x-1">
            <label>CPU Solver Time:</label>
            <span id="cpuSolverTimeValue" ref="cpuSolverTimeValue">0.0 ms</span>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { ref, watch, onMounted, onUnmounted } from 'vue';    
    import GameManager from './src/game/GameManager';
    import type { performanceInformation } from './src/game/GameManager';

    // ================================== //
    const props = defineProps<{
        gameManager: GameManager;
    }>();

    // ================================== //
    const gameManager = ref(props.gameManager);

    // ================================== //
    watch(() => props.gameManager, (newGameManager) => {
        gameManager.value = newGameManager;
    });

    // ================================== //
    const cpuFrameTimeValue = ref<HTMLLabelElement | null>(null);
    const gpuFrameTimeValue = ref<HTMLLabelElement | null>(null);
    const cpuSolverTimeValue = ref<HTMLLabelElement | null>(null);
    const rafId = ref<number | null>(null);

    // ================================== //
    function updateInfoValues()
    {
        if (!gameManager.value) return;

        const values: performanceInformation = gameManager.value.getPerformances();

        if (cpuFrameTimeValue.value) cpuFrameTimeValue.value.textContent = `${values.cpuFrameTime.toFixed(2)} ms`;
        if (gpuFrameTimeValue.value) gpuFrameTimeValue.value.textContent = `${values.gpuFrameTime.toFixed(2)} ms`;
        if (cpuSolverTimeValue.value) cpuSolverTimeValue.value.textContent = `${values.cpuSolverTime.toFixed(2)} ms`;
    }

    // ================================== //
    function tick() {
        updateInfoValues();
        rafId.value = requestAnimationFrame(tick);
    }

    // ================================== //
    onMounted(() => {
        tick();
    });

    // ================================== //
    onUnmounted(() => {
        if (rafId.value !== null) {
            cancelAnimationFrame(rafId.value);
            rafId.value = null;
        }
    });
</script>