<template>
    <div id="vertical-flex-box" class="flex flex-col space-y-2 mb-2">
        <button
            id="restart-button"
            class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-1 px-2 rounded"
            @click="resetGame()"
        >
            Restart Game
        </button>
        <label>
            Solver Values:
        </label>
        <div id="gravity-picker" class="flex flex-row space-x-1">
            <label>Gravity:</label>
            <input
            ref="gravityYInput"
            id="gravityy"
            type="range"
            min="-20"
            max="20"
            value="-9.8"
            @input="setGravityLabel()"
            @change="setGravity()"
            />
            <label id="gravityValue" ref="gravityLabel">-9.81</label>
        </div>
        <div id="alpha-picker" class="flex flex-row space-x-1" v-if ="gameManager && !gameManager.getPostStabilization()">
            <label>Alpha:</label>
            <input
            ref="alphaInput"
            id="alpha"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value="0.99"
            @input="setAlphaLabel()"
            @change="setAlpha()"
            />
            <label id="alphaValue" ref="alphaLabel">0.99</label>
        </div>
        <div id="post-stab-picker" class="flex flex-row space-x-1">
            <label for="post-stabilization">Post Stabilization:</label>
            <input
            id="post-stabilization"
            type="checkbox"
            :checked="gameManager ? gameManager.getPostStabilization() : false"
            @change="(event) => { if (gameManager) { gameManager.modifyPostStabilization((event.target as HTMLInputElement).checked); } }"
            />
        </div>
        <div id="beta-picker" class="flex flex-row space-x-1">
            <label for="beta">Beta:</label>
            <input
            ref="betaInput"
            id="beta"
            type="range"
            min="0"
            max="1"
            step="0.001"
            value="0.8333"
            @input="setBetaLabel()"
            @change="setBeta()"
            />
            <label id="betaValue" ref="betaLabel">100000.0</label>
        </div>
        <div id="gamma-picker" class="flex flex-row space-x-1">
            <label for="gamma">Gamma:</label>
            <input
            ref="gammaInput"
            id="gamma"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value="0.99"
            @input="setGammaLabel()"
            @change="setGamma()"
            />
            <label id="gammaValue" ref="gammaLabel">0.99</label>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { defineProps, ref, watch, onMounted } from 'vue';
    import GameManager from './src/game/GameManager';

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

    const gravityLabel = ref<HTMLLabelElement | null>(null);
    const gravityYInput = ref<HTMLInputElement | null>(null);

    const alphaLabel = ref<HTMLLabelElement | null>(null);
    const alphaInput = ref<HTMLInputElement | null>(null);

    const betaLabel = ref<HTMLLabelElement | null>(null);
    const betaInput = ref<HTMLInputElement | null>(null);

    const gammaLabel = ref<HTMLLabelElement | null>(null);
    const gammaInput = ref<HTMLInputElement | null>(null);

    // ================================== //
    onMounted(() => {
        initializeValues();
    });

    // ================================== //
    function initializeValues()
    {
        betaLabel.value!.textContent =  betaToSlider(100000).toFixed(3);
        betaInput.value!.value = betaToSlider(100000).toString();

        gammaLabel.value!.textContent =  "0.99";
        gammaInput.value!.value = "0.99";

        alphaLabel.value!.textContent =  "0.99";
        alphaInput.value!.value = "0.99";

        gravityLabel.value!.textContent = "-9.81";
        gravityYInput.value!.value = "-9.81";
    }

    // ================================== //
    function setGravityLabel()
    {
        const gravityY = parseFloat(gravityYInput.value!.value);
        gravityLabel.value!.textContent = gravityY.toFixed(2);
    }

    //================================//
    function setGravity() {
        const gravityY = parseFloat(gravityYInput.value!.value);

        if (gameManager.value ) {
            gameManager.value.modifyGravity(0.0, gravityY);
        }
    }

    //================================//
    function setAlphaLabel()
    {
        const alpha = parseFloat(alphaInput.value!.value);
        alphaLabel.value!.textContent =  alpha.toFixed(2);
    }

    //================================//
    function setAlpha() {
        const alpha = parseFloat(alphaInput.value!.value);

        if (gameManager.value ) {
            gameManager.value.modifyAlpha(alpha);
        }
    }

    //================================//
    function setBetaLabel()
    {
        const sliderValue = parseFloat(betaInput.value!.value);
        const beta = sliderToBeta(sliderValue);
        betaLabel.value!.textContent =  beta.toFixed(0);
    }

    //================================//
    function setBeta() {
        const sliderValue = parseFloat(betaInput.value!.value);
        const beta = sliderToBeta(sliderValue);

        if (gameManager.value ) {
            gameManager.value.modifyBeta(beta);
        }
    }

    //================================//
    function sliderToBeta(sliderValue: number): number {
        const min = 1.0;
        const max = 1000000.0;

        // Logarithmic mapping: evenly distributes on a log10 scale
        const exp = Math.log10(min) + sliderValue * (Math.log10(max) - Math.log10(min));
        return Math.pow(10, exp);
    }

    //================================//
    function betaToSlider(beta: number): number {
        const min = 1.0;
        const max = 1000000.0;
        return (Math.log10(beta) - Math.log10(min)) / (Math.log10(max) - Math.log10(min));
    }

    // ================================== //
    function setGammaLabel()
    {
        const gamma = parseFloat(gammaInput.value!.value);
        gammaLabel.value!.textContent =  gamma.toFixed(2);
    }

    //================================//
    function setGamma()
    {
        const gamma = parseFloat(gammaInput.value!.value);

        if (gameManager.value) {
            gameManager.value.modifyGamma(gamma);
        }
    }

    // ================================== //
    function resetGame()
    {
        gameManager.value.restartGame();
        initializeValues();
    }

</script>