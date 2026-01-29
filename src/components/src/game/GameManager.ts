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
import { rand, randomPosInRectRot, randomColorUint8, TESTS } from "@src/helpers/MathUtils";
import { useLevels, type GObject } from '@src/helpers/Levels';
import Joint from './Joint';
import Spring from './Spring';
import { createParticle } from '@src/helpers/Others';
import TriAreaConstraint from './TriAreaConstraint';
import NeoHookianEnergy from './NeoHookeanEnergy';
import StVKEnergy from './StVKEnergy';

// ================================== //
export interface performanceInformation
{
    cpuFrameTime: number,
    gpuFrameTime: number,
    cpuSolverTime: number,
    currentFPS: number
}

// ================================== //
enum BoxSpawnState
{
    Random = 0,
    Small = 1,
    Medium = 2,
    Large = 3,
    DragAndDrop = 4
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
    public currentFPS = 0;
    private frameCount = 0;
    private fpsAccum = 0;

    private onMouseDown?: (e: MouseEvent) => void;
    private onMouseMove?: (e: MouseEvent) => void;
    private onMouseUp?: (e: MouseEvent) => void;

    private onZoom?: (e: WheelEvent) => void;
    private windowRestart?: (e: KeyboardEvent) => void;
    private onPauseToggle?: (e: KeyboardEvent) => void;

    private ParsedLevels = useLevels().parsedLevels;

    public CurrentLevelID: number = 1;
    private shouldRestart: boolean = false;

    private boxSpawnState: BoxSpawnState = BoxSpawnState.Medium;

    private isDragging: boolean = false;
    public get dragging(): boolean { return this.isDragging; }
    private draggedBox: RigidBox | null = null;
    public get draggedRigidBox(): RigidBox | null { return this.draggedBox; }
    private dragTarget: glm.vec2 = glm.vec2.create();
    public getDragTarget(): glm.vec2 { return this.dragTarget; }
    private dragOffset: glm.vec2 = glm.vec2.create();
    public getDragOffset(): glm.vec2 { return this.dragOffset; }
    private dragForce: Joint | null = null;
    public getDragForce(): Joint | null { return this.dragForce; }

    //=============== PUBLIC =================//
    constructor(canvas: HTMLCanvasElement)
    {
        this.canvas = canvas;
        this.gameRenderer = new GameRenderer(this.canvas as HTMLCanvasElement, this);
        this.solver = new Solver(this);

        this.solver.setDefaults();
        document.addEventListener("visibilitychange", this.handleAppVisibility.bind(this));

        TESTS();
    }

    //================================//
    public async initialize()
    {
        await this.LoadLevel(0);
        this.CurrentLevelID = 0;
    }

    //================================//
    public async cleanup()
    {
        if (!this.canvas) return;

        this.stop();
        this.solver.Clear();
        this.solver.setDefaults();

        if (this.onMouseDown) {
            this.canvas.removeEventListener('mousedown', this.onMouseDown);
            this.onMouseDown = undefined;
        }

        if (this.onMouseMove) {
            this.canvas.removeEventListener('mousemove', this.onMouseMove);
            this.onMouseMove = undefined;
        }

        if (this.onMouseUp) {
            this.canvas.removeEventListener('mouseup', this.onMouseUp);
            this.onMouseUp = undefined;
        }

        if (this.windowRestart) {
            window.removeEventListener("keydown", this.windowRestart);
            this.windowRestart = undefined;
        }

        if (this.onZoom) {
            this.canvas.removeEventListener("wheel", this.onZoom);
            this.onZoom = undefined;
        }

        if (this.onPauseToggle) {
            window.removeEventListener("keydown", this.onPauseToggle);
            this.onPauseToggle = undefined;
        }

        await this.gameRenderer.cleanup();
    }

    // ================================== //
    public reset(): void {
        if (!this.canvas) return;

        this.stop();
        this.solver.Clear();

        if (this.onMouseDown) {
            this.canvas.removeEventListener('mousedown', this.onMouseDown);
            this.onMouseDown = undefined;
        }

        if (this.onMouseMove) {
            this.canvas.removeEventListener('mousemove', this.onMouseMove);
            this.onMouseMove = undefined;
        }

        if (this.onMouseUp) {
            this.canvas.removeEventListener('mouseup', this.onMouseUp);
            this.onMouseUp = undefined;
        }

        if (this.windowRestart) {
            window.removeEventListener("keydown", this.windowRestart);
            this.windowRestart = undefined;
        }

        if (this.onZoom) {
            this.canvas.removeEventListener("wheel", this.onZoom);
            this.onZoom = undefined;
        }

        if (this.onPauseToggle) {
            window.removeEventListener("keydown", this.onPauseToggle);
            this.onPauseToggle = undefined;
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

    //================================//
    public addRigidBox(
        pos: glm.vec3 = randomPosInRectRot(0, 0, GameRenderer.xWorldSize, GameRenderer.yWorldSize), 
        scale: glm.vec2 = glm.vec2.fromValues(rand(2, 10), rand(2, 10)), 
        velocity: glm.vec3 = glm.vec3.fromValues(0, 0, 0),
        color: Uint8Array = randomColorUint8(),
        isStatic: boolean = false,
        friction: number = 1.0,
    ): void
    {
        const box = new RigidBox(scale, color, isStatic ? 0.0: 1.0, friction, pos, velocity);

        box.id = this.gameRenderer.addInstanceBox(box);
        if (box.id !== -1) {
            this.solver.addRigidBox(box);
        } else {
            this.logWarn("Failed to add box instance to renderer.");
        }
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

    //================================//
    public modifyBetaEnergy(beta: number): void
    {
        this.solver.setBetaEnergy(beta);
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

    // ================================== //
    public modifyBoxSpawnState(int: number): void
    {
        if (int < 0 || int > 4) return;
        this.boxSpawnState = int;
    }

    //================================//
    public getPostStabilization(): boolean
    {
        return this.solver.getIsPostStabilization();
    }

    //================================//
    public getUseEnergyRamp(): boolean
    {
        return this.solver.getUseEnergyRamp();
    }

    //================================//
    public modifyUseEnergyRamp(enabled: boolean): void
    {
        this.solver.setUseEnergyRamp(enabled);
    }

    // ================================== //
    public getPerformances(): performanceInformation
    {
        return {
            cpuFrameTime: this.gameRenderer.renderTimeCPU,
            gpuFrameTime: this.gameRenderer.renderTimeGPU,
            cpuSolverTime: this.solver.avgStepTime,
            currentFPS: this.currentFPS
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

        if (level.hardcoded)
        {
            const ID = level.id;
            // call function LoadHardcodedLevelX based on level id
            const funcName = `loadHardcodedLevel${ID}`;
            if (typeof (this as any)[funcName] === "function") {
                (this as any)[funcName]();
            } 
            else
                this.logWarn(`Hardcoded level function ${funcName} not found.`);
            this.startMainLoop();
            return;
        }

        const loadObject = (obj: GObject, isStatic: boolean) =>
        {
            const pos = glm.vec3.fromValues(obj.Position[0], obj.Position[1], obj.Rotation);
            const scale = glm.vec2.fromValues(obj.Scale[0], obj.Scale[1]);
            const colorArr = new Uint8Array(4);
            const color = obj.Color;
            colorArr[0] = parseInt(color.slice(1, 3), 16);
            colorArr[1] = parseInt(color.slice(3, 5), 16);
            colorArr[2] = parseInt(color.slice(5, 7), 16);
            colorArr[3] = 255;
            const friction = obj.Friction;
            const initialVelocity = obj.InitVelocity;
            this.addRigidBox(pos, scale, initialVelocity, colorArr, isStatic, friction);
        }

        // Load Static Objects (mass = 0)
        level.Scene?.Static?.forEach(obj => loadObject(obj, true));
        // Load Dynamic Objects (mass > 0)
        level.Scene?.Dynamic?.forEach(obj => loadObject(obj, false));

        level.Scene?.JointForces?.forEach(jf => 
        {
            const bodyA = jf.bodyAIndex !== null ? this.solver.bodies[jf.bodyAIndex] : null;
            const bodyB = this.solver.bodies[jf.bodyBIndex];

            if (!bodyB) {
                this.logWarn(`Joint force bodyBIndex ${jf.bodyBIndex} is invalid.`);
                return;
            }

            const joint = new Joint(
                [bodyA, bodyB],
                jf.rA_offset_center,
                jf.rB_offset_center,
                jf.stiffness,
                jf.fracture
            );

            this.solver.addForce(joint);
        });

        level.Scene?.SpringForces?.forEach(sf =>
        {
            const bodyA = sf.bodyAIndex !== null ? this.solver.bodies[sf.bodyAIndex] : null;
            const bodyB = this.solver.bodies[sf.bodyBIndex];

            if (!bodyB) {
                this.logWarn(`Spring force bodyBIndex ${sf.bodyBIndex} is invalid.`);
                return;
            }

            const spring = new Spring(
                [bodyA, bodyB],
                sf.rA_offset_center,
                sf.rB_offset_center,
                sf.stiffness,
                sf.restLength
            );

            this.solver.addForce(spring);
        });

        this.startMainLoop();
    }

    //=============== PRIVATE =================/
    private startMainLoop() {
        if (this.running) {
            this.logWarn("Main loop already running!");
            return;
        }
        this.running = true;

        const fixedStep = 1 / 60;
        let accumulator = 0;

        this.lastFrameTime = 0;
        this.frameCount = 0;
        this.fpsAccum = 0;
        this.currentFPS = 0;

        const MAX_PHYSICS_STEPS = 5;

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
            this.fpsAccum += dt;
            this.frameCount++;

            if (this.fpsAccum >= 1.0) {
                this.currentFPS = this.frameCount / this.fpsAccum;
                this.frameCount = 0;
                this.fpsAccum = 0;
            }

            this.lastFrameTime = time;

            accumulator += dt;

            let steps = 0;
            while (accumulator >= fixedStep && steps < MAX_PHYSICS_STEPS) {
                this.solver.step(fixedStep);
                accumulator -= fixedStep;
                steps++;
            }

            // If we missed too much → drop accumulated time
            if (steps === MAX_PHYSICS_STEPS) {
                accumulator = 0;
            }

            for (let i = 0; i < this.solver.bodies.length; ++i) {
                const body = this.solver.bodies[i];
                const pos = body.getPosition();

                if (
                    pos[0] < -GameRenderer.xWorldLimit || pos[0] > GameRenderer.xWorldLimit ||
                    pos[1] < -GameRenderer.yWorldLimit || pos[1] > GameRenderer.yWorldLimit
                ) {
                    this.solver.removeRigidBox(body);
                    this.gameRenderer.removeInstance(body.id);
                    continue;
                }

                this.gameRenderer.updateInstancePosition(body.id, new Float32Array([pos[0], pos[1], pos[2]]));
            }

            this.gameRenderer.updateContacts(this.solver.contactsToRender);
            this.gameRenderer.updateContactLines(this.solver.contactLinesToRender);
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
            // Re-acquire texture view, recreate MSAA if needed
            try {
                this.gameRenderer.recreateContextIfNeeded();
            } catch (e) {
                this.logWarn("Recreating WebGPU context failed: " + e);
            }
            this.startMainLoop();
        }
    }

    // ================================== //
    private spawnBoxOnClick(event: MouseEvent): void
    {
        if (!this.canvas) return;

        const worldPos = this.screenToWorld(event.clientX, event.clientY);
        const worldX = worldPos[0];
        const worldY = worldPos[1];

        const smallMult = 2;
        const mediumMult = 5;
        const largeMult = 10;

        const pos = glm.vec3.fromValues(worldX, worldY, 0);
        const scale = glm.vec2.create();

        let color = randomColorUint8();
        const baseSize = 1.0;

        switch (this.boxSpawnState) {
            case BoxSpawnState.Random:
                glm.vec2.set(scale, rand(2, 10), rand(2, 10));
                pos[2] = rand(0, Math.PI * 2);
                break;
            case BoxSpawnState.Small:
                glm.vec2.set(scale, baseSize * smallMult, baseSize * smallMult);
                break;
            case BoxSpawnState.Medium:
                glm.vec2.set(scale, baseSize * mediumMult, baseSize * mediumMult);
                break;
            case BoxSpawnState.Large:
                glm.vec2.set(scale, baseSize * largeMult, baseSize * largeMult);
                break;
        }

        this.addRigidBox(pos, scale, glm.vec3.fromValues(0, 0, 0), color, false);
    }

    // ================================== //
    private screenToWorld(clientX: number, clientY: number): glm.vec2
    {
        const rect = this.canvas!.getBoundingClientRect();
        const px = clientX - rect.left;
        const py = clientY - rect.top;

        const ndcX = (px / this.canvas!.width) * 2.0 - 1.0;
        const ndcY = (1.0 - (py / this.canvas!.height)) * 2.0 - 1.0;

        const aspect = this.canvas!.width / this.canvas!.height;
        const halfW = GameRenderer.xWorldSize * 0.5;
        const halfH = GameRenderer.yWorldSize * 0.5;

        const preCamX = ndcX * halfW * (aspect * (halfH / halfW));
        const preCamY = ndcY * halfH;

        const worldX = preCamX / this.gameRenderer.zoom + this.gameRenderer.cameraOffset.x;
        const worldY = preCamY / this.gameRenderer.zoom + this.gameRenderer.cameraOffset.y;

        return glm.vec2.fromValues(worldX, worldY);
    };


    //================================//
    private initializeWindowEvents(): void
    {
        if (!this.canvas) return;

        const applyZoom = (event: WheelEvent): void => {
            event.preventDefault();

            const pre = this.screenToWorld(event.clientX, event.clientY);

            const zoomAmount = event.deltaY * -0.001;
            let newZoom = this.gameRenderer.zoom * (1 + zoomAmount);
            newZoom = Math.min(Math.max(newZoom, 0.1), 5.0);

            this.gameRenderer.zoom = newZoom;

            const post = this.screenToWorld(event.clientX, event.clientY);

            // keep the point under the cursor stable
            this.gameRenderer.cameraOffset.x += (pre[0] - post[0]);
            this.gameRenderer.cameraOffset.y += (pre[1] - post[1]);
        };

        this.onMouseDown = (event: MouseEvent) => {
            if (event.button !== 0) return;

            if (this.boxSpawnState !== BoxSpawnState.DragAndDrop) {
                this.spawnBoxOnClick(event);
                return;
            }

            const mouse = this.screenToWorld(event.clientX, event.clientY);
            let selectedBox: RigidBox | null = null;
            let minDist = Infinity;

            for (const box of this.solver.bodies) {
                if (box.isStatic()) continue;

                const pos = box.getPos2();
                const half = glm.vec2.scale(glm.vec2.create(), box.getScale(), 0.5);
                const rot = box.getRotationMatrix();
                const dx = mouse[0] - pos[0];
                const dy = mouse[1] - pos[1];
                const localX = rot[0] * dx + rot[1] * dy;
                const localY = rot[2] * dx + rot[3] * dy;

                if (localX >= -half[0] && localX <= half[0] &&
                    localY >= -half[1] && localY <= half[1]) {
                    const dist = dx * dx + dy * dy;
                    if (dist < minDist) {
                        minDist = dist;
                        selectedBox = box;
                    }
                }
            }

            if (selectedBox) {
                this.isDragging = true;
                this.draggedBox = selectedBox;
                selectedBox.isDragged = true;

                const pos = selectedBox.getPos2();
                const rotMatrix = selectedBox.getRotationMatrix();
                const rotInv = glm.mat2.transpose(glm.mat2.create(), rotMatrix);

                const localRbPos = glm.vec2.create();
                const worldToLocal = glm.vec2.sub(glm.vec2.create(), mouse, pos);
                glm.vec2.transformMat2(localRbPos, worldToLocal, rotInv);

                glm.vec2.set(this.dragOffset, mouse[0] - pos[0], mouse[1] - pos[1]);
                glm.vec2.copy(this.dragTarget, mouse);

                this.dragForce = new Joint(
                    [selectedBox],
                    mouse,
                    localRbPos,
                    glm.vec3.fromValues(10000.0, 10000.0, 0.0)
                );

                this.solver.addForce(this.dragForce);
            }
        };

        this.onMouseMove = (event: MouseEvent) => {
            if (!this.isDragging || !this.draggedBox) return;

            const mouse = this.screenToWorld(event.clientX, event.clientY);
            glm.vec2.copy(this.dragTarget, mouse);

            if (this.dragForce) {
                glm.vec2.set(this.dragForce.rA, mouse[0], mouse[1]);
            }
        };

        this.onMouseUp = (event: MouseEvent) => {
            if (event.button !== 0) return;

            if (this.draggedBox) {
                this.draggedBox.isDragged = false;
                if (this.dragForce) {
                    this.solver.removeForce(this.dragForce);
                    this.dragForce = null;
                }
            }

            this.isDragging = false;
            this.draggedBox = null;
        };

        this.canvas.addEventListener("mousedown", this.onMouseDown);
        this.canvas.addEventListener("mousemove", this.onMouseMove);
        this.canvas.addEventListener("mouseup", this.onMouseUp);

        this.onZoom = applyZoom;
        this.canvas.addEventListener("wheel", this.onZoom);

        this.windowRestart = (event: KeyboardEvent) => {
            if (event.key === 'r' || event.key === 'R') {
                this.restartGame();
            }
        };
        window.addEventListener('keydown', this.windowRestart);

        this.onPauseToggle = (event: KeyboardEvent) => {
            if (event.key === 'p' || event.key === 'P') {
                this.solver.paused = this.solver.paused ? false : true;
            }
        };
        window.addEventListener('keydown', this.onPauseToggle);
    }

    // ================================== //
    private makeParticle(x: number, y: number, mass: number, color: string)
    {
        const p = createParticle(glm.vec2.fromValues(x, y), mass, color);
        p.id = this.gameRenderer.addInstanceBox(p);
        this.solver.addRigidBox(p);
        return p;
    };

    // =============== HARDCODED LEVELS =================== //
    public loadHardcodedLevel7(): void
    {
        const W = 8;
        const H = 9;
        const spacing = 2.0;
        const mass = 0.1;
        const stiffness = 500.0;

        const cloth: RigidBox[][] = [];

        // Particles
        for (let y = 0; y < H; y++)
        {
            cloth[y] = [];
            for (let x = 0; x < W; x++)
            {
                const px = (x - W * 0.5) * spacing;
                const py = (H - y) * spacing + 8.0;

                const p = this.makeParticle(px, py, mass, "#ffffff");
                cloth[y][x] = p;
            }
        }

        // Structural springs
        for (let y = 0; y < H; y++)
        {
            for (let x = 0; x < W; x++)
            {
                if (x < W - 1)
                {
                    const s = new Spring(
                        [cloth[y][x], cloth[y][x+1]],
                        glm.vec2.fromValues(0,0),
                        glm.vec2.fromValues(0,0),
                        stiffness,
                        spacing
                    );
                    this.solver.addForce(s);
                }

                if (y < H - 1)
                {
                    const s = new Spring(
                        [cloth[y][x], cloth[y+1][x]],
                        glm.vec2.fromValues(0,0),
                        glm.vec2.fromValues(0,0),
                        stiffness,
                        spacing
                    );
                    this.solver.addForce(s);
                }
            }
        }

        // Shear springs
        for (let y = 0; y < H - 1; y++)
        {
            for (let x = 0; x < W - 1; x++)
            {
                const s1 = new Spring(
                    [cloth[y][x], cloth[y+1][x+1]],
                    glm.vec2.fromValues(0,0),
                    glm.vec2.fromValues(0,0),
                    stiffness,
                    spacing * 1.4142
                );
                this.solver.addForce(s1);

                const s2 = new Spring(
                    [cloth[y][x+1], cloth[y+1][x]],
                    glm.vec2.fromValues(0,0),
                    glm.vec2.fromValues(0,0),
                    stiffness,
                    spacing * 1.4142
                );
                this.solver.addForce(s2);
            }
        }

        // Bend springs
        for (let y = 0; y < H; y++)
        {
            for (let x = 0; x < W; x++)
            {
                if (x < W - 2)
                {
                    const s = new Spring(
                        [cloth[y][x], cloth[y][x+2]],
                        glm.vec2.fromValues(0,0),
                        glm.vec2.fromValues(0,0),
                        stiffness * 0.3,
                        spacing * 2.0
                    );
                    this.solver.addForce(s);
                }

                if (y < H - 2)
                {
                    const s = new Spring(
                        [cloth[y][x], cloth[y+2][x]],
                        glm.vec2.fromValues(0,0),
                        glm.vec2.fromValues(0,0),
                        stiffness * 0.3,
                        spacing * 2.0
                    );
                    this.solver.addForce(s);
                }
            }
        }

        // Pin corners
        const pinA = glm.vec2.fromValues(-(W - 1) * spacing * 0.5, H * spacing + 8.0);
        const pinB = glm.vec2.fromValues( (W - 1) * spacing * 0.5, H * spacing + 8.0);
        const stiff = glm.vec3.fromValues(Infinity, Infinity, 0.0);

        {
            const j = new Joint(
                [null, cloth[0][0]],
                pinA,
                glm.vec2.fromValues(0,0),
                stiff
            );
            this.solver.addForce(j);
        }

        {
            const j = new Joint(
                [null, cloth[0][W-1]],
                pinB,
                glm.vec2.fromValues(0,0),
                stiff
            );
            this.solver.addForce(j);
        }
    }

    // ================================== //
    public loadHardcodedLevel8(): void
    {
        const mass = 1.0;
        const color = "#ffffff";
        const k_edge = 200.0;
        const k_area = 500.0;
        

        //
        // LEFT TRIANGLE — SPRINGS ONLY
        //
        const L_A = this.makeParticle(-10, 5, mass, color);
        const L_B = this.makeParticle(-13, 0, mass, color);
        const L_C = this.makeParticle( -7, 0, mass, color);

        // Edges
        const connectSpring = (p1: RigidBox, p2: RigidBox) => {
            const rest = glm.vec2.distance(p1.getPos2(), p2.getPos2());
            const s = new Spring(
                [p1, p2],
                glm.vec2.fromValues(0,0),
                glm.vec2.fromValues(0,0),
                k_edge,
                rest
            );
            this.solver.addForce(s);
        };

        connectSpring(L_A, L_B);
        connectSpring(L_B, L_C);
        connectSpring(L_C, L_A);

        //
        // RIGHT TRIANGLE — SPRINGS + AREA CONSTRAINT
        //
        const R_A = this.makeParticle(10, 5, mass, color);
        const R_B = this.makeParticle(7, 0, mass, color);
        const R_C = this.makeParticle(13, 0, mass, color);

        connectSpring(R_A, R_B);
        connectSpring(R_B, R_C);
        connectSpring(R_C, R_A);

        // Area preservation constraint
        {
            const areaC = new TriAreaConstraint(
                [R_A, R_B, R_C],
                glm.vec2.fromValues(0,0),
                glm.vec2.fromValues(0,0),
                glm.vec2.fromValues(0,0),
                k_area
            );
            this.solver.addForce(areaC);
        }

        const floor = new RigidBox(
            glm.vec2.fromValues(50, 2),
            new Uint8Array([200,200,200,255]),
            0.0,              // density = 0 => static
            1.0,
            glm.vec3.fromValues(0, -5, 0),
            glm.vec3.fromValues(0, 0, 0)
        );
        floor.id = this.gameRenderer.addInstanceBox(floor);
        this.solver.addRigidBox(floor);
    }

    // ================================== //
    public loadHardcodedLevel9(): void
    {
        const mass = 1.0;
        const color = "#ffffff";

        // Three different area stiffness values
        const AREA_WEAK   = 100.0;
        const AREA_MEDIUM = 1000.0;
        const AREA_STRONG = 50000.0;

        // Three different spring stiffness values
        const SPRING_WEAK   = 50.0;
        const SPRING_MEDIUM = 250.0;
        const SPRING_STRONG = Infinity;


        const addSpring = (A: RigidBox, B: RigidBox, k: number) => {
            const rest = glm.vec2.distance(A.getPos2(), B.getPos2());
            this.solver.addForce(
                new Spring([A,B],
                    glm.vec2.fromValues(0,0),
                    glm.vec2.fromValues(0,0),
                    k,
                    rest)
            );
        };

        const addArea = (A: RigidBox, B: RigidBox, C: RigidBox, k: number) => {
            this.solver.addForce(
                new TriAreaConstraint(
                    [A,B,C],
                    glm.vec2.fromValues(0,0),
                    glm.vec2.fromValues(0,0),
                    glm.vec2.fromValues(0,0),
                    k)
            );
        };

        //
        // FACTORY: create one soft hex body at (cx, cy) with given area stiffness
        //
        const createHexSoftBody = (cx: number, cy: number, k_area: number, k_spring: number) =>
        {
            const R = 3.5;

            const C = this.makeParticle(cx, cy, mass, color); // center

            const ring: RigidBox[] = [];
            for (let i = 0; i < 6; i++)
            {
                const a = (Math.PI * 2 / 6) * i;
                ring.push(this.makeParticle(
                    cx + R * Math.cos(a),
                    cy + R * Math.sin(a),
                    mass,
                    color
                ));
            }

            // Springs
            for (let i = 0; i < 6; i++)
                addSpring(C, ring[i], k_spring);     // center to ring

            for (let i = 0; i < 6; i++)
                addSpring(ring[i], ring[(i+1)%6], k_spring); // ring edges

            for (let i = 0; i < 6; i++)
                addSpring(ring[i], ring[(i+2)%6], k_spring); // diagonals (extra stiffness)

            // Area constraints
            for (let i = 0; i < 6; i++)
                addArea(C, ring[i], ring[(i+1)%6], k_area); // center fan

            for (let i = 0; i < 6; i++)
                addArea(ring[i], ring[(i+1)%6], ring[(i+2)%6], k_area); // outer triangles
        };


        //
        // CREATE THREE SIDE-BY-SIDE BODIES
        //
        createHexSoftBody(-12, 6, AREA_WEAK, SPRING_WEAK);     // left
        createHexSoftBody(  0, 6, AREA_MEDIUM, SPRING_MEDIUM);   // center
        createHexSoftBody( 12, 6, AREA_STRONG, SPRING_STRONG);   // right


        //
        // STATIC FLOOR
        //
        const floor = new RigidBox(
            glm.vec2.fromValues(60, 2),
            new Uint8Array([200,200,200,255]),
            0.0,
            1.0,
            glm.vec3.fromValues(0, -6, 0),
            glm.vec3.fromValues(0, 0, 0)
        );
        floor.id = this.gameRenderer.addInstanceBox(floor);
        this.solver.addRigidBox(floor);
    }

    //================================//
    public loadHardcodedLevel10(): void
    {
        const mass = 1.0;
        const color = "#ffffff";

        const addArea = (A: RigidBox, B: RigidBox, C: RigidBox, E: number, nu: number) => {
            this.solver.addEnergy(
                new NeoHookianEnergy(
                    [A,B,C],
                    E,
                    nu
                )
            );
        };

        const createHexHookean = (cx: number, cy: number, E: number, nu: number) =>
        {
            const R = 3.0;
            const C = this.makeParticle(cx, cy, mass, color); // center

            const ring: RigidBox[] = [];
            for (let i = 0; i < 6; i++)
            {
                const a = (Math.PI * 2 / 6) * i;
                ring.push(this.makeParticle(
                    cx + R * Math.cos(a),
                    cy + R * Math.sin(a),
                    mass,
                    color
                ));
            }

            // Area constraints
            for (let i = 0; i < 6; i++)
                addArea(C, ring[i], ring[(i+1)%6], E, nu); // center fan

            for (let i = 0; i < 6; i++)
                addArea(ring[i], ring[(i+1)%6], ring[(i+2)%6], E, nu); // outer triangles
        };
        
        // Ramp 1: E
        createHexHookean(-20, 30,    50, 0.30);
        createHexHookean(-10, 30,   800, 0.30);
        createHexHookean(  0, 30,   3000, 0.30);
        createHexHookean( 10, 30,  8000, 0.30);
        createHexHookean( 20, 30,  20000, 0.30); 
        const floor1 = new RigidBox(
            glm.vec2.fromValues(50, 2),
            new Uint8Array([200,200,200,255]),
            0.0,              // density = 0 => static
            1.0,
            glm.vec3.fromValues(0, 20, 0),
            glm.vec3.fromValues(0, 0, 0)
        );
        floor1.id = this.gameRenderer.addInstanceBox(floor1);
        this.solver.addRigidBox(floor1);

        // Ramp 2: nu
        createHexHookean(-20, 10, 500, 0.10);
        createHexHookean(-10, 10, 500, 0.25);
        createHexHookean(  0, 10, 500, 0.35);
        createHexHookean( 10, 10, 500, 0.42);
        createHexHookean( 20, 10, 500, 0.45);
        const floor2 = new RigidBox(
            glm.vec2.fromValues(50, 2),
            new Uint8Array([200,200,200,255]),
            0.0,
            1.0,
            glm.vec3.fromValues(0, 0, 0),
            glm.vec3.fromValues(0, 0, 0)
        );
        floor2.id = this.gameRenderer.addInstanceBox(floor2);
        this.solver.addRigidBox(floor2);

        // Ramp 3: combined E and nu
        createHexHookean(-20, -10,    50, 0.20);
        createHexHookean(-10, -10,   200, 0.30);
        createHexHookean(  0, -10,   600, 0.33);
        createHexHookean( 10, -10,  4000, 0.39);
        createHexHookean( 20, -10,  9000, 0.41);
        const floor3 = new RigidBox(
            glm.vec2.fromValues(50, 2),
            new Uint8Array([200,200,200,255]),
            0.0,
            1.0,
            glm.vec3.fromValues(0, -20, 0),
            glm.vec3.fromValues(0, 0, 0)
        );
        floor3.id = this.gameRenderer.addInstanceBox(floor3);
        this.solver.addRigidBox(floor3);
    }

    //================================//
    public loadHardcodedLevel11(): void
    {
        const W = 8;
        const H = 9;
        const spacing = 2.0;
        const mass = 0.1;

        const mu = 300.0;
        const lambda = 258.0;

        const cloth: RigidBox[][] = [];

        // The particles
        for (let y = 0; y < H; y++)
        {
            cloth[y] = [];
            for (let x = 0; x < W; x++)
            {
                const px = (x - W * 0.5) * spacing;
                const py = (H - y) * spacing + 8.0;

                cloth[y][x] = this.makeParticle(px, py, mass, "#ffffff");
            }
        }

        // Energies
        for (let y = 0; y < H - 1; y++)
        {
            for (let x = 0; x < W - 1; x++)
            {
                const A = cloth[y][x];
                const B = cloth[y][x + 1];
                const C = cloth[y + 1][x];
                const D = cloth[y + 1][x + 1];

                // Triangle 1: A–B–D
                this.solver.addEnergy(
                    new StVKEnergy([A, B, D], mu, lambda)
                );

                // Triangle 2: A–D–C
                this.solver.addEnergy(
                    new StVKEnergy([A, D, C], mu, lambda)
                );
            }
        }

        // We pin the corners
        const pinA = glm.vec2.fromValues(
            -(W - 1) * spacing * 0.5,
            H * spacing + 8.0
        );

        const pinB = glm.vec2.fromValues(
            (W - 1) * spacing * 0.5,
            H * spacing + 8.0
        );

        const stiff = glm.vec3.fromValues(Infinity, Infinity, 0.0);

        this.solver.addForce(
            new Joint(
                [null, cloth[0][0]],
                pinA,
                glm.vec2.fromValues(0, 0),
                stiff
            )
        );

        this.solver.addForce(
            new Joint(
                [null, cloth[0][W - 1]],
                pinB,
                glm.vec2.fromValues(0, 0),
                stiff
            )
        );
    }

    //================================//
    public loadHardcodedLevel12(): void
    {
        const makeBeam = (length: number, width: number, mu: number, lambda: number, clampCenter: glm.vec2, resolution: number) =>
        {
            const dxTarget = resolution; // world-space resolution along length
            const dyTarget = resolution; // world-space resolution along width

            const Nx = Math.max(2, Math.floor(length / dxTarget) + 1);
            const Ny = Math.max(2, Math.floor(width  / dyTarget) + 1);

            const dx = length / (Nx - 1);
            const dy = width  / (Ny - 1);

            const mass = 0.1;

            // Clamped right edge position
            const xRight = clampCenter[0];
            const yCenter = clampCenter[1];

            const xLeft   = xRight - length;
            const yBottom = yCenter - 0.5 * width;

            const beam: RigidBox[][] = [];

            // Particle list
            for (let j = 0; j < Ny; j++)
            {
                beam[j] = [];
                for (let i = 0; i < Nx; i++)
                {
                    const px = xLeft + i * dx;
                    const py = yBottom + j * dy;
                    beam[j][i] = this.makeParticle(px, py, mass, "#ffffff");
                }
            }

            // ALl necessary Neo-Hookean energies
            for (let j = 0; j < Ny - 1; j++)
            {
                for (let i = 0; i < Nx - 1; i++)
                {
                    const A = beam[j][i];
                    const B = beam[j][i + 1];
                    const C = beam[j + 1][i];
                    const D = beam[j + 1][i + 1];

                    // Consistent diagonal A–D
                    this.solver.addEnergy(
                        new NeoHookianEnergy([A, B, D], mu, lambda)
                    );
                    this.solver.addEnergy(
                        new NeoHookianEnergy([A, D, C], mu, lambda)
                    );
                }
            }

            // Right edge is clamped
            const stiff = glm.vec3.fromValues(Infinity, Infinity, 0.0);

            for (let j = 0; j < Ny; j++)
            {
                const p = beam[j][Nx - 1];
                const anchor = glm.vec2.fromValues(
                    p.getPosition()[0],
                    p.getPosition()[1]
                );

                this.solver.addForce(
                    new Joint([null, p], anchor, glm.vec2.fromValues(0, 0), stiff)
                );
            }
        }

        makeBeam(20, 5, 50000, 0.30, glm.vec2.fromValues(0, 0), 1.0);
    }
}

//================================//
export default GameManager;