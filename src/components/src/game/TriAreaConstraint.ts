import Force from "./Force";
import * as glm from 'gl-matrix';
import RigidBox from "./RigidBox";
import type { ContactRender, LineRender } from "./Manifold";
import { transform2D } from "@src/helpers/MathUtils";

// ================================== //
class TriAreaConstraint extends Force
{
    private rA: glm.vec2 = glm.vec2.fromValues(0, 0);
    private rB: glm.vec2 = glm.vec2.fromValues(0, 0);
    private rC: glm.vec2 = glm.vec2.fromValues(0, 0);

    private restArea: number = 0;

    private bodyA: RigidBox;
    private bodyB: RigidBox;
    private bodyC: RigidBox;

    // ================================== //
    constructor(bodiesArray: (RigidBox | null)[], 
        rA: glm.vec2, rB: glm.vec2, rC: glm.vec2, stiffness: number)
    {
        super(bodiesArray);

        // Need 3 bodies, each being a particle
        if (this.getNumberOfBodies() != 3)
        {
            console.error("TriAreaConstraint force requires 3 bodies.");
            this.destroy();
        }

        this.bodyA = this.bodies[0]!;
        this.bodyB = this.bodies[1]!;
        this.bodyC = this.bodies[2]!;

        this.rA = glm.vec2.clone(rA);
        this.rB = glm.vec2.clone(rB);
        this.rC = glm.vec2.clone(rC);

        this.stiffness[0] = stiffness;

        // Calculate ideal rest area
        const posA: glm.vec2 = transform2D(this.bodyA.getPosition(), this.rA);
        const posB: glm.vec2 = transform2D(this.bodyB.getPosition(), this.rB);
        const posC: glm.vec2 = transform2D(this.bodyC.getPosition(), this.rC);

        const AB: glm.vec2 = glm.vec2.subtract(glm.vec2.create(), posB, posA);
        const AC: glm.vec2 = glm.vec2.subtract(glm.vec2.create(), posC, posA);

        // no ABS: we suppose CCW winding
        this.restArea = 0.5 * (AB[0] * AC[1] - AB[1] * AC[0]); // AB x AC

        if (this.restArea < 0)
        {
            console.warn("TriAreaConstraint: The triangle area is negative. Check the winding order of the particles.");
            this.destroy();
        }
    }

    // ================================== //
    public getRows(): number { return 1; }

    // ================================== //
    public initialize(): boolean 
    {
        // Nothing to initialize
        return true;
    }

    // ================================== //
    public computeConstraints(_alpha: number): void
    {
        // Constraint should enforce C = A - A0 = 0
        const posA: glm.vec2 = transform2D(this.bodyA.getPosition(), this.rA);
        const posB: glm.vec2 = transform2D(this.bodyB.getPosition(), this.rB);
        const posC: glm.vec2 = transform2D(this.bodyC.getPosition(), this.rC);

        const AB: glm.vec2 = glm.vec2.subtract(glm.vec2.create(), posB, posA);
        const AC: glm.vec2 = glm.vec2.subtract(glm.vec2.create(), posC, posA);
        const area: number = 0.5 * (AB[0] * AC[1] - AB[1] * AC[0]);

        this.C[0] = area - this.restArea;
    }

    // ================================== //
    public computeDerivatives(body: RigidBox): void 
    {
        // WE ASSUME NO ROTATION FOR PARTICLES
        const posA: glm.vec2 = transform2D(this.bodyA.getPosition(), this.rA);
        const posB: glm.vec2 = transform2D(this.bodyB.getPosition(), this.rB);
        const posC: glm.vec2 = transform2D(this.bodyC.getPosition(), this.rC);
        
        // A = 0.5 * (AB.x * AC.y - AB.y * AC.x)
        // A = 0.5 * ((xB - xA) * (yC - yA) - (yB - yA) * (xC - xA))
        // dA/dxA = 0.5 * (-(yC - yA) + (yB - yA)) = 0.5 * (yB - yC)
        // dA/dyA = 0.5 * ( (xC - xA) - (xB - xA)) = 0.5 * (xC - xB)

        // Jacobian
        switch (body)
        {
            case this.bodyA:
                const dC_dA_x = 0.5 * (posB[1] - posC[1]);
                const dC_dA_y = 0.5 * (posC[0] - posB[0]);
                this.J[0] = glm.vec3.fromValues(dC_dA_x, dC_dA_y, 0);
                break;

            case this.bodyB:
                const dC_dB_x = 0.5 * (posC[1] - posA[1]);
                const dC_dB_y = 0.5 * (posA[0] - posC[0]);
                this.J[0] = glm.vec3.fromValues(dC_dB_x, dC_dB_y, 0);
                break;
            
            case this.bodyC:
                const dC_dC_x = 0.5 * (posA[1] - posB[1]);
                const dC_dC_y = 0.5 * (posB[0] - posA[0]);
                this.J[0] = glm.vec3.fromValues(dC_dC_x, dC_dC_y, 0);
                break;
        }

        // Hessian:
        this.H[0] = glm.mat3.fromValues(0, 0, 0,
                                        0, 0, 0,
                                        0, 0, 0);
    }

    // ================================== //
    public getContactRenders(): ContactRender[] 
    {
        return [];
    }

    // ================================== //
    public getContactLines(): LineRender[] 
    {
        return [];
    }
}

// ================================== //
export default TriAreaConstraint;