import Force from "./Force";
import * as glm from 'gl-matrix';
import RigidBox from "./RigidBox";
import type { ContactRender, LineRender } from "./Manifold";

// ================================== //
class Length extends Force
{
    private rA: glm.vec2 = glm.vec2.fromValues(0, 0);
    private rB: glm.vec2 = glm.vec2.fromValues(0, 0);
    private restLength: number = 0;
    private compliance: number = 0;
    private k_eff: number = 0;

    // ================================== //
    constructor(bodyA: RigidBox | null, bodyB: RigidBox, 
        rA: glm.vec2, rB: glm.vec2, 
        restLength: number = 0, compliance: number = 0)
    {
        super(bodyA, bodyB);

        if (!bodyB)
            throw new Error("Joint requires at least bodyB to be defined.");

        this.rA = glm.vec2.clone(rA);
        this.rB = glm.vec2.clone(rB);

        this.restLength = restLength;
        this.compliance = compliance;

        // Instead of infinite stiffness, allow always some kind of compliance
        this.k_eff = (compliance <= 0) ? 1e12 : 1 / compliance;

        this.stiffness[0] = this.k_eff;
        this.penalty[0] = this.k_eff;
        this.lambda[0] = 0;
        this.fmax[0] = Infinity;
        this.fmin[0] = -Infinity;
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

        let d: glm.vec2 = glm.vec2.create();
        glm.vec2.subtract(d, posB, posA);

        const L = glm.vec2.length(d);
        if (L === 0)
        {
            this.C[0] = 0 * this.compliance;
        }
        else
        {
            this.C[0] = L - this.restLength;
        }
    }

    // ================================== //
    public computeDerivatives(body: RigidBox): void 
    {
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

        let d: glm.vec2 = glm.vec2.create();
        glm.vec2.subtract(d, posB, posA);

        const L = glm.vec2.length(d);
        const L2 = glm.vec2.dot(d, d);

        if (L2 == 0)
        {
            this.J[0] = glm.vec3.fromValues(0, 0, 0);
            return;
        }

        const n: glm.vec2 = glm.vec2.scale(glm.vec2.create(), d, 1 / L);
        
        if (body === this.bodyA)
        {
            const rotMatrixA: glm.mat2 = this.bodyA.getRotationMatrix();
            let r: glm.vec2 = glm.vec2.transformMat2d(glm.vec2.create(), this.rA, rotMatrixA);

            this.J[0] = glm.vec3.fromValues(n[0], n[1], glm.vec2.cross(glm.vec3.create(), r, n)[2]);
        }
        else
        {
            let r = glm.vec2.transformMat2d(glm.vec2.create(), this.rB, rotMatrixB);
            this.J[0] = glm.vec3.fromValues(-n[0], -n[1], -glm.vec2.cross(glm.vec3.create(), r, n)[2]);
        }

        this.H[0] = glm.mat3.fromValues(0, 0, 0, 0, 0, 0, 0, 0, 0);
    }

    // ================================== //
    public getContactRenders(): ContactRender[] 
    {
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

    // ================================== //
    public getContactLines(): LineRender[]
    {
        const lines: LineRender[] = [];

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

        lines.push({ posA: worldPosA, posB: worldPosB, size: 0.4 });
        return lines;
    }
}

export default Length;