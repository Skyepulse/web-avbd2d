import { scaleMat2D } from "@src/helpers/MathUtils";
import EnergyFEM from "./EnergyFEM";
import type RigidBox from "./RigidBox";
import * as glm from "gl-matrix";
import type { ContactRender, LineRender } from "./Manifold";

class NeoHookeanEnergy extends EnergyFEM
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

        // Choose an initial stiffness value
        this.targetStiffness[0] = this.lameMu + 2 * this.lameLambda;
        this.effectiveStiffness[0] = 1.0;
    }

    // ================================== //
    public getRows(): number 
    {
        return 1;
    }

    //================================//
    private computeDeformationGradient(): { F: glm.mat2, J: number }
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
        const J = glm.mat2.determinant(F);

        return { F, J };
    }

    //================================//
    public updateStrainMeasures(): void
    {
        const { F, J } = this.computeDeformationGradient();

        // Compute strain measure: Frobenius norm of (F - I) + volumetric strain
        // This measures how far we are from the rest configuration
        const FminusI = glm.mat2.fromValues(
            F[0] - 1, F[1],
            F[2], F[3] - 1
        );
        
        const frobNorm = Math.sqrt(
            FminusI[0]*FminusI[0] + FminusI[1]*FminusI[1] + 
            FminusI[2]*FminusI[2] + FminusI[3]*FminusI[3]
        );
        
        const volStrain = Math.abs(J - 1);
        this.strainMeasure[0] = frobNorm + volStrain;
    }

    // ================================== //
    public computeEnergyTerms(body: RigidBox): void
    {
        const { F, J } = this.computeDeformationGradient();

        // ALSO update strain measure here so it's always current
        const FminusI = glm.mat2.fromValues(
            F[0] - 1, F[1],
            F[2], F[3] - 1
        );
        const frobNorm = Math.sqrt(
            FminusI[0]*FminusI[0] + FminusI[1]*FminusI[1] + 
            FminusI[2]*FminusI[2] + FminusI[3]*FminusI[3]
        );
        this.strainMeasure[0] = frobNorm + Math.abs(J - 1);
        
        // Handle inverted/degenerate elements !!EXPERIMENTAL!!
        if (J <= 1e-6) 
        {
            const stiffPenalty = this.lameMu + this.lameLambda;
            
            // Push back strongly in the direction that increases J
            // Gradient of J with respect to position
            let bi: glm.vec2;
            switch (body) {
                case this.bodyA: bi = this.gradN0; break;
                case this.bodyB: bi = this.gradN1; break;
                case this.bodyC: bi = this.gradN2; break;
                default: return;
            }
            
            const cofF = glm.mat2.fromValues(F[3], -F[1], -F[2], F[0]);
            const dJdxi = glm.vec2.transformMat2(glm.vec2.create(), bi, cofF);
            
            // Strong penalty gradient pushing away from inversion
            const penaltyMag = stiffPenalty * (1e-6 - J);
            this.grad_E[0] = glm.vec3.fromValues(
                -this.restArea * penaltyMag * dJdxi[0],
                -this.restArea * penaltyMag * dJdxi[1],
                0
            );
            
            // Diagonal Hessian for stability
            this.hess_E[0] = glm.mat3.fromValues(
                this.restArea * stiffPenalty, 0, 0,
                0, this.restArea * stiffPenalty, 0,
                0, 0, 0
            );
            return;
        }

        const Ft = glm.mat2.transpose(glm.mat2.create(), F);
        const invFt = glm.mat2.invert(glm.mat2.create(), Ft);

        if (!invFt) 
        {
            this.grad_E[0] = glm.vec3.fromValues(0, 0, 0);
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
        const t1 = scaleMat2D(glm.mat2.clone(F), this.lameMu);
        const t2 = scaleMat2D(glm.mat2.clone(invFt), 2 * this.lameLambda * (J - a) * J);
        glm.mat2.add(dEdF, t1, t2);
        
        // 2. Now we can compute dF/dx and then dE/dx
        // Typically grad_body_i = A0 * P * grad_Ni
        let gradNi: glm.vec2;
        switch (body) {
            case this.bodyA: gradNi = this.gradN0; break;
            case this.bodyB: gradNi = this.gradN1; break;
            case this.bodyC: gradNi = this.gradN2; break;
            default: return;
        }
        const gradVec = glm.vec2.transformMat2(glm.vec2.create(), gradNi, dEdF);
        this.grad_E[0] = glm.vec3.fromValues(
            this.restArea * gradVec[0],
            this.restArea * gradVec[1],
            0
        );

        // NOW compute the hessian
        // The full Hessian for Neo-Hookean in 2D has the form:
        // H_ij = A0 * (∂P/∂F : ∂F/∂x_i ⊗ ∂F/∂x_j)

        // We want
        // d^2E/dx^2 = d/dx (dE/dF * dF/dx) = d^2E/dF^2 : dF/dx ⊗ dF/dx + dE/dF * d^2F/dx^2
        // But position is linear in F, so d^2F/dx^2 = 0
        // d^2E/dx^2 = d^2E/dF^2 : dF/dx ⊗ dF/dx
        // d^2E/dF^2 = mu * I + 2 * lambda * J [(J - a) * (F^-T ⊗ F^-T)^T + (2J - a) * (F^-T ⊗ F^-T)]
        
        // PSD approximation:
        const b1 = glm.vec2.fromValues(this.DmInverse[0], this.DmInverse[1]);
        const b2 = glm.vec2.fromValues(this.DmInverse[2], this.DmInverse[3]);
        const b0 = glm.vec2.negate(glm.vec2.create(), glm.vec2.add(glm.vec2.create(), b1, b2));

        let bi: glm.vec2 = glm.vec2.create(); // bodyA
        switch (body)
        {
            case this.bodyA: bi = b0; break;
            case this.bodyB: bi = b1; break;
            case this.bodyC: bi = b2; break;
            default: return;
        }

        // F^{-T} * b_i (needed for volumetric Hessian term)
        const FinvTbi = glm.vec2.transformMat2(glm.vec2.create(), bi, invFt);

        // We compute an SPD approximation following the approach in:
        const bi2 = glm.vec2.dot(bi, bi);
        // kMu = mu * ||bi||^2 * I (Deviatoric (μ) contribution - always SPD)
        const kMu = this.lameMu * bi2;

        // Volumetric (λ) contribution  
        // For stability, we use: λ * max(J, threshold)² * (F^{-T}b_i)(F^{-T}b_i)^T
        // Plus a term that handles the (J-a) factor
        const J_clamped = Math.max(J, 0.1); // Stability purpose clamp
        const volCoeff = this.lameLambda * (J_clamped * J_clamped + Math.max(0, (J - a)) * Math.max(0, (J - a)));
        const g0 = FinvTbi[0], g1 = FinvTbi[1];

        // H_vol ≈ λ * [ (2J-a)² + (J-a)² ] * (F^{-T}bi)(F^{-T}bi)^T
        const H00 = kMu + volCoeff * (g0 * g0);
        const H01 =        volCoeff * (g0 * g1);
        const H11 = kMu + volCoeff * (g1 * g1);

        // scale by rest area to get energy from density
        const s = this.restArea;
        this.hess_E[0] = glm.mat3.fromValues(
            s * H00, s * H01, 0,
            s * H01, s * H11, 0,
            0,       0,       0
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
            },
        ];
    }
}

// ================================== //
export default NeoHookeanEnergy;