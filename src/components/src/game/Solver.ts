/**
 * Solver.ts
 * Responsible for the physics solver that updates rigid bodies based on forces and constraints.
 * Based on Chris Gile's avbd-demo2d C++ implementation.
 * 
 * Uses for now Naive O(n^2) collision detection for simplicity, might modify later.
 */

import * as glm from 'gl-matrix';
import type RigidBox from "./RigidBox";
import Force from "./Force";
import Manifold, { type ContactRender, type LineRender } from './Manifold';
import { outerMat3D, solveLDLT } from '@src/helpers/MathUtils';
import type GameManager from './GameManager';
import type EnergyFEM from './EnergyFEM';
import { EigenProjectionMode } from './EnergyFEM';

const PENALTY_MIN = 1;
const PENALTY_MAX = 1000000000;
const ENERGY_STIFFNESS_MIN = 0.01;

const MAX_STEPS = -100;

//================================//
class Solver
{
    public dt: number = 0;
    public gravity: glm.vec2 = glm.vec2.fromValues(0, -9.81);
    public iterations: number = 10;

    public alpha: number = 0.99;
    public beta: number = 100000;
    public gamma: number = 0.99;
    public betaEnergy: number = 10; // For energy based stabilization
    public useEnergyRamp: boolean = false;

    public postStabilization: boolean = false;

    public bodies: RigidBox[] = [];
    public forces: Force[] = [];
    public energies: EnergyFEM[] = [];

    public contactsToRender: ContactRender[] = [];
    public contactLinesToRender: LineRender[] = [];

    // Performance: average step() CPU time in ms (updated every perfIntervalMs)
    public avgStepTime: number = 0; // ms
    private perfIntervalMs: number = 1000;
    private perfIntervalStart: number = performance.now();
    private perfStepCount: number = 0;
    private perfStepAcc: number = 0; // ms accumulator

    private gameManager: GameManager;

    private urgentStop: boolean = false;
    private currentSteps: number = 0;

    public paused: boolean = false;

    public projectionMode: EigenProjectionMode = EigenProjectionMode.ABSOLUTE;
    private prevTotalElasticEnergy: number = 0;
    private trustRegionRho: number = 0.0;

    // ================================== //
    constructor(gameManager: GameManager)
    {
        this.gameManager = gameManager;
    }

    //============= PUBLIC ===================//
    public Clear(): void {
        const forcesToDestroy = [...this.forces];
        const bodiesToDestroy = [...this.bodies];
        const energiesToDestroy = [...this.energies];
        
        this.forces.length = 0;
        this.bodies.length = 0;
        this.energies.length = 0;
        this.contactsToRender = [];
        
        for (const f of forcesToDestroy) {
            f.destroy();
        }

        for (const e of energiesToDestroy) {
            e.destroy();
        }
        
        for (const b of bodiesToDestroy) {
            b.destroy();
        }

        this.dt = 1 / 60;
        this.postStabilization = true;

        this.avgStepTime = 0;
        this.perfStepCount = 0;
        this.perfStepAcc = 0;
        this.perfIntervalStart = performance.now();

        this.prevTotalElasticEnergy = 0;
        this.trustRegionRho = 0.0;

        this.urgentStop = false;
    }

    //================================//
    public setGravity(newGravity: glm.vec2): void
    {
        if (glm.vec2.length(newGravity) == 0.0)
            newGravity = glm.vec2.fromValues(0, 0.000001);
        this.gravity = newGravity;
    }

    //================================//
    public setAlpha(newAlpha: number): void { this.alpha = newAlpha; }
    public setBeta(newBeta: number): void { this.beta = newBeta; }
    public setGamma(newGamma: number): void { this.gamma = newGamma; }
    public setBetaEnergy(newBetaEnergy: number): void { this.betaEnergy = newBetaEnergy; }
    public setUseEnergyRamp(useEnergyRamp: boolean): void { this.useEnergyRamp = useEnergyRamp; }
    public getUseEnergyRamp(): boolean { return this.useEnergyRamp; }
    public getIsPostStabilization(): boolean { return this.postStabilization; }
    public setIsPostStabilization(isPostStabilization: boolean): void { this.postStabilization = isPostStabilization; }
    public setProjectionMode(mode: EigenProjectionMode): void { this.projectionMode = mode; }
    public getProjectionMode(): EigenProjectionMode { return this.projectionMode; }

    //================================//
    public setDefaults(): void
    {
        this.dt = 1 / 60;
        this.gravity = glm.vec2.fromValues(0, -9.81);
        this.iterations = 10;

        this.beta = 100000;
        this.betaEnergy = 10;
        this.alpha = 0.99;
        this.gamma = 0.99;
        this.projectionMode = EigenProjectionMode.ABSOLUTE;

        // Post stabilization applies an extra iteration to fix positional error.
        // Is used instead of Alpha.
        this.postStabilization = true;
    }

    //================================//
    public step(dt: number): void
    {
        if (this.urgentStop) return;
        if (this.paused) return;

        if (MAX_STEPS > 0 && this.currentSteps > MAX_STEPS) 
        {
            this.urgentStop = true;
            return;
        }

        const stepStart = performance.now();
        if (Math.abs(dt - this.dt) > 0.01)
            this.gameManager.logWarn(`Warning: Physics timestep changed from ${this.dt} to ${dt}. This may cause instability.`);
        
        this.contactsToRender = [];
        this.contactLinesToRender = [];

        // Detection: NAIVE O(n^2) FOR NOW
        for (let i = 0; i < this.bodies.length; ++i)
        {
            for (let j = i + 1; j < this.bodies.length; ++j)
            {
                const bodyA: RigidBox = this.bodies[i];
                const bodyB: RigidBox = this.bodies[j];

                const dp: glm.vec2 = glm.vec2.sub(glm.vec2.create(), bodyA.getPos2(), bodyB.getPos2());
                const r: number = bodyA.getRadius() + bodyB.getRadius();

                if (glm.vec2.squaredLength(dp) <= r * r)
                {
                    if(!bodyA.isConstrainedTo(bodyB))
                    {
                        let newManifold: Manifold = new Manifold([bodyA, bodyB]);
                        this.forces.push(newManifold);
                    }
                }
            }
        }

        // WarmStarting and Initialization FORCES
        for (let i = 0; i < this.forces.length; ++i)
        {
            const force: Force = this.forces[i];
            const isUsed: boolean = force.initialize();

            if (!isUsed)
            {
                // Remove the force if not used.
                this.forces.splice(i, 1);
                --i;

                force.destroy();
                continue;
            }

            this.contactsToRender.push(...force.getContactRenders());
            this.contactLinesToRender.push(...force.getContactLines());

            for (let j = 0; j < force.getRows(); ++j)
            {
                if (this.postStabilization)
                {
                    // REUSE THE PENALTY FROM PREVIOUS STEP by gamma
                    let newPenalty = force.penalty[j] * this.gamma;
                    if (newPenalty < PENALTY_MIN) newPenalty = PENALTY_MIN;
                    if (newPenalty > PENALTY_MAX) newPenalty = PENALTY_MAX;
                    force.penalty[j] = newPenalty;
                }
                else
                {
                    force.lambda[j] = force.lambda[j] * this.alpha * this.gamma;
                    let newPenalty = force.penalty[j] * this.gamma;
                    if (newPenalty < PENALTY_MIN) newPenalty = PENALTY_MIN;
                    if (newPenalty > PENALTY_MAX) newPenalty = PENALTY_MAX;
                    force.penalty[j] = newPenalty;
                }

                force.penalty[j] = Math.min(force.penalty[j], force.stiffness[j]);
            }
        }

        // WarmStarting and Initialization ENERGIES
        for (let i = 0; i < this.energies.length; ++i)
        {
            const energy: EnergyFEM = this.energies[i];
            const isUsed: boolean = energy.initialize();

            if (!isUsed)
            {
                // Remove the energy if not used.
                this.energies.splice(i, 1);
                --i;
                energy.destroy();
                continue;
            }

            this.contactsToRender.push(...energy.getContactRenders());
            this.contactLinesToRender.push(...energy.getContactLines());

            // Warmstarting energies Scale down by gamma and betaEnergy
            for (let j = 0; j < energy.getRows(); ++j)
            {
                let newEffective = energy.effectiveStiffness[j] * this.gamma;
                newEffective = Math.max(ENERGY_STIFFNESS_MIN, newEffective);
                newEffective = Math.min(newEffective, energy.targetStiffness[j]);
                energy.effectiveStiffness[j] = newEffective;
            }
        }

         // Warmstart bodies
        for (let i = 0; i < this.bodies.length; ++i)
        {
            const body: RigidBox = this.bodies[i];

            // Constraint rotation speed
            let rotationVelocity = body.getVelocity()[2];
            if (rotationVelocity > 50) rotationVelocity = 50;
            if (rotationVelocity < -50) rotationVelocity = -50;
            body.setVelocity(glm.vec3.fromValues(body.getVelocity()[0], body.getVelocity()[1], rotationVelocity));

            // The prediction based on current velocity
            body.inertial = glm.vec3.add(glm.vec3.create(), body.getPosition(), glm.vec3.scale(glm.vec3.create(), body.getVelocity(), this.dt));
            if (body.getMass() !== 0)
            {
                let gv = glm.vec3.scale(glm.vec3.create(), glm.vec3.fromValues(this.gravity[0], this.gravity[1], 0), this.dt * this.dt);
                body.inertial = glm.vec3.add(body.inertial, body.inertial, gv);
            }

            // Adaptative warmstarting
            const acceleration: glm.vec3 = glm.vec3.scale(glm.vec3.create(), glm.vec3.sub(glm.vec3.create(), body.getVelocity(), body.getPrevVelocity()), 1 / this.dt);
            const accelExt: number = acceleration[1] * Math.sign(this.gravity[1]);
            let accelWeight: number = accelExt / Math.abs(this.gravity[1]);
            if (accelWeight < 0) accelWeight = 0;
            if (accelWeight > 1) accelWeight = 1;

            body.lastPosition = glm.vec3.clone(body.getPosition());
            const term2: glm.vec3 = glm.vec3.scale(glm.vec3.create(), body.getVelocity(), this.dt);
            const term3: glm.vec3 = glm.vec3.scale(glm.vec3.create(), glm.vec3.fromValues(this.gravity[0], this.gravity[1], 0), accelWeight * this.dt * this.dt);
            body.setPosition(glm.vec3.add(glm.vec3.create(), body.getPosition(), glm.vec3.add(glm.vec3.create(), term2, term3)));
        }

        // Main iteration loop
        const iterations = this.iterations + (this.postStabilization ? 1 : 0);

        for (let iter = 0; iter < iterations; ++iter)
        {
            let currentAlpha: number = this.alpha;
            let predictedDecrease = 0;

            // PRIMAL FIRST
            for (const body of this.bodies)
            {
                if (body.isStatic()) continue;

                // Equation 5 and 6 
                const M: glm.mat3 = glm.mat3.fromValues(
                    body.getMass(), 0, 0,
                    0, body.getMass(), 0,
                    0, 0, body.getMoment()
                );   
                const lhs: glm.mat3 = glm.mat3.multiplyScalar(glm.mat3.create(), M, 1 / (this.dt * this.dt));
                const rhs: glm.vec3 = glm.vec3.transformMat3(glm.vec3.create(), glm.vec3.sub(glm.vec3.create(), body.getPosition(), body.inertial), lhs);

                for (const force of body.forces)
                {
                    force.computeConstraints(currentAlpha);
                    force.computeDerivatives(body);

                    for (let j = 0; j < force.getRows(); ++j)
                    {
                        // if stifness is infinity, use lambda
                        let lambda: number = (force.stiffness[j] === Infinity) ? force.lambda[j] : 0;

                        // Clamped force magnitude
                        let f: number = force.penalty[j] * force.C[j] + lambda;
                        if (f < force.fmin[j]) f = force.fmin[j];
                        if (f > force.fmax[j]) f = force.fmax[j];

                        // Build diagonal G matrix for Hessian regularization
                        const G: glm.mat3 = glm.mat3.fromValues(
                            glm.vec3.length(glm.vec3.fromValues(force.H[j][0], force.H[j][3], force.H[j][6])), 0, 0,
                            0, glm.vec3.length(glm.vec3.fromValues(force.H[j][1], force.H[j][4], force.H[j][7])), 0,
                            0, 0, glm.vec3.length(glm.vec3.fromValues(force.H[j][2], force.H[j][5], force.H[j][8]))
                        );
                        glm.mat3.multiplyScalar(G, G, Math.abs(f));

                        // Accumulate forces (equation 13) and hessian (equation 17)
                        glm.vec3.add(rhs, rhs, glm.vec3.scale(glm.vec3.create(), force.J[j], f));
                        const outer: glm.mat3 = outerMat3D(force.J[j], glm.vec3.scale(glm.vec3.create(), force.J[j], force.penalty[j]));
                        glm.mat3.add(lhs, lhs, outer);
                        glm.mat3.add(lhs, lhs, G);
                    }
                }

                for (const energy of body.energies)
                {
                    energy.computeEnergyTerms(body , this.projectionMode, this.trustRegionRho);

                    const rows = energy.getRows();
                    for (let j = 0; j < rows; ++j)
                    {
                        // force magnitude
                        const mag: number = glm.vec3.length(energy.grad_E[j]);
                        if (isNaN(mag))
                        {
                            this.urgentStop = true;
                            this.gameManager.logWarn("NaN detected in energy gradient, stopping simulation to prevent instability.");
                            return;
                        }

                        const stiffnessRatio = energy.effectiveStiffness[j] / energy.targetStiffness[j];
                        const scaledGrad = glm.vec3.scale(glm.vec3.create(), energy.grad_E[j], stiffnessRatio);
                        const scaledHess = glm.mat3.multiplyScalar(glm.mat3.create(), energy.hess_E[j], stiffnessRatio);

                        const diagReg = mag * stiffnessRatio * 0.01;
                        scaledHess[0] += diagReg;
                        scaledHess[4] += diagReg; // Diagonal terms only. (8 is 0 anyzays in 2D)
                        
                        // Accumulate forces (equation 13) and hessian (equation 17)
                        if (this.useEnergyRamp)
                        {
                            glm.vec3.add(rhs, rhs, scaledGrad);
                            glm.mat3.add(lhs, lhs, scaledHess); // We keep it SPD friendly
                        }
                        else
                        {
                            glm.vec3.add(rhs, rhs, energy.grad_E[j]);
                            glm.mat3.add(lhs, lhs, energy.hess_E[j]);
                        }
                    }
                }

                const dx: glm.vec3 = solveLDLT(lhs, rhs);
                body.setPosition(glm.vec3.sub(glm.vec3.create(), body.getPosition(), dx));

                for (const energy of body.energies) {
                    for (let j = 0; j < energy.getRows(); ++j) {
                        predictedDecrease += 0.5 * glm.vec3.dot(dx, energy.grad_E[j]);
                    }
                }          
            }

            // Update of the trust-region ratio for ADAPTIVE projection
            if (this.projectionMode === EigenProjectionMode.ADAPTIVE) 
            {

                // Sum cached energies (computed for free during computeEnergyTerms)
                let currentTotalEnergy = 0;
                for (const energy of this.energies) 
                {
                    currentTotalEnergy += energy.getCachedEnergy();
                }
                
                // Compute trust-region ratio (Chen et al. 2024, Eq. 21)
                const actualDecrease = this.prevTotalElasticEnergy - currentTotalEnergy;
                if (Math.abs(predictedDecrease) > 1e-10) 
                {
                    this.trustRegionRho = actualDecrease / predictedDecrease;
                } else 
                {
                    this.trustRegionRho = 1.0; // Default to clamping if no predicted change
                }
                
                this.prevTotalElasticEnergy = currentTotalEnergy;
            }

            // DUAL UPDATE, except for last iteration if post-stabilization
            if (iter < this.iterations)
            {
                // Dual update for forces
                for (const force of this.forces)
                {
                    force.computeConstraints(currentAlpha);

                    for (let j = 0; j < force.getRows(); ++j)
                    {
                        let lambda: number = (force.stiffness[j] === Infinity) ? force.lambda[j] : 0;

                        // Update the lambda
                        force.lambda[j] = lambda + force.penalty[j] * force.C[j];
                        if (force.lambda[j] < force.fmin[j]) force.lambda[j] = force.fmin[j];
                        if (force.lambda[j] > force.fmax[j]) force.lambda[j] = force.fmax[j];

                        // If it exceeds fracture threshold, disable it.
                        if (Math.abs(force.lambda[j]) >= force.fracture[j]) force.disable();

                        // update penalty
                        if (force.lambda[j] > force.fmin[j] && force.lambda[j] < force.fmax[j])
                        {
                            force.penalty[j] = Math.min(force.penalty[j] + this.beta * Math.abs(force.C[j]), Math.min(force.stiffness[j], PENALTY_MAX));
                        }
                    }
                }

                // Stiffness update for energies
                for (const energy of this.energies)
                {
                    energy.updateStrainMeasures();
                    for (let j = 0; j < energy.getRows(); ++j)
                    {
                        // Ramp up effective stiffness based on strain measure
                        // Equation 16 from VBD paper: k^{n+1} = min(k*, k^n + β|C|)
                        const strainMag = energy.strainMeasure[j];
                        const newStiffness = energy.effectiveStiffness[j] + this.betaEnergy * strainMag;
                        energy.effectiveStiffness[j] = Math.min(newStiffness, energy.targetStiffness[j]); // NEVER go beyond target stiffness
                    }
                }
            }

            // Post stabilization
            if (iter == this.iterations - 1)
            {
                for (const body of this.bodies)
                {
                    if (body.getMass() > 0)
                    {
                        body.prevVelocity = body.getVelocity();
                        const newVelocity: glm.vec3 = glm.vec3.sub(glm.vec3.create(), body.getPosition(), body.lastPosition);
                        if (body.isDragged)
                        {
                            glm.vec3.add(newVelocity, newVelocity, body.addedDragVelocity);
                            glm.vec3.set(body.addedDragVelocity, 0, 0, 0);
                        }
                        glm.vec3.scale(newVelocity, newVelocity, 1 / this.dt);
                        body.setVelocity(newVelocity);
                    }
                }
            }
        }

        // Measure step time (ms) and accumulate for averaging
        const stepEnd = performance.now();
        const stepMs = stepEnd - stepStart;
        this.perfStepCount++;
        this.perfStepAcc += stepMs;
        const now = performance.now();
        if (now - this.perfIntervalStart >= this.perfIntervalMs) {
            const frames = Math.max(1, this.perfStepCount);
            this.avgStepTime = this.perfStepAcc / frames;
            // reset
            this.perfIntervalStart = now;
            this.perfStepCount = 0;
            this.perfStepAcc = 0;
        }
    }

    //================================//
    public addRigidBox(box: RigidBox): void
    {
        if (this.bodies.indexOf(box) === -1)
            this.bodies.push(box);
    }

    //================================//
    public removeRigidBox(box: RigidBox): void
    {
        const index = this.bodies.indexOf(box);
        
        const forces = [...box.getAllForces()];

        for (const f of forces)
        {
            const idx = this.forces.indexOf(f);
            if (idx !== -1) this.forces.splice(idx, 1);
            
            f.destroy();
        }

        if (index !== -1)
            this.bodies.splice(index, 1);
        
        box.destroy();
    }

    // ================================== //
    public addForce(force: Force): void
    {
        if (this.forces.indexOf(force) === -1)
            this.forces.push(force);
    }

    // ================================== //
    public addEnergy(energy: EnergyFEM): void
    {
        if (this.energies.indexOf(energy) === -1)
            this.energies.push(energy);
    }

    // ================================== //
    public removeForce(force: Force): void
    {
        const index = this.forces.indexOf(force);
        if (index !== -1)
            this.forces.splice(index, 1);
        force.destroy();
    }

    // ================================== //
    public removeEnergy(energy: EnergyFEM): void
    {
        const index = this.energies.indexOf(energy);
        if (index !== -1)
            this.energies.splice(index, 1);
        energy.destroy();
    }
}

export default Solver;