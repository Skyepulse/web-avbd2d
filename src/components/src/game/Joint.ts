import Force from "./Force";
import * as glm from 'gl-matrix';
import RigidBox from "./RigidBox";
import type { ContactRender } from "./Manifold";
import type { LineRender } from "./Manifold";
import { rotate2D, transform2D } from "@src/helpers/MathUtils";

// ================================== //
class Joint extends Force
{
    public rA: glm.vec2 = glm.vec2.fromValues(0, 0);
    private rB: glm.vec2 = glm.vec2.fromValues(0, 0);
    private C0: glm.vec3 = glm.vec3.fromValues(0, 0, 0);
    private torqueArm: number = 0;
    private restAngle: number = 0;

    private bodyA: RigidBox | null = null;
    private bodyB: RigidBox;

    // ================================== //
    constructor(bodiesArray: (RigidBox | null)[], 
        rA: glm.vec2, rB: glm.vec2, 
        stiffness: glm.vec3 = glm.vec3.fromValues(Infinity, Infinity, Infinity), fracture: number = Infinity)
    {
        // This force must require 1 or 2 bodies
        super(bodiesArray);

        if (this.getNumberOfBodies() < 1 || this.getNumberOfBodies() > 2)
        {
            console.error("Joint force requires 1 or 2 bodies.");
            this.destroy();
        }

        this.bodyA = (this.getNumberOfBodies() == 2 ? this.bodies[0] : null);
        this.bodyB = (this.getNumberOfBodies() == 2 ? this.bodies[1] : this.bodies[0]);

        this.rA = glm.vec2.clone(rA);
        this.rB = glm.vec2.clone(rB);
        
        this.stiffness[0] = stiffness[0];
        this.stiffness[1] = stiffness[1];
        this.stiffness[2] = stiffness[2];

        this.fmax[2] = fracture;
        this.fmin[2] = -fracture;

        this.fracture[2] = fracture;

        this.restAngle = (this.bodyA ? this.bodyA.getPosition()[2] : 0) - this.bodyB.getPosition()[2];
        const tA: glm.vec2 = this.bodyA ? this.bodyA.getScale() : glm.vec2.fromValues(0, 0);
        const tB: glm.vec2 = this.bodyB.getScale();
        this.torqueArm = glm.vec2.sqrLen(glm.vec2.add(glm.vec2.create(), tA, tB));
    }

    // ================================== //
    public getRows(): number 
    {
        return 3;
    }

    // ================================== //
    public initialize(): boolean 
    {
        
        // Body A is optional, it can be the mouse world position or an anchor in world space
        this.C0 = glm.vec3.fromValues(0, 0, 0);
        let posA: glm.vec2 = transform2D(this.bodyA ? this.bodyA.getPosition() : glm.vec3.fromValues(0, 0, 0), this.rA);
        const posB = transform2D(this.bodyB.getPosition(), this.rB);

        let deltaPos: glm.vec2 = glm.vec2.subtract(glm.vec2.create(), posA, posB);
        this.C0[0] = deltaPos[0];
        this.C0[1] = deltaPos[1];

        // ((bodyA ? bodyA->position.z : 0) - bodyB->position.z - restAngle) * torqueArm;
        const angleA = this.bodyA ? this.bodyA.getPosition()[2] : 0;
        const angleB = this.bodyB.getPosition()[2];
        this.C0[2] = (angleA - angleB - this.restAngle) * this.torqueArm;

        return this.stiffness[0] != 0 || this.stiffness[1] != 0 || this.stiffness[2] != 0;
    }   

    // ================================== //
    public computeConstraints(alpha: number): void 
    {
        let Cn: glm.vec3 = glm.vec3.fromValues(0, 0, 0);
        let posA: glm.vec2 = transform2D(this.bodyA ? this.bodyA.getPosition() : glm.vec3.fromValues(0, 0, 0), this.rA);
        const posB: glm.vec2 = transform2D(this.bodyB.getPosition(), this.rB);

        Cn[0] = posA[0] - posB[0];
        Cn[1] = posA[1] - posB[1];
        Cn[2] = ((this.bodyA ? this.bodyA.getPosition()[2] : 0) - this.bodyB.getPosition()[2] - this.restAngle) * this.torqueArm;

        for (let i = 0; i < 3; ++i)
        {
            this.C[i] = Cn[i];

            // Except if infinite value
            if (this.stiffness[i] === Infinity)
            {
                this.C[i] = Cn[i] - this.C0[i] * alpha;
            }
        }
    }

    // ================================== //
    public computeDerivatives(body: RigidBox): void 
    {
        if (body === this.bodyA)
        {
            const rotatedRA = rotate2D(this.rA, this.bodyA.getPosition()[2]);
            this.J[0] =  glm.vec3.fromValues( 1, 0, -rotatedRA[1]);
            this.J[1] =  glm.vec3.fromValues( 0, 1,  rotatedRA[0]);
            this.J[2] =  glm.vec3.fromValues( 0, 0, 1 * this.torqueArm);
            this.H[0] =  glm.mat3.fromValues( 0, 0, 0, 0, 0, 0, 0, 0, -rotatedRA[0]);
            this.H[1] =  glm.mat3.fromValues( 0, 0, 0, 0, 0, 0, 0, 0, -rotatedRA[1]);
            this.H[2] =  glm.mat3.fromValues( 0, 0, 0, 0, 0, 0, 0, 0, 0);
        }
        else if (body === this.bodyB)
        {
            const rotatedRB = rotate2D(this.rB, this.bodyB.getPosition()[2]);
            this.J[0] =  glm.vec3.fromValues( -1, 0, rotatedRB[1]);
            this.J[1] =  glm.vec3.fromValues( 0, -1, -rotatedRB[0]);
            this.J[2] =  glm.vec3.fromValues( 0, 0, -1 * this.torqueArm);
            this.H[0] =  glm.mat3.fromValues( 0, 0, 0, 0, 0, 0, 0, 0, rotatedRB[0]);
            this.H[1] =  glm.mat3.fromValues( 0, 0, 0, 0, 0, 0, 0, 0, rotatedRB[1]);
            this.H[2] =  glm.mat3.fromValues( 0, 0, 0, 0, 0, 0, 0, 0, 0);
        }
    }

    // ================================== //
    public getContactRenders(): ContactRender[] {

        const renders: ContactRender[] = [];

        let worldPosA: glm.vec2 = transform2D(this.bodyA ? this.bodyA.getPosition() : glm.vec3.fromValues(0, 0, 0), this.rA);
        const worldPosB: glm.vec2 = transform2D(this.bodyB.getPosition(), this.rB);

        renders.push({pos: worldPosA});
        renders.push({pos: worldPosB});
        return renders;
    }

    // ================================== //
    public getContactLines(): LineRender[] 
    {
        const lines: LineRender[] = [];

        let worldPosA: glm.vec2 = transform2D(this.bodyA ? this.bodyA.getPosition() : glm.vec3.fromValues(0, 0, 0), this.rA);
        const worldPosB: glm.vec2 = transform2D(this.bodyB.getPosition(), this.rB);
        
        lines.push({ posA: worldPosA, posB: worldPosB, size: 0.2 });
        return lines;
    }
};

export default Joint;