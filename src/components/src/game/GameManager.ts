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

    //=============== PUBLIC =================//
    constructor(canvas: HTMLCanvasElement)
    {
        this.canvas = canvas;
        this.gameRenderer = new GameRenderer(this.canvas as HTMLCanvasElement, this);
        this.solver = new Solver();

        this.solver.setDefaults();
    }

    //================================//
    public async initialize()
    {
        this.log("Hello World!");

        // Game Renderer
        await this.gameRenderer.initialize();
        this.initializeWindowEvents();

        this.startMainLoop();
    }

    //================================//
    public async cleanup()
    {
        this.stop();
        this.solver.Clear();
        if (this.canvasClick && this.canvas) {
            this.canvas.removeEventListener('click', this.canvasClick);
            this.canvasClick = undefined;
        }
        await this.gameRenderer.cleanup();
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

        // Static ground box
        const staticBoxPosition = glm.vec3.fromValues(GameRenderer.xWorldSize * 0.5, 8, 0);
        const staticBoxScale = glm.vec2.fromValues(GameRenderer.xWorldSize - 20, 10);
        this.addRigidBox(staticBoxPosition, staticBoxScale, glm.vec3.fromValues(0,0,0), new Uint8Array([200,200,200,255]), true);

        const fixedStep = 1 / 60; // 60 Hz physics
        let accumulator = 0;
        this.lastFrameTime = performance.now();

        const frame = (time: number) => {
            if (!this.running) return;

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
                const posArray = new Float32Array([pos[0], pos[1], pos[2]]);
                this.gameRenderer.updateInstancePosition(body.id, posArray);
            }

            this.gameRenderer.updateContacts(this.solver.contactsToRender);
            this.gameRenderer.render();

            this.rafID = requestAnimationFrame(frame);
        };

        this.rafID = requestAnimationFrame(frame);
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
    }

    //============== PUBLIC API ==================//
    public async restartGame()
    {
        this.cleanup();
        await this.gameRenderer.initialize();
        this.initializeWindowEvents();
        this.startMainLoop();
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
}

//================================//
export default GameManager;