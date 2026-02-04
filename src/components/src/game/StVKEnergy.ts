import { outerMat2D, scaleMat2D, SVD2x2 } from "@src/helpers/MathUtils";
import EnergyFEM, { EigenProjectionMode } from "./EnergyFEM";
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

    public poissonRatio: number;
    public youngsModulus: number;

    private restArea: number = 0;

    private Dm: glm.mat2 = glm.mat2.create(); // Rest shape matrix
    private DmInverse: glm.mat2 = glm.mat2.create(); // Inverse of rest shape matrix

    // used for per body gradient computations
    // These represent the column vectors of DmInverse, corresponding to gradients of shape functions
    private gradN0: glm.vec2 = glm.vec2.create();
    private gradN1: glm.vec2 = glm.vec2.create();
    private gradN2: glm.vec2 = glm.vec2.create();

    private readonly trustRegionThreshold: number = 0.01;

    constructor(bodiesArray: RigidBox[],
        E: number, nu: number)
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

        this.poissonRatio = nu;
        this.youngsModulus = E;

        this.lameMu = E / (2 * (1 + nu));
        this.lameLambda = (E * nu) / ((1 + nu) * (1 - 2 * nu));

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
        this.targetStiffness[0] = this.lameMu + 2 * this.lameLambda;
        this.effectiveStiffness[0] = 1.0;
    }

    // ================================== //
    public getRows(): number 
    {
        return 1;
    }

    // ================================== //
    private computeDeformationGradient(): { F: glm.mat2, L: glm.mat2 }
    {
        const pA = this.bodyA.getPosition();
        const pB = this.bodyB.getPosition();
        const pC = this.bodyC.getPosition();

        const edge1 = glm.vec2.fromValues(pB[0] - pA[0], pB[1] - pA[1]);
        const edge2 = glm.vec2.fromValues(pC[0] - pA[0], pC[1] - pA[1]);

        const Ds = glm.mat2.fromValues(
            edge1[0], edge1[1],
            edge2[0], edge2[1]
        );

        const F = glm.mat2.multiply(glm.mat2.create(), Ds, this.DmInverse);
        const Ft = glm.mat2.transpose(glm.mat2.create(), F);

        // Green strain tensor: L = 0.5 * (F^T * F - I)
        const FtF = glm.mat2.multiply(glm.mat2.create(), Ft, F);
        const I = glm.mat2.identity(glm.mat2.create());
        let L = glm.mat2.subtract(glm.mat2.create(), FtF, I);
        L = scaleMat2D(L, 0.5);

        return { F, L };
    }

    // ================================== //
    public updateStrainMeasures(): void
    {
        const { L } = this.computeDeformationGradient();

        // For StVK, use the Frobenius norm of the Green strain tensor L
        // This measures how far we are from the rest configuration
        const frobNormL = Math.sqrt(
            L[0]*L[0] + L[1]*L[1] + 
            L[2]*L[2] + L[3]*L[3]
        );

        // Also include trace of L (volumetric strain measure)
        const traceL = Math.abs(L[0] + L[3]);
        this.strainMeasure[0] = frobNormL + traceL;
    }

    //================================//
     private computeHessianEigenvalues(S: glm.vec2): number[]
    {
        let lamScale1: number;
        let lamScale2: number;
        let lamTwist: number;
        let lamFlip: number;

        const traceS = S[0] * S[0] + S[1] * S[1];

        // We first derivate the density by each singular value
        const dPsi_ds1 = S[0] * (this.lameMu * (S[0] * S[0] - 1) + 0.5 * this.lameLambda * (traceS - 2));
        const dPsi_ds2 = S[1] * (this.lameMu * (S[1] * S[1] - 1) + 0.5 * this.lameLambda * (traceS - 2));

        if (Math.abs(S[0] - S[1]) > 1e-8)
        {
            lamTwist = (dPsi_ds1 - dPsi_ds2) / (S[0]- S[1]);
        }
        else
        {
            lamTwist = this.lameMu * (S[1] * S[1] - 1); 
        }

        if (S[0] + S[1] > 1e-8)
        {
            lamFlip = (dPsi_ds1 + dPsi_ds2) / (S[0] + S[1]);
        }
        else
        {
            lamFlip = this.lameMu;
        }

        lamScale1 = 3 * this.lameMu * S[0] * S[0] + 0.5 * this.lameLambda * (3 * S[0] * S[0] + S[1] * S[1]) - this.lameMu - this.lameLambda;
        lamScale2 = 3 * this.lameMu * S[1] * S[1] + 0.5 * this.lameLambda * (3 * S[1] * S[1] + S[0] * S[0]) - this.lameMu - this.lameLambda;

        return [lamScale1, lamScale2, lamTwist, lamFlip];
    }

    //================================//
    private project(eigenvalues: number[], projectionMode: EigenProjectionMode, trustRegionRho: number): number[]
    {
        const projected = [...eigenvalues];

        let useAbsolute = false;

        switch (projectionMode)
        {
            case EigenProjectionMode.CLAMP:

                for (let i = 0; i < projected.length; ++i)
                {
                    projected[i] = Math.max(1e-6, projected[i]);
                }
                break;
            case EigenProjectionMode.ABSOLUTE:
                useAbsolute = true;
                break;
            case EigenProjectionMode.ADAPTIVE:
                useAbsolute = Math.abs(trustRegionRho - 1.0) > this.trustRegionThreshold; // w = 1.0
                if (!useAbsolute)
                {
                    // Clamp in this case, w = 0.5
                    for (let i = 0; i < projected.length; ++i)
                    {
                        projected[i] = Math.max(1e-6, projected[i]);
                    }
                }
                break;
        }

        if (useAbsolute)
        {
            for (let i = 0; i < projected.length; ++i)
            {
                projected[i] = Math.abs(projected[i]);
                if (projected[i] < 1e-6) projected[i] = 1e-6;
            }
        }

        return projected;
    }


    //================================//
    public handleInvertedElement(body: RigidBox): void
    {
        const { F } = this.computeDeformationGradient();
        const detF = glm.mat2.determinant(F);

        const eps = 1e-3;
        const alpha = this.lameMu * 10;

        const diff = detF - eps;

        // Cofactor matrix
        const C = glm.mat2.fromValues(
            F[3], -F[1],
            -F[2],  F[0]
        );

        // Gradient
        const scale = 2 * alpha * diff * this.restArea;

        let gradNi: glm.vec2;
        if (body === this.bodyA) gradNi = this.gradN0;
        else if (body === this.bodyB) gradNi = this.gradN1;
        else gradNi = this.gradN2;

        const gradVec = glm.vec2.create();
        glm.vec2.transformMat2(gradVec, gradNi, C);

        this.grad_E[0][0] = scale * gradVec[0];
        this.grad_E[0][1] = scale * gradVec[1];
        this.grad_E[0][2] = 0;

        // Simple SPD hessian approximation to push back against inversion
        const k = alpha * this.restArea;
        this.hess_E[0] = glm.mat3.fromValues(
            k, 0, 0,
            0, k, 0,
            0, 0, 0
        );

        this.cachedEnergy = alpha * diff * diff * this.restArea;
    }

    // ================================== //
    public computeEnergyTerms(body: RigidBox, projectionMode: EigenProjectionMode, trustRegionRho: number): void
    {
        const { F, L } = this.computeDeformationGradient();

        const detF = glm.mat2.determinant(F);
        if (detF <= 0.0)
        {
            this.handleInvertedElement(body);
            return;
        }

        // compute energy to cache it
        const energyDensity = this.lameMu * (L[0]*L[0] + L[1]*L[1] + L[2]*L[2] + L[3]*L[3])
            + (this.lameLambda / 2) * (L[0] + L[3]) * (L[0] + L[3]);
        this.cachedEnergy = this.restArea * energyDensity;

        // Update strain measure so it's always current
        const frobNormL = Math.sqrt(
            L[0]*L[0] + L[1]*L[1] + 
            L[2]*L[2] + L[3]*L[3]
        );
        const traceL = Math.abs(L[0] + L[3]);
        this.strainMeasure[0] = frobNormL + traceL; 

        let gradNi: glm.vec2;
        switch (body) {
            case this.bodyA: gradNi = this.gradN0; break;
            case this.bodyB: gradNi = this.gradN1; break;
            case this.bodyC: gradNi = this.gradN2; break;
            default: return;
        }

        // First derivative (gradient) computation
        // dE/dx = dE/dF : dF/dx
        const I = glm.mat2.create();
        glm.mat2.identity(I);

        // Compute first Piola-Kirchhoff stress tensor P
        // P = F * (lambda * tr(L) * I + 2 * mu * L)
        let P: glm.mat2 = glm.mat2.create();
        P = scaleMat2D(L, 2 * this.lameMu);
        P = glm.mat2.add(P, P, scaleMat2D(I, this.lameLambda * (L[0] + L[3])));
        P = glm.mat2.multiply(glm.mat2.create(), F, P);

        const gradVec = glm.vec2.create();
        glm.vec2.transformMat2(gradVec, gradNi, P);
        this.grad_E[0][0] = this.restArea * gradVec[0];
        this.grad_E[0][1] = this.restArea * gradVec[1];
        this.grad_E[0][2] = 0;

        // Hessian computation
        
        const { U, S, V } = SVD2x2(F);
        const eigenvalues = this.computeHessianEigenvalues(S);
        const projectedEigenvalues = this.project(eigenvalues, projectionMode, trustRegionRho);

        // Projected Hessian computation
        // In 2D: 4x4 Hessian matrix, with both scaling modes, twist and flip
        const u1 = glm.vec2.fromValues(U[0], U[1]); // column 0
        const u2 = glm.vec2.fromValues(U[2], U[3]); // column 1
        const v1 = glm.vec2.fromValues(V[0], V[1]); // column 0
        const v2 = glm.vec2.fromValues(V[2], V[3]); // column 1

        // outer products
        const D11: glm.mat2 = outerMat2D(u1, v1);
        const D22: glm.mat2 = outerMat2D(u2, v2);
        const D12: glm.mat2 = outerMat2D(u1, v2);
        const D21: glm.mat2 = outerMat2D(u2, v1);

        let twist: glm.mat2 = glm.mat2.subtract(glm.mat2.create(), D12, D21);
        let flip: glm.mat2 = glm.mat2.add(glm.mat2.create(), D12, D21);
        twist = scaleMat2D(twist, 1 / Math.sqrt(2));
        flip = scaleMat2D(flip, 1 / Math.sqrt(2));

        const vecF = (M: glm.mat2): number[] => [
            M[0], // F00
            M[1], // F10
            M[2], // F01
            M[3], // F11
        ];

        const H_F: glm.mat4 = glm.mat4.create();
        const addOuterProduct = (H: glm.mat4, D: glm.mat2, scale: number) =>
        {
            const d = vecF(D);
                for (let i = 0; i < 4; ++i)
                    for (let j = 0; j < 4; ++j)
                        H[i * 4 + j] += scale * d[i] * d[j];
        };
        addOuterProduct(H_F, D11, projectedEigenvalues[0]);
        addOuterProduct(H_F, D22, projectedEigenvalues[1]);
        addOuterProduct(H_F, twist, projectedEigenvalues[2]);
        addOuterProduct(H_F, flip, projectedEigenvalues[3]);

        // Now, we transform into our vertex space final 3x3 Hessian
        // H_vertex = A0 * (∂F/∂x_i)^T * H_F * (∂F/∂x_i)

        const bx = gradNi[0];
        const by = gradNi[1];
        const H11 = bx * bx * H_F[0] + bx * by * H_F[2] + by * bx * H_F[8] + by * by * H_F[10];
        const H22 = bx * bx * H_F[5] + bx * by * H_F[7] + by * bx * H_F[13] + by * by * H_F[15];
        const H12 = bx * bx * H_F[1] + bx * by * H_F[3] + by * bx * H_F[9] + by * by * H_F[11];
        const H21 = bx * bx * H_F[4] + bx * by * H_F[6] + by * bx * H_F[12] + by * by * H_F[14];

        this.hess_E[0] = glm.mat3.fromValues(
            this.restArea * H11, this.restArea * H21, 0,
            this.restArea * H12, this.restArea * H22, 0,
            0, 0, 0
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