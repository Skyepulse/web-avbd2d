import Force from "./Force";
import * as glm from 'gl-matrix';
import RigidBox from "./RigidBox";
import type { ContactRender, LineRender } from "./Manifold";
import { outerMat2D, rotate2D, scale2D, scaleMat2D, transform2D } from "@src/helpers/MathUtils";

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
            const posA: glm.vec2 = transform2D(this.bodyA ? this.bodyA.getPosition() : glm.vec3.fromValues(0, 0, 0), this.rA);
            const posB: glm.vec2 = transform2D(this.bodyB.getPosition(), this.rB);

            const d = glm.vec2.subtract(glm.vec2.create(), posA, posB);
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
        const posA: glm.vec2 = transform2D(this.bodyA ? this.bodyA.getPosition() : glm.vec3.fromValues(0, 0, 0), this.rA);
        const posB: glm.vec2 = transform2D(this.bodyB.getPosition(), this.rB);

        const d = glm.vec2.subtract(glm.vec2.create(), posA, posB);

        const L = glm.vec2.length(d);
        this.C[0] = L - this.restLength;
    }

    // ================================== //
    public computeDerivatives(body: RigidBox): void 
    {
        const posA: glm.vec2 = transform2D(this.bodyA ? this.bodyA.getPosition() : glm.vec3.fromValues(0, 0, 0), this.rA);
        const posB: glm.vec2 = transform2D(this.bodyB.getPosition(), this.rB);
        
        const d = glm.vec2.subtract(glm.vec2.create(), posA, posB);

        const L = glm.vec2.length(d);
        const L2 = glm.vec2.dot(d, d);

        if (L2 == 0)
        {
            this.J[0] = glm.vec3.fromValues(0, 0, 0);
            this.H[0] = glm.mat3.fromValues(0, 0, 0, 0, 0, 0, 0, 0, 0);
            return;
        }

        const n: glm.vec2 = glm.vec2.scale(glm.vec2.create(), d, 1 / L);

        //(I - outer(n, n) / dlen2) / dlen
        let outernn = outerMat2D(n, n);
        outernn = scaleMat2D(outernn, 1 / L2);
        let dxx = glm.mat2.subtract(glm.mat2.create(), glm.mat2.fromValues(1, 0, 0, 1), outernn);
        dxx = scaleMat2D(dxx, 1 / L);

        const S: glm.mat2 = glm.mat2.fromValues(0, -1, 1, 0);
        
        if (body === this.bodyA)
        {
            
            const r = rotate2D(this.rA, this.bodyA.getPosition()[2]);

            const SrA: glm.vec2 = glm.vec2.transformMat2(glm.vec2.create(), this.rA, S);
            const Sr = rotate2D(SrA, this.bodyA.getPosition()[2]);

            const dxr: glm.vec2 = glm.vec2.transformMat2(glm.vec2.create(), Sr, dxx);
            const drr: number = glm.vec2.dot(Sr, dxr) - glm.vec2.dot(n, r);

            this.J[0] = glm.vec3.fromValues(n[0], n[1], glm.vec2.dot(n, Sr));
            this.H[0] = glm.mat3.fromValues(
                dxx[0], dxx[2], dxr[0],
                dxx[1], dxx[3], dxr[1],
                dxr[0], dxr[1], drr
            );
        }
        else
        {
            const r = rotate2D(this.rB, this.bodyB.getPosition()[2]);

            const SrB: glm.vec2 = glm.vec2.transformMat2(glm.vec2.create(), this.rB, S);
            const Sr = rotate2D(SrB, this.bodyB.getPosition()[2]);
            const minusSr = scale2D(Sr, -1);

            const dxr: glm.vec2 = glm.vec2.transformMat2(glm.vec2.create(), minusSr, dxx);
            const drr: number = glm.vec2.dot(Sr, dxr) + glm.vec2.dot(n, r);

            this.J[0] = glm.vec3.fromValues(-n[0], -n[1], glm.vec2.dot(n, minusSr));
            this.H[0] = glm.mat3.fromValues(
                dxx[0], dxx[2], dxr[0],
                dxx[1], dxx[3], dxr[1],
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