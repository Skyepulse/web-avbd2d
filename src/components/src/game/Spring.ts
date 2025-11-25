import Force from "./Force";
import * as glm from 'gl-matrix';
import RigidBox from "./RigidBox";
import type { ContactRender, LineRender } from "./Manifold";

// ================================== //
class Spring extends Force
{
    private rA: glm.vec2 = glm.vec2.fromValues(0, 0);
    private rB: glm.vec2 = glm.vec2.fromValues(0, 0);
    private restLength: number = 0;

    private bodyA: RigidBox | null = null;
    private bodyB: RigidBox;

    // ================================== //
    constructor(bodiesArray: (RigidBox | null)[], 
        rA: glm.vec2, rB: glm.vec2, stiffness: number,
        restLength: number = -1)
    {
        super(bodiesArray);

        // We need 1 or 2 bodies
        if (this.getNumberOfBodies() < 1 || this.getNumberOfBodies() > 2)
        {
            console.error("Spring force requires 1 or 2 bodies.");
            this.destroy();
        }

        this.bodyA = (this.getNumberOfBodies() == 2 ? this.bodies[0] : null);
        this.bodyB = (this.getNumberOfBodies() == 2 ? this.bodies[1] : this.bodies[0]);

        this.rA = glm.vec2.clone(rA);
        this.rB = glm.vec2.clone(rB);

        this.restLength = restLength;

        this.stiffness[0] = stiffness;
        if (this.restLength < 0)
        {
            // Compute transformed position of rA and rB
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

            const rotMatrixB: glm.mat2 = this.bodyB.getRotationMatrix();
            glm.vec2.transformMat2(posB, this.rB, rotMatrixB);
            glm.vec2.add(posB, posB, glm.vec2.fromValues(this.bodyB.getPosition()[0], this.bodyB.getPosition()[1]));

            let d: glm.vec2 = glm.vec2.create();
            glm.vec2.subtract(d, posB, posA);
            this.restLength = glm.vec2.length(d);
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
        this.C[0] = L - this.restLength;
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
            this.H[0] = glm.mat3.fromValues(0, 0, 0, 0, 0, 0, 0, 0, 0);
            return;
        }

        const n: glm.vec2 = glm.vec2.scale(glm.vec2.create(), d, 1 / L);
        const dxx: glm.mat2 = glm.mat2.fromValues(
            1 / L - (d[0] * d[0]) / (L2 * L),   -(d[0] * d[1]) / (L2 * L),
            -(d[0] * d[1]) / (L2 * L),          1 / L - (d[1] * d[1]) / (L2 * L)
        );

        const S: glm.mat2 = glm.mat2.fromValues(0, -1, 1, 0);
        
        if (body === this.bodyA)
        {
            const rotMatrixA: glm.mat2 = this.bodyA.getRotationMatrix();
            let r: glm.vec2 = glm.vec2.transformMat2d(glm.vec2.create(), this.rA, rotMatrixA);

            let SrA: glm.vec2 = glm.vec2.transformMat2(glm.vec2.create(), this.rA, S);
            let Sr: glm.vec2 = glm.vec2.transformMat2(glm.vec2.create(), SrA, rotMatrixA);

            let dxr: glm.vec2 = glm.vec2.transformMat2(glm.vec2.create(), Sr, dxx);
            let drr: number = glm.vec2.dot(Sr, dxr) - glm.vec2.dot(n, r);

            this.J[0] = glm.vec3.fromValues(n[0], n[1], glm.vec2.dot(n, Sr));
            this.H[0] = glm.mat3.fromValues(
                dxx[0], dxx[1], dxr[0],
                dxx[2], dxx[3], dxr[1],
                dxr[0], dxr[1], drr
            );
        }
        else
        {
            const rotMatrixB: glm.mat2 = this.bodyB.getRotationMatrix();
            let r: glm.vec2 = glm.vec2.transformMat2d(glm.vec2.create(), this.rB, rotMatrixB);

            let SrA: glm.vec2 = glm.vec2.transformMat2(glm.vec2.create(), this.rB, S);
            let Sr: glm.vec2 = glm.vec2.transformMat2(glm.vec2.create(), SrA, rotMatrixB);
            let dxr: glm.vec2 = glm.vec2.transformMat2(glm.vec2.create(), Sr, dxx);
            let drr: number = glm.vec2.dot(Sr, dxr) - glm.vec2.dot(n, r);

            this.J[0] = glm.vec3.fromValues(n[0], n[1], glm.vec2.dot(n, Sr));
            this.H[0] = glm.mat3.fromValues(
                dxx[0], dxx[1], dxr[0],
                dxx[2], dxx[3], dxr[1],
                dxr[0], dxr[1], drr
            );
        }
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

export default Spring;