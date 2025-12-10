import { scaleMat2D } from "@src/helpers/MathUtils";
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
        // E = mu/2 * (I1 - 2) + lambda * (J - a)^2
        // where I1 = trace(F^T F) and J = det(F) and a = 1 + mu/lambda

        // Compute rest shape matrix Dm
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
        const invFt = glm.mat2.invert(glm.mat2.create(), Ft);
        
        if (!invFt)
        {
            console.error("NeoHookianEnergy: Singular deformation gradient encountered.");
            return;
        }

        const J: number = glm.mat2.determinant(F);
        const rest: number = 1 - J;

        if (Math.abs(rest) < 1e-16)
        {
            // Set gradient and hessian to zero
            this.grad_E[0] = glm.vec3.fromValues(0, 0, 0);
            this.hess_E[0] = glm.mat3.create();
            return;
        }

        if (J <= 0) 
        {
            console.error("NeoHookianEnergy: Inverted element detected (J <= 0). Cannot reliably compute gradient.");
            this.grad_E[0] = glm.vec3.fromValues(NaN, NaN, NaN);
            this.hess_E[0] = glm.mat3.create();
            return;
        }

        const a: number = 1 + this.lameMu / this.lameLambda;
        // In order to compute the force, we derive by position the energy using the chain rule:
        // dE/dx = dE/dF * dF/dx

        // 1. Calculate ∂E/∂F (First Piola-Kirchhoff Stress Tensor, P)
        // P = ∂E/∂F = mu * F + 2 * lambda * (J - a) * J * F^-T
        const dEdF: glm.mat2 = glm.mat2.create();

        // We know dI1/dF = 2F, since I1 = trace(F^T F)
        // We know dJ/dF = det(F) * F^-T = J * F^-T
        const t1 = scaleMat2D(F, this.lameMu);
        const t2 = scaleMat2D(invFt, 2 * this.lameLambda * (J - a) * J);
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
        // d^2E/dx^2 = d/dx (dE/dF * dF/dx) = d^2E/dF^2 : dF/dx ⊗ dF/dx + dE/dF * d^2F/dx^2
        // But position is linear in F, so d^2F/dx^2 = 0
        // d^2E/dx^2 = d^2E/dF^2 : dF/dx ⊗ dF/dx

        // d^2E/dF^2 = mu * I + 2 * lambda * J [(J - a) * (F^-T ⊗ F^-T)^T + (2J - a) * (F^-T ⊗ F^-T)]

        const hess = glm.mat3.create();
        const gradN = glm.vec2.create();
        switch (body)
        {
            case this.bodyA:
                glm.vec2.copy(gradN, this.gradN0);
                break;
            case this.bodyB:
                glm.vec2.copy(gradN, this.gradN1);
                break;
            case this.bodyC:
                glm.vec2.copy(gradN, this.gradN2);
                break;
        }

        // Term 1: mu * I contribution
        const muTerm = this.lameMu * this.restArea;
        hess[0] = muTerm * gradN[0] * gradN[0];  // ∂²E/∂xi²
        hess[1] = muTerm * gradN[1] * gradN[0];  // ∂²E/∂yi∂xi
        hess[3] = muTerm * gradN[0] * gradN[1];  // ∂²E/∂xi∂yi
        hess[4] = muTerm * gradN[1] * gradN[1];  // ∂²E/∂yi²

        // Term 2: Volumetric standard contraction (diagonal only)
        const FinvT_gradN = glm.vec2.create();
        glm.vec2.transformMat2(FinvT_gradN, gradN, invFt);
        
        const standardTerm = (2 * J - a) * 2 * this.lameLambda * J * this.restArea;
        hess[0] += standardTerm * FinvT_gradN[0] * FinvT_gradN[0];
        hess[1] += standardTerm * FinvT_gradN[1] * FinvT_gradN[0];
        hess[3] += standardTerm * FinvT_gradN[0] * FinvT_gradN[1];
        hess[4] += standardTerm * FinvT_gradN[1] * FinvT_gradN[1];

        // Term 3: Transposed contraction (diagonal only)
        const invF = glm.mat2.transpose(glm.mat2.create(), invFt);
        const invFt_invF = glm.mat2.multiply(glm.mat2.create(), invFt, invF);
        const temp = glm.vec2.create();
        glm.vec2.transformMat2(temp, gradN, invFt_invF);
        const transposedContraction = glm.vec2.dot(gradN, temp);
        
        const transposedTerm = (J - a) * 2 * this.lameLambda * J * this.restArea;
        hess[0] += transposedTerm * transposedContraction;
        hess[4] += transposedTerm * transposedContraction;
        
        this.hess_E[0] = hess;
    }
}

// ================================== //
export default NeoHookianEnergy;