import { scaleMat2D } from "@src/helpers/MathUtils";
import EnergyFEM from "./EnergyFEM";
import type RigidBox from "./RigidBox";
import * as glm from "gl-matrix";
import type { ContactRender, LineRender } from "./Manifold";

// ================================== //
class StVKEnergy extends EnergyFEM
{
    private bodyA: RigidBox;
    private bodyB: RigidBox;
    private bodyC: RigidBox;

    private lameMu: number;
    private lameLambda: number;

    private restArea: number = 0;

    private Dm: glm.mat2 = glm.mat2.create(); // Rest shape matrix
    private DmInverse: glm.mat2 = glm.mat2.create(); // Inverse of rest shape matrix

    // used for per body gradient computations
    // These represent the column vectors of DmInverse, corresponding to gradients of shape functions
    private gradN0: glm.vec2 = glm.vec2.create();
    private gradN1: glm.vec2 = glm.vec2.create();
    private gradN2: glm.vec2 = glm.vec2.create();

    constructor(bodiesArray: RigidBox[],
        lameMu: number, lameLambda: number)
    {
        super(bodiesArray);

        // We need exactly 3 bodies
        if (this.getNumberOfBodies() != 3)
        {
            console.error("StVKEnergy requires exactly 3 bodies.");
            this.destroy();
        }

        this.bodyA = this.bodies[0]!;
        this.bodyB = this.bodies[1]!;
        this.bodyC = this.bodies[2]!;

        this.lameMu = lameMu;
        this.lameLambda = lameLambda;

        // StVK model:
        // with L = 1/2 * (F^T F - I)
        // L is the Green strain tensor
        // E = A0 * mu* tr(L^2) * + (lambda/2) * (tr(L))^2

        const pA = this.bodyA.getPosition();
        const pB = this.bodyB.getPosition();
        const pC = this.bodyC.getPosition();

        const edge1 = glm.vec2.fromValues(pB[0] - pA[0], pB[1] - pA[1]);
        const edge2 = glm.vec2.fromValues(pC[0] - pA[0], pC[1] - pA[1]);

        this.Dm = glm.mat2.fromValues(
            edge1[0], edge1[1],
            edge2[0], edge2[1]
        );

        // Compute inverse of Dm
        glm.mat2.invert(this.DmInverse, this.Dm);

        // Compute rest area
        this.restArea = 0.5 * Math.abs(glm.mat2.determinant(this.Dm));
        if (this.restArea < 1e-9) 
        {
            console.warn("NeoHookianEnergy: Rest area is very small or zero. This element might be degenerate.");
        }

        // Derivative gradient helpers
        const dmInvT = glm.mat2.transpose(glm.mat2.create(), this.DmInverse);

        this.gradN1 = glm.vec2.fromValues(dmInvT[0], dmInvT[1]);
        this.gradN2 = glm.vec2.fromValues(dmInvT[2], dmInvT[3]); 
        this.gradN0 = glm.vec2.negate(glm.vec2.create(), 
            glm.vec2.add(glm.vec2.create(), this.gradN1, this.gradN2));

        // Choose an initial stiffness value
        this.stiffness[0] = this.lameMu + 2 * this.lameLambda;
    }

    // ================================== //
    public getRows(): number 
    {
        return 1;
    }

    // ================================== //
    public computeEnergyTerms(body: RigidBox): void
    {
        // Get current positions
        const pA = this.bodyA.getPosition();
        const pB = this.bodyB.getPosition();
        const pC = this.bodyC.getPosition();

        const edge1 = glm.vec2.fromValues(pB[0] - pA[0], pB[1] - pA[1]);
        const edge2 = glm.vec2.fromValues(pC[0] - pA[0], pC[1] - pA[1]);

        const Ds = glm.mat2.fromValues(
            edge1[0], edge1[1],
            edge2[0], edge2[1]
        );

        const F: glm.mat2 = glm.mat2.multiply(glm.mat2.create(), Ds, this.DmInverse);
        const Ft : glm.mat2 = glm.mat2.transpose(glm.mat2.create(), F);

        // First derivative (gradient) computation
        // dE/dx = dE/dF : dF/dx
        const FtF = glm.mat2.multiply(glm.mat2.create(), Ft, F);
        const I = glm.mat2.create();
        glm.mat2.identity(I);

        let L = glm.mat2.subtract(glm.mat2.create(), FtF, I);
        L = scaleMat2D(L, 0.5);

        // Compute first Piola-Kirchhoff stress tensor P
        // P = F * (lambda * tr(L) * I + 2 * mu * L)
        let P: glm.mat2 = glm.mat2.create();
        P = scaleMat2D(L, 2 * this.lameMu);
        P = glm.mat2.add(P, P, scaleMat2D(I, this.lameLambda * (L[0] + L[3])));
        P = glm.mat2.multiply(glm.mat2.create(), F, P);
        switch (body)
        {
            case this.bodyA:
                const gradVecA = glm.vec2.create();
                glm.vec2.transformMat2(gradVecA, this.gradN0, P);
                this.grad_E[0][0] = this.restArea * gradVecA[0];
                this.grad_E[0][1] = this.restArea * gradVecA[1];
                this.grad_E[0][2] = 0;
                break;
            case this.bodyB:
                const gradVecB = glm.vec2.create();
                glm.vec2.transformMat2(gradVecB, this.gradN1, P);
                this.grad_E[0][0] = this.restArea * gradVecB[0];
                this.grad_E[0][1] = this.restArea * gradVecB[1];
                this.grad_E[0][2] = 0;
                break;

            case this.bodyC:
                const gradVecC = glm.vec2.create();
                glm.vec2.transformMat2(gradVecC, this.gradN2, P);
                this.grad_E[0][0] = this.restArea * gradVecC[0];
                this.grad_E[0][1] = this.restArea * gradVecC[1];
                this.grad_E[0][2] = 0;
                break;
        }

        // Hessian computation
        // dP: dF*S + F*dS with S = (lambda * tr(L) * I + 2 * mu * L)
        // PSD Gauss–Newton Hessian for StVK:

        const b1 = glm.vec2.fromValues(this.DmInverse[0], this.DmInverse[1]);
        const b2 = glm.vec2.fromValues(this.DmInverse[2], this.DmInverse[3]);
        const b0 = glm.vec2.negate(glm.vec2.create(),
            glm.vec2.add(glm.vec2.create(), b1, b2)
        );

        let bi: glm.vec2 = glm.vec2.create(); // bodyA
        switch (body)
        {
            case this.bodyA: bi = b0; break;
            case this.bodyB: bi = b1; break;
            case this.bodyC: bi = b2; break;
        }

        const FTbi: glm.vec2 = glm.vec2.create();
        glm.vec2.transformMat2(FTbi, bi, Ft);

        const bi2 = glm.vec2.dot(bi, bi);
        const g0 = FTbi[0], g1 = FTbi[1];

        const H00 = this.lameMu * bi2 + (this.lameLambda + 2 * this.lameMu) * (g0 * g0);
        const H01 =                     (this.lameLambda + 2 * this.lameMu) * (g0 * g1);
        const H10 =                     (this.lameLambda + 2 * this.lameMu) * (g1 * g0);
        const H11 = this.lameMu * bi2 + (this.lameLambda + 2 * this.lameMu) * (g1 * g1);

        const s = this.restArea;
        // H = A0 * (mu * ||bi||^2 * I + (lambda + 2mu) * (F^T bi) * (F^T bi)^T)
        this.hess_E[0] = glm.mat3.fromValues(
            s * H00, s * H10, 0,
            s * H01, s * H11, 0,
            0,        0,      0
        );
    }

    //================================//
    public getContactRenders(): ContactRender[]
    {
        return [
            {
                pos: this.bodyA.getPosition()
            },
            {
                pos: this.bodyB.getPosition()
            },
            {
                pos: this.bodyC.getPosition()
            }
        ];

    }

    //================================//
    public getContactLines(): LineRender[] 
    {
        
        // Return all edges:
        const pA = this.bodyA.getPosition();
        const pB = this.bodyB.getPosition();
        const pC = this.bodyC.getPosition();

        return [
            {
                posA: glm.vec3.fromValues(pA[0], pA[1], 0),
                posB: glm.vec3.fromValues(pB[0], pB[1], 0),
                size: 0.5,
            },
            {
                posA: glm.vec3.fromValues(pB[0], pB[1], 0),
                posB: glm.vec3.fromValues(pC[0], pC[1], 0),
                size: 0.5,
            },
            {
                posA: glm.vec3.fromValues(pC[0], pC[1], 0),
                posB: glm.vec3.fromValues(pA[0], pA[1], 0),
                size: 0.5,
            }
        ];
    }
}

// ================================== //
export default StVKEnergy;