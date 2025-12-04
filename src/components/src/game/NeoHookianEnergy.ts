import { scale2D } from "@src/helpers/MathUtils";
import EnergyFEM from "./EnergyFEM";
import type RigidBox from "./RigidBox";
import * as glm from "gl-matrix";

class NeoHookianEnergy extends EnergyFEM
{
    private bodyA: RigidBox;
    private bodyB: RigidBox;
    private bodyC: RigidBox;

    private restArea: number = 0;

    private lameMu: number;
    private lameLambda: number;

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
            console.error("NeoHookianEnergy requires exactly 3 bodies.");
            this.destroy();
        }

        this.lameMu = lameMu;
        this.lameLambda = lameLambda;

        this.bodyA = this.bodies[0]!;
        this.bodyB = this.bodies[1]!;
        this.bodyC = this.bodies[2]!;

        // The Neo Hookian model, with the log term omitted can be written as:
        // E = mu/2 * (I1 - 2) - lambda * (J - a)^2
        // where I1 = trace(F^T F) and J = det(F) and a = 1 + mu/lambda

        // Compute rest shape matrix Dm
        const pA = this.bodyA.getPosition();
        const pB = this.bodyB.getPosition();
        const pC = this.bodyC.getPosition();

        const edge1 = glm.vec2.fromValues(pB[0] - pA[0], pB[1] - pA[1]);
        const edge2 = glm.vec2.fromValues(pC[0] - pA[0], pC[1] - pA[1]);

        glm.mat2.set(this.Dm,
            edge1[0], edge2[0],
            edge1[1], edge2[1]
        );

        // Compute inverse of Dm
        glm.mat2.invert(this.DmInverse, this.Dm);

        // Compute rest area
        this.restArea = 0.5 * glm.mat2.determinant(this.Dm);
        if (this.restArea < 1e-9) 
        {
            console.warn("NeoHookianEnergy: Rest area is very small or zero. This element might be degenerate.");
        }

        // Derivative gradient helpers
        const dmInvT = glm.mat2.transpose(glm.mat2.create(), this.DmInverse);

        this.gradN1 = glm.vec2.fromValues(dmInvT[0], dmInvT[1]);
        this.gradN2 = glm.vec2.fromValues(dmInvT[2], dmInvT[3]);

        // For barycentric coordinates, N0 + N1 + N2 = 1, so grad(N0) + grad(N1) + grad(N2) = 0
        // Therefore, gradN0 = -(gradN1 + gradN2)   
        this.gradN0 = glm.vec2.create();
        glm.vec2.scaleAndAdd(this.gradN0, this.gradN1, this.gradN2, -1);
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

        const Ds = glm.mat2.create();
        glm.mat2.set(Ds,
            edge1[0], edge2[0],
            edge1[1], edge2[1]
        );

        const F: glm.mat2 = glm.mat2.multiply(glm.mat2.create(), Ds, this.DmInverse);
        const Ft : glm.mat2 = glm.mat2.transpose(glm.mat2.create(), F);
        const invFt = glm.mat2.invert(glm.mat2.create(), Ft);
        if (!invFt)
        {
            console.error("NeoHookianEnergy: Singular deformation gradient encountered.");
            return;
        }

        const J: number = glm.mat2.determinant(F);
        if (J <= 0) 
        {
            console.error("NeoHookianEnergy: Inverted element detected (J <= 0). Cannot reliably compute gradient.");
            return;
        }

        const a: number = 1 + this.lameMu / this.lameLambda;

        const FtF: glm.mat2 = glm.mat2.multiply(glm.mat2.create(), Ft, F);
        const I1: number = FtF[0] + FtF[3];

        // In order to compute the force, we derive by position the energy using the chain rule:
        // dE/dx = dE/dF * dF/dx

        // 1. Calculate ∂E/∂F (First Piola-Kirchhoff Stress Tensor, P)
        // P = ∂E/∂F = mu * F - 2 * lambda * (J - a) * J * F^-T
        const dEdF: glm.mat2 = glm.mat2.create();

        // We know dI1/dF = 2F, since I1 = trace(F^T F)
        // We know dJ/dF = det(F) * F^-T = J * F^-T
        const t1 = scale2D(F, this.lameMu);
        const t2 = scale2D(invFt, -2 * this.lameLambda * (J - a) * J);
        glm.mat2.add(dEdF, t1, t2);

        // 2. Now we can compute dF/dx and then dE/dx
        // Typically grad_body_i = A0 * P * grad_Ni
        switch (body)
        {
            case this.bodyA:
                const gradVecA = glm.vec2.create();
                glm.vec2.transformMat2(gradVecA, this.gradN0, dEdF);
                this.grad_E[0][0] = this.restArea * gradVecA[0];
                this.grad_E[0][1] = this.restArea * gradVecA[1];
                this.grad_E[0][2] = 0;
                break;
            case this.bodyB:
                const gradVecB = glm.vec2.create();
                glm.vec2.transformMat2(gradVecB, this.gradN1, dEdF);
                this.grad_E[0][0] = this.restArea * gradVecB[0];
                this.grad_E[0][1] = this.restArea * gradVecB[1];
                this.grad_E[0][2] = 0;
                break;

            case this.bodyC:
                const gradVecC = glm.vec2.create();
                glm.vec2.transformMat2(gradVecC, this.gradN2, dEdF);
                this.grad_E[0][0] = this.restArea * gradVecC[0];
                this.grad_E[0][1] = this.restArea * gradVecC[1];
                this.grad_E[0][2] = 0;
                break;
        }

        // NOW compute the hessian
        
    }
}

// ================================== //
export default NeoHookianEnergy;