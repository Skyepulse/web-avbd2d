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

    public stiffness: number[] = []; // per row stiffness
    public lambda: number[] = [];
    public penalty: number[] = [];
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

            const m = glm.mat3.create();
            this.hess_E.push(m);

            this.stiffness.push(Infinity);
            this.lambda.push(0);
            this.penalty.push(0);
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
    public computeEnergyTerms(_body: RigidBox): void
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