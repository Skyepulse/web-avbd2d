<template>
    <div id="expand-toggle" class="flex flex-row justify-between ">
        <label for="expand-checkbox">Show Utils Panel:</label>
        <button
            id="expand-checkbox"
            class="ml-2 mb-2 focus:outline-none"
            @click="render = !render"
        >
            <!-- Rotate image 90 if render is true else -90 -->
            <img src="@src/assets/expand.png"
            class="w-6 h-6 bg-none"
            :class="render ? 'transform rotate-90' : 'transform -rotate-90'"
            alt="Expand/Collapse" />
        </button>
    </div>
    <div id="vertical-flex-box" class="flex flex-col space-y-2 w-[300px] h-[400px] overflow-auto" v-if="render">
        <button
            id="restart-button"
            class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-1 px-2 rounded"
            @click="resetGame()"
        >
            Restart Game
        </button>
        <div class="font-bold text-xs">* Left Click on the canvas to add a rigid box there.</div>
        <div class="border-t border-amber-50 mt-2"></div>
        <Label class="font-bold text-lg">
            Box Spawn Choice:
            <div class="flex flex-col space-y-1 text-xs" ref="boxSpawnSelect">
                <label class="inline-flex items-center space-x-2">
                    <input type="radio" name="boxSpawn" value="0" @change="changeSpawnChoice" />
                    <span>Random</span>
                </label>
                <label class="inline-flex items-center space-x-2">
                    <input type="radio" name="boxSpawn" value="1" @change="changeSpawnChoice" />
                    <span>Small</span>
                </label>
                <label class="inline-flex items-center space-x-2">
                    <input type="radio" name="boxSpawn" value="2" @change="changeSpawnChoice" checked />
                    <span>Medium</span>
                </label>
                <label class="inline-flex items-center space-x-2">
                    <input type="radio" name="boxSpawn" value="3" @change="changeSpawnChoice" />
                    <span>Large</span>
                </label>
                <label class="inline-flex items-center space-x-2">
                    <input type="radio" name="boxSpawn" value="4" @change="changeSpawnChoice" />
                    <span>Drag And Drop</span>
                </label>
            </div>
        </Label>
        <div class="border-t border-amber-50 mt-2"></div>
        <label class="font-bold text-lg">
            Select Level:
        </label>
        <select id="level-select" class="border border-gray-300 rounded p-1" @change="changeLevel">
            <option v-for="level in parsedLevels" :key="level.id" :value="level.id" class="bg-black">
                {{ level.title }}
            </option>
        </select>
        <div class="border-t border-amber-50 mt-2"></div>
        <label class="font-bold text-lg">
            Solver Values:
        </label>
        <button
            id="reset-values-button"
            class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-1 px-2 rounded"
            @click="resetValues()"
        >
            Reset Values
        </button>
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
        <div id="iteration-picker" class="flex flex-row space-x-1">
            <label>Iterations:</label>
            <input
            ref="iterationsInput"
            id="iterations"
            type="number"
            value="10"
            min="1"
            max="100"
            @change="setIterations()"
            />
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
        <div id="energy-ramp-picker" class="flex flex-row space-x-1">
            <label for="energy-ramp">Use energy stiffness ramp:</label>
            <input
            id="energy-ramp"
            type="checkbox"
            :checked="gameManager ? gameManager.getUseEnergyRamp() : false"
            @change="(event) => { if (gameManager) { gameManager.modifyUseEnergyRamp((event.target as HTMLInputElement).checked); } }"
            />
        </div>
        <div id="beta-energy-picker" class="flex flex-row space-x-1" v-if ="gameManager && gameManager.getUseEnergyRamp()">
            <label for="beta">Beta E:</label>
            <input
            ref="betaEnergyInput"
            id="betaEnergy"
            type="range"
            min="0"
            max="1"
            step="0.001"
            value="0.8333"
            @input="setBetaEnergyLabel()"
            @change="setBetaEnergy()"
            />
            <label id="betaEnergyValue" ref="betaEnergyLabel">10</label>
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
        <div id="projection-mode-picker" class="flex flex-row space-x-1">
            <label for="projection-mode">Projection Mode:</label>
            <select
            ref="projectionModeSelect"
            id="projection-mode"
            class=" text-black bg-amber-50"
            @change="(event) => { if (gameManager) { gameManager.modifyProjectionMode(Number((event.target as HTMLSelectElement).value)); } }"
            >
                <option value="0" :selected="gameManager && gameManager.getProjectionMode() === 0">CLAMP</option>
                <option value="1" :selected="gameManager && gameManager.getProjectionMode() === 1">ABSOLUTE</option>
                <option value="2" :selected="gameManager && gameManager.getProjectionMode() === 2">ADAPTATIVE</option>
            </select>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { ref, watch, onMounted } from 'vue';
    import GameManager from './src/game/GameManager';
    import { useLevels } from '@src/helpers/Levels';

    // ================================== //
    const props = defineProps<{
        gameManager: GameManager;
    }>();

    // ================================== //
    const gameManager = ref(props.gameManager);
    const { parsedLevels } = useLevels();

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

    const betaEnergyLabel = ref<HTMLLabelElement | null>(null);
    const betaEnergyInput = ref<HTMLInputElement | null>(null);

    const gammaLabel = ref<HTMLLabelElement | null>(null);
    const gammaInput = ref<HTMLInputElement | null>(null);

    const iterationsInput = ref<HTMLInputElement | null>(null);

    const render = ref<boolean>(true);

    const projectionModeSelect = ref<HTMLSelectElement | null>(null);

    // ================================== //
    onMounted(() => {
        initializeValues();
    });

    // ================================== //
    function initializeValues()
    {
        // Beta
        if(betaLabel.value && betaInput.value)
        {
            betaLabel.value.textContent = '100000';
            betaInput.value.value = betaToSlider(100000).toString();
        }

        // Beta Energy
        if(betaEnergyLabel.value && betaEnergyInput.value)
        {
            betaEnergyLabel.value.textContent = '10';
            betaEnergyInput.value.value = betaEnergyToSlider(10).toString();
        }

        // Gamma
        if(gammaLabel.value && gammaInput.value)
        {
            gammaLabel.value.textContent = "0.99";
            gammaInput.value.value = "0.99";
        }

        // Gravity
        if(gravityLabel.value && gravityYInput.value)
        {
            gravityLabel.value.textContent = "-9.81";
            gravityYInput.value.value = "-9.81";
        }

        // Iterations
        if(iterationsInput.value)
        {
            iterationsInput.value.value = "10";
        }

        // Alpha (only if not using post stabilization)
        if(alphaLabel.value && alphaInput.value && gameManager.value && !gameManager.value.getPostStabilization())
        { 
            alphaLabel.value.textContent = "0.99";
            alphaInput.value.value = "0.99";
        }

        if(projectionModeSelect.value && gameManager.value)
        {
            projectionModeSelect.value.value = gameManager.value.getProjectionMode().toString();
            console.log("Projection mode select value set to: " + projectionModeSelect.value.value);
        }
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

    // ================================== //
    function setIterations()
    {
        const iterations = parseInt(iterationsInput.value!.value);

        if (gameManager.value ) {
            gameManager.value.modifyIterations(iterations);
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
    function setBetaEnergyLabel()
    {
        const sliderValue = parseFloat(betaEnergyInput.value!.value);
        const beta = sliderToBetaEnergy(sliderValue);
        betaEnergyLabel.value!.textContent =  beta.toFixed(0);
    }

    //================================//
    function setBetaEnergy() {
        const sliderValue = parseFloat(betaEnergyInput.value!.value);
        const beta = sliderToBetaEnergy(sliderValue);

        if (gameManager.value ) {
            gameManager.value.modifyBetaEnergy(beta);
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

    //================================//
    function sliderToBetaEnergy(sliderValue: number): number {
        const min = 1.0;
        const max = 1000000.0;

        // Logarithmic mapping: evenly distributes on a log10 scale
        const exp = Math.log10(min) + sliderValue * (Math.log10(max) - Math.log10(min));
        return Math.pow(10, exp);
    }

    //================================//
    function betaEnergyToSlider(beta: number): number {
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
        gameManager.value.setRestartFlag();
    }

    // ================================== //
    function resetValues()
    {
        if (gameManager.value) {
            gameManager.value.setSolverDefaults();
        }
        initializeValues();
    }

    // ================================== //
    function changeLevel(event: Event)
    {
        const selectedLevelID = parseInt((event.target as HTMLSelectElement).value);

        if (gameManager.value) {
            gameManager.value.changeLevel(selectedLevelID);
        }
    }

    // ================================== //
    function changeSpawnChoice(event: Event)
    {
        const selectedValue = parseInt((event.target as HTMLInputElement).value);

        if (gameManager.value) {
            gameManager.value.modifyBoxSpawnState(selectedValue);
        }
    }

</script>