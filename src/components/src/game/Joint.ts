import Force from "./Force";
import * as glm from 'gl-matrix';
import RigidBox from "./RigidBox";
import type { ContactRender } from "./Manifold";

// ================================== //
class Joint extends Force
{
    public rA: glm.vec2 = glm.vec2.fromValues(0, 0);
    private rB: glm.vec2 = glm.vec2.fromValues(0, 0);
    private C0: glm.vec3 = glm.vec3.fromValues(0, 0, 0);
    private torqueArm: number = 0;
    private restAngle: number = 0;

    // ================================== //
    constructor(bodyA: RigidBox | null, bodyB: RigidBox, 
        rA: glm.vec2, rB: glm.vec2, 
        stiffness: glm.vec3 = glm.vec3.fromValues(Infinity, Infinity, Infinity), fracture: number = Infinity)
    {
        super(bodyA, bodyB);

        if (!bodyB)
            throw new Error("Joint requires at least bodyB to be defined.");

        this.rA = glm.vec2.clone(rA);
        this.rB = glm.vec2.clone(rB);
        
        this.stiffness[0] = stiffness[0];
        this.stiffness[1] = stiffness[1];
        this.stiffness[2] = stiffness[2];

        this.fmax[2] = fracture;
        this.fmin[2] = -fracture;

        this.fracture[2] = fracture;

        this.restAngle = (bodyA ? bodyA.getPosition()[2] : 0) - bodyB.getPosition()[2];
        const tA: glm.vec2 = bodyA ? bodyA.getScale() : glm.vec2.fromValues(0, 0);
        const tB: glm.vec2 = bodyB.getScale();
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
        let posA: glm.vec2 = glm.vec2.fromValues(0, 0);
        let posB: glm.vec2 = glm.vec2.fromValues(0, 0);

        if (this.bodyA) 
        {
            // Transform in the way:
            // bodyA.rotation * rA + bodyA.position
            const rotMatrixA: glm.mat2 = this.bodyA.getRotationMatrix();
            glm.vec2.transformMat2(posA, this.rA, rotMatrixA);
            glm.vec2.add(posA, posA, glm.vec2.fromValues(this.bodyA.getPosition()[0], this.bodyA.getPosition()[1]));
        } 
        else
        {
            glm.vec2.copy(posA, this.rA);
        }

        const rotMatrixB: glm.mat2 = this.bodyB.getRotationMatrix();
        glm.vec2.transformMat2(posB, this.rB, rotMatrixB);
        glm.vec2.add(posB, posB, glm.vec2.fromValues(this.bodyB.getPosition()[0], this.bodyB.getPosition()[1]));

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
        let posA: glm.vec2 = glm.vec2.fromValues(0, 0);
        let posB: glm.vec2 = glm.vec2.fromValues(0, 0);

        if (this.bodyA) 
        {
            // Transform in the way:
            // bodyA.rotation * rA + bodyA.position
            const rotMatrixA: glm.mat2 = this.bodyA.getRotationMatrix();
            glm.vec2.transformMat2(posA, this.rA, rotMatrixA);
            glm.vec2.add(posA, posA, glm.vec2.fromValues(this.bodyA.getPosition()[0], this.bodyA.getPosition()[1]));
        } 
        else
        {
            glm.vec2.copy(posA, this.rA);
        }

        const rotMatrixB: glm.mat2 = this.bodyB.getRotationMatrix();
        glm.vec2.transformMat2(posB, this.rB, rotMatrixB);
        glm.vec2.add(posB, posB, glm.vec2.fromValues(this.bodyB.getPosition()[0], this.bodyB.getPosition()[1]));

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
            let rotatedRA: glm.vec2 = glm.vec2.fromValues(0, 0);
            const rotMatrixA: glm.mat2 = this.bodyA.getRotationMatrix();
            glm.vec2.transformMat2(rotatedRA, this.rA, rotMatrixA);
            this.J[0] =  glm.vec3.fromValues( 1, 0, -rotatedRA[1]);
            this.J[1] =  glm.vec3.fromValues( 0, 1,  rotatedRA[0]);
            this.J[2] =  glm.vec3.fromValues( 0, 0, 1 * this.torqueArm);
            this.H[0] =  glm.mat3.fromValues( 0, 0, 0, 0, 0, 0, 0, 0, -rotatedRA[0]);
            this.H[1] =  glm.mat3.fromValues( 0, 0, 0, 0, 0, 0, 0, 0, -rotatedRA[1]);
            this.H[2] =  glm.mat3.fromValues( 0, 0, 0, 0, 0, 0, 0, 0, 0);
        }
        else if (body === this.bodyB)
        {
            let rotatedRB: glm.vec2 = glm.vec2.fromValues(0, 0);
            const rotMatrixB: glm.mat2 = this.bodyB.getRotationMatrix();
            glm.vec2.transformMat2(rotatedRB, this.rB, rotMatrixB);
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

        let worldPosA: glm.vec2 = glm.vec2.fromValues(0, 0);
        let worldPosB: glm.vec2 = glm.vec2.fromValues(0, 0);

        if (this.bodyA) 
        {
            const rotMatrixA: glm.mat2 = this.bodyA.getRotationMatrix();
            glm.vec2.transformMat2(worldPosA, this.rA, rotMatrixA);
            glm.vec2.add(worldPosA, worldPosA, glm.vec2.fromValues(this.bodyA.getPosition()[0], this.bodyA.getPosition()[1]));
        }
        else
        {
            glm.vec2.copy(worldPosA, this.rA);
        }

        const rotMatrixB: glm.mat2 = this.bodyB.getRotationMatrix();
        glm.vec2.transformMat2(worldPosB, this.rB, rotMatrixB);
        glm.vec2.add(worldPosB, worldPosB, glm.vec2.fromValues(this.bodyB.getPosition()[0], this.bodyB.getPosition()[1]));

        renders.push({pos: worldPosA});
        renders.push({pos: worldPosB});
        return renders;
    }
};

export default Joint;