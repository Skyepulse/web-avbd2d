/*
 * GameManager.ts
 * 
 * General manager that ties the rendering and physics process together.
 * 
 */

//================================//
import * as glm from 'gl-matrix';
import GameRenderer from "./GameRenderer";
import RigidBox from "./RigidBox";
import Solver from "./Solver";
import { rand, randomPosInRectRot, randomColorUint8 } from "@src/helpers/MathUtils";
import { useLevels } from '@src/helpers/Levels';

// ================================== //
export interface performanceInformation
{
    cpuFrameTime: number,
    gpuFrameTime: number,
    cpuSolverTime: number
}

//================================//
class GameManager
{
    private logging: boolean = true;
    private running: boolean = false;
    private rafID: number | null = null;

    private canvas: HTMLCanvasElement | null = null;

    private gameRenderer: GameRenderer;
    private solver: Solver;

    private lastFrameTime: number = 0;

    private canvasClick?: (e: MouseEvent) => void;
    private windowRestart?: (e: KeyboardEvent) => void;

    private ParsedLevels = useLevels().parsedLevels;

    public CurrentLevelID: number = 1;
    private shouldRestart: boolean = false;

    //=============== PUBLIC =================//
    constructor(canvas: HTMLCanvasElement)
    {
        this.canvas = canvas;
        this.gameRenderer = new GameRenderer(this.canvas as HTMLCanvasElement, this);
        this.solver = new Solver();

        this.solver.setDefaults();

        document.addEventListener("visibilitychange", this.handleAppVisibility.bind(this));
    }

    //================================//
    public async initialize()
    {
        await this.LoadLevel(2);
        this.CurrentLevelID = 2;
    }

    //================================//
    public async cleanup()
    {
        this.stop();
        this.solver.Clear();
        this.solver.setDefaults();

        if (this.canvasClick && this.canvas) {
            this.canvas.removeEventListener('click', this.canvasClick);
            this.canvasClick = undefined;
        }

        if (this.windowRestart) {
            window.removeEventListener("keydown", this.windowRestart);
            this.windowRestart = undefined;
        }

        await this.gameRenderer.cleanup();
    }

    // ================================== //
    public reset(): void {
        this.stop();
        this.solver.Clear();

        if (this.canvasClick && this.canvas) {
            this.canvas.removeEventListener("click", this.canvasClick);
            this.canvasClick = undefined;
        }

        if (this.windowRestart) {
            window.removeEventListener("keydown", this.windowRestart);
            this.windowRestart = undefined;
        }

        this.gameRenderer.reset();
    }

    //================================//
    public toggleLogging()
    {
        this.logging = !this.logging;
    }

    //================================//
    public stop()
    {
        if (!this.running) return;
        this.running = false;

        if (this.rafID != null)
        {
            cancelAnimationFrame(this.rafID);
            this.rafID = null;
        }
        this.log("Main loop stopped.");
    }

    //================================//
    public log(msg: string)
    {
        if (this.logging)
            console.log(`[GameManager] ${msg}`);
    }

    //================================//
    public logWarn(msg: string)
    {
        if (this.logging)
            console.warn(`[GameManager] ${msg}`);
    }

    //=============== PRIVATE =================/
    private startMainLoop() {
        if (this.running) {
            this.logWarn("Main loop already running!");
            return;
        }
        this.running = true;

        const fixedStep = 1 / 60; // 60 Hz physics
        let accumulator = 0;

        this.lastFrameTime = 0;

        const frame = (time: number) => {
            if (!this.running) return;

            if (this.lastFrameTime === 0) {
                this.lastFrameTime = time;
            }

            if (this.shouldRestart) {
                this.shouldRestart = false;
                this.restartGame();
                return;
            }

            const dt = (time - this.lastFrameTime) / 1000;
            this.lastFrameTime = time;
            accumulator += dt;

            // Run physics in fixed steps
            while (accumulator >= fixedStep) {
                this.solver.step(fixedStep);
                accumulator -= fixedStep;
            }

            // Update transforms
            for (let i = 0; i < this.solver.bodies.length; ++i) {
                const body = this.solver.bodies[i];
                const pos = body.getPosition();

                if (pos[0] < -GameRenderer.xWorldLimit || pos[0] > GameRenderer.xWorldLimit ||
                    pos[1] < -GameRenderer.yWorldLimit || pos[1] > GameRenderer.yWorldLimit) 
                {
                    this.solver.removeRigidBox(body);
                    this.gameRenderer.removeInstance(body.id);
                    this.log(`Removed body ID ${body.id} for going out of bounds.`);
                    continue;
                }

                const posArray = new Float32Array([pos[0], pos[1], pos[2]]);
                this.gameRenderer.updateInstancePosition(body.id, posArray);
            }

            this.gameRenderer.updateContacts(this.solver.contactsToRender);
            this.gameRenderer.render();

            this.rafID = requestAnimationFrame(frame);
        };

        this.rafID = requestAnimationFrame(frame);
    }

    // ================================== //
    private async handleAppVisibility() {
        const hidden =
            document.hidden;

        if (hidden) {
            console.log("Tab hidden — pausing main loop and GPU work.");
            this.stop();

            // Wait for GPU queue to finish any pending work
            if (this.gameRenderer.device) {
                try {
                    await Promise.race([
                        this.gameRenderer.device.queue.onSubmittedWorkDone(),
                        new Promise((_, reject) => setTimeout(() => reject("Timeout waiting for GPU idle"), 1000))
                    ]);
                } catch (e) {
                    this.logWarn("GPU sync during background pause failed: " + e);
                }
            }
        } else {
            console.log("Tab visible again — restarting main loop.");
            // Re-acquire texture view, recreate MSAA if needed
            try {
                this.gameRenderer.recreateContextIfNeeded();
            } catch (e) {
                this.logWarn("Recreating WebGPU context failed: " + e);
            }
            this.startMainLoop();
        }
    }


    //================================//
    public addRigidBox(
        pos: glm.vec3 = randomPosInRectRot(0, 0, GameRenderer.xWorldSize, GameRenderer.yWorldSize), 
        scale: glm.vec2 = glm.vec2.fromValues(rand(2, 10), rand(2, 10)), 
        velocity: glm.vec3 = glm.vec3.fromValues(0, 0, 0),
        color: Uint8Array = randomColorUint8(),
        isStatic: boolean = false
    ): void
    {
        const box = new RigidBox(scale, color, isStatic ? 0.0: 1.0, 1.0, pos, velocity);
        box.id = this.gameRenderer.addInstanceBox(box);
        if (box.id !== -1) {
            this.solver.addRigidBox(box);
        } else {
            this.logWarn("Failed to add box instance to renderer.");
        }
    }

    //================================//
    public initializeWindowEvents(): void
    {
        if (!this.canvas) return;
        this.canvasClick = (event: MouseEvent) => {
            if (!this.canvas) return;
            const rect = this.canvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            const canvasX = (x / this.canvas.width) * GameRenderer.xWorldSize;
            const canvasY = (1.0 - (y / this.canvas.height)) * GameRenderer.yWorldSize;
            const pos = glm.vec3.fromValues(canvasX, canvasY, rand(0, Math.PI * 2));
            this.addRigidBox(pos);
        };
        this.canvas.addEventListener('click', this.canvasClick);

        // restart game on r pressed
        this.windowRestart = (event: KeyboardEvent) => {
            if (event.key === 'r' || event.key === 'R') {
                this.restartGame();
            }
        };
        window.addEventListener('keydown', this.windowRestart);
    }

    //============== PUBLIC API ==================//
    public async restartGame()
    {
        await this.LoadLevel(this.CurrentLevelID);
    }

    // ================================== //
    public changeLevel(levelID: number): void
    {
        this.CurrentLevelID = levelID;
        this.setRestartFlag();
    }

    // ================================== //
    public setRestartFlag(): void
    {
        this.shouldRestart = true;
    }

    // ================================== //
    public setSolverDefaults(): void
    {
        this.solver.setDefaults();
    }

    // ================================== //
    public modifyGravity(gravityx: number, gravityy: number): void
    {
        const gravity = glm.vec2.create();
        glm.vec2.set(gravity, gravityx, gravityy);
        this.solver.setGravity(gravity);
    }

    // ================================== //
    public modifyAlpha(alpha: number): void
    {
        this.solver.setAlpha(alpha);
    }

    // ================================== //
    public modifyBeta(beta: number): void
    {
        this.solver.setBeta(beta);
    }

    // ================================== //
    public modifyGamma(gamma: number): void
    {
        this.solver.setGamma(gamma);
    }

    // ================================== //
    public modifyIterations(iterations: number): void
    {
        if (iterations < 1) iterations = 1;

        this.solver.iterations = iterations;
    }

    //================================//
    public modifyPostStabilization(enabled: boolean): void
    {
        this.solver.setIsPostStabilization(enabled);
    }

    //================================//
    public getPostStabilization(): boolean
    {
        return this.solver.getIsPostStabilization();
    }

    // ================================== //
    public getPerformances(): performanceInformation
    {
        return {
            cpuFrameTime: this.gameRenderer.renderTimeCPU,
            gpuFrameTime: this.gameRenderer.renderTimeGPU,
            cpuSolverTime: this.solver.avgStepTime
        };
    }

    // ================================== //
    public async LoadLevel(levelID: number): Promise<void>
    {
        // If levelID is invalid, load the first available level
        const level = this.ParsedLevels?.find(l => l.id === levelID) || this.ParsedLevels?.[0];
        if (!level) {
            this.logWarn("No levels available to load.");
            return;
        }

        // Cleanup
        this.reset();
        if (!this.gameRenderer.isInitialized()) {
            await this.gameRenderer.initialize(); // first load only
        }

        this.initializeWindowEvents();

        // Load Static Objects (mass = 0)
        level.Scene.Static?.forEach(obj => {
            const pos = glm.vec3.fromValues(GameRenderer.xWorldSize / 2 + obj.Position[0], GameRenderer.yWorldSize / 2 + obj.Position[1], obj.Rotation);
            const scale = glm.vec2.fromValues(obj.Scale[0], obj.Scale[1]);
            const colorArr = new Uint8Array(4);
            const color = obj.Color;
            colorArr[0] = parseInt(color.slice(1, 3), 16);
            colorArr[1] = parseInt(color.slice(3, 5), 16);
            colorArr[2] = parseInt(color.slice(5, 7), 16);
            colorArr[3] = 255;
            this.addRigidBox(pos, scale, glm.vec3.fromValues(0, 0, 0), colorArr, true);
        });

        // Load Dynamic Objects (mass > 0)
        level.Scene.Dynamic?.forEach(obj => {
            const pos = glm.vec3.fromValues(GameRenderer.xWorldSize / 2 + obj.Position[0], GameRenderer.yWorldSize / 2 + obj.Position[1], obj.Rotation);
            const scale = glm.vec2.fromValues(obj.Scale[0], obj.Scale[1]);
            const colorArr = new Uint8Array(4);
            const color = obj.Color;
            colorArr[0] = parseInt(color.slice(1, 3), 16);
            colorArr[1] = parseInt(color.slice(3, 5), 16);
            colorArr[2] = parseInt(color.slice(5, 7), 16);
            colorArr[3] = 255;
            this.addRigidBox(pos, scale, glm.vec3.fromValues(0, 0, 0), colorArr, false);
        });

        this.startMainLoop();
    }
}

//================================//
export default GameManager;