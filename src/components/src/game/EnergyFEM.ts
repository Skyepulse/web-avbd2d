// EnergyFEM is supposed to be the counterpart of constraint based forces,
// we will directly output per vertex (body) the energy derivative into the rhs 
// and the hessian inside the lhs matrix.
// We do have to project into PSD the Hessian beforehand to ensure stability.

import * as glm from 'gl-matrix';
import type RigidBox from './RigidBox';
import type { ContactRender, LineRender } from './Manifold';

class EnergyFEM
{
    public bodies: RigidBox[] = [];
    public MAX_ROWS: number = 4; // Arbitrary for now

    public grad_E: glm.vec3[] = []; // VECTOR3 grad_E
    public hess_E: glm.mat3[] = []; // MATRIX3 hess_E

    public effectiveStiffness: number[] = [];   // ramped stiffness
    public targetStiffness: number[] = [];      // material stiffness

    public strainMeasure: number[] = [];    // current strain measure for ramp up (analogous to constraint violation)

    public fmin: number[] = [];
    public fmax: number[] = [];

    // =============== PUBLIC =================== //
    constructor(bodiesArray: (RigidBox | null)[])
    {
        bodiesArray.forEach((body) => {
            if (body)
            {
                this.bodies.push(body);
                body.energies.push(this);
            }
        });

        for (let i = 0; i < this.MAX_ROWS; ++i)
        {
            this.grad_E.push(glm.vec3.fromValues(0, 0, 0));
            this.hess_E.push(glm.mat3.create());

            this.targetStiffness.push(1.0);
            this.effectiveStiffness.push(1.0);
            this.strainMeasure.push(0.0);
            this.fmin.push(-Infinity);
            this.fmax.push(Infinity);
        }
    }

    // ================================== //
    public getBodies(): RigidBox[]
    {
        return this.bodies;
    }

    //================================//
    public initialize(): boolean
    {
        // Nothing to initialize
        return true;
    }

    // ================================== //
    public getNumberOfBodies(): number
    {
        return this.bodies.length;
    }

    // ================================ //
    public getRows(): number
    {
        console.warn("This method should not be called directly.");
        return 0;
    }

    // ================================== //
    // Subclasses must implement this to compute:
    // - grad_E[j]: the energy gradient (force)
    // - hess_E[j]: the energy Hessian
    // - strainMeasure[j]: a scalar measure of deformation (for stiffness ramping)
    public computeEnergyTerms(_body: RigidBox): void
    {
        console.warn("This method should not be called directly.");
    }

    //================================//
    public updateStrainMeasures(): void
    {
        console.warn("This method should not be called directly.");
    }
    
    // ================================== //
    public destroy(): void
    {
        this.bodies.forEach((body) => {
            const index = body.energies.indexOf(this);
            if (index !== -1) {
                body.energies.splice(index, 1);
            }
        });

        this.bodies.length = 0;
        this.grad_E.length = 0;
        this.hess_E.length = 0;
        this.effectiveStiffness.length = 0;
        this.targetStiffness.length = 0;
        this.strainMeasure.length = 0;
    }

    //================================//
    public getContactRenders(): ContactRender[]
    {
        console.warn("This method should not be called directly.");
        return [];
    }

    // ================================== //
    // posA, posB, size
    public getContactLines(): LineRender[] 
    {
        console.warn("This method should not be called directly.");
        return [];
    }
}

// ================================ //
export default EnergyFEM;