    import { outerMat2D, scaleMat2D, SVD2x2 } from "@src/helpers/MathUtils";
    import EnergyFEM from "./EnergyFEM";
    import type RigidBox from "./RigidBox";
    import * as glm from "gl-matrix";
    import type { ContactRender, LineRender } from "./Manifold";

    // MEMO:
    // E (Stiffness)                ν (Incompressibility)
    // ─────────────                ─────────────────────
    // 50   → jelly                 0.10 → sponge/foam
    // 200   → soft rubber          0.25 → cork-like
    // 500   → rubber               0.30 → typical solid
    // 1000   → firm rubber         0.40 → soft rubber
    // 3000   → stiff               0.45 → rubber
    // 8000   → very stiff          0.48 → nearly incompressible
    // 20000   → nearly rigid       0.495 → highly incompressible
    
    //================================//
    export enum EigenProjectionMode {
        CLAMP = 0,      //  max(λ, 0)
        ABSOLUTE = 1,   //  |λ|
        ADAPTIVE = 2    // Trust-region based switching, with rho
    };

    //================================//
    class NeoHookeanEnergy extends EnergyFEM
    {
        private bodyA: RigidBox;
        private bodyB: RigidBox;
        private bodyC: RigidBox;

        private restArea: number = 0;

        private lameMu: number;
        private lameLambda: number;
        private a: number; // 1 + mu/lambda

        public poissonRatio: number;
        public youngsModulus: number;

        private Dm: glm.mat2 = glm.mat2.create(); // Rest shape matrix
        private DmInverse: glm.mat2 = glm.mat2.create(); // Inverse of rest shape matrix

        // used for per body gradient computations
        // These represent the column vectors of DmInverse, corresponding to gradients of shape functions
        private gradN0: glm.vec2 = glm.vec2.create();
        private gradN1: glm.vec2 = glm.vec2.create();
        private gradN2: glm.vec2 = glm.vec2.create();

        public projectionMode: EigenProjectionMode = EigenProjectionMode.ABSOLUTE;

        // private prevEnergy: number = 0;
        private trustRegionRho: number = 1.0;
        private readonly trustRegionThreshold: number = 0.01;

        //================================//
        constructor(bodiesArray: RigidBox[],
            E: number, nu: number)
        {
            super(bodiesArray);

            // We need exactly 3 bodies
            if (this.getNumberOfBodies() != 3)
            {
                console.error("NeoHookianEnergy requires exactly 3 bodies.");
                this.destroy();
            }

            this.poissonRatio = nu;
            this.youngsModulus = E;

            this.lameMu = E / (2 * (1 + nu));
            this.lameLambda = (E * nu) / ((1 + nu) * (1 - 2 * nu));
            this.a = 1 + this.lameMu / this.lameLambda; 

            this.bodyA = this.bodies[0]!;
            this.bodyB = this.bodies[1]!;
            this.bodyC = this.bodies[2]!;

            // The Neo Hookian model, with the log term omitted can be written as:
            // E = mu/2 * (I1 - 2) + lambda/2 * (J - a)^2
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
        // Pure stable Neo-Hookean energy value
        public computeEnergy(): number
        {
            const { F, J } = this.computeDeformationGradient();

            // trace(F^T F)
            const I1 = F[0]*F[0] + F[1]*F[1] + F[2]*F[2] + F[3]*F[3];

            // Density = (μ/2)(I1 - 2) + (λ/2)(J - α)^2, since we are in dim 2
            const energyDensity = (this.lameMu / 2) * (I1 - 2) + (this.lameLambda / 2) * Math.pow(J - this.a, 2);
            return this.restArea * energyDensity; // convert to energy value
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

        //================================//
        // compute 4 eigenvalues of the Hessian ∂²Ψ/∂F², where Ψ is the energy density
        // [λ_scale1, λ_scale2, λ_twist, λ_flip]
        private computeHessianEigenvalues(S: glm.vec2, J: number): number[]
        {
            let lamScale1: number;
            let lamScale2: number;
            let lamTwist: number;
            let lamFlip: number;

            // We first derivate the density by each singular value
            const dPsi_ds1 = this.lameMu * S[0] + this.lameLambda * (J - this.a) * S[1];
            const dPsi_ds2 = this.lameMu * S[1] + this.lameLambda * (J - this.a) * S[0];

            if (Math.abs(S[0] - S[1]) > 1e-8)
            {
                lamTwist = (dPsi_ds1 - dPsi_ds2) / (S[0]- S[1]);
            }
            else
            {
                // if s1 -> s2, l'Hôpital's rule (division by 0)
                lamTwist = this.lameMu + this.lameLambda * S[1] * S[1] - this.lameLambda * (2 * J - this.a); 
            }

            if (S[0] + S[1] > 1e-8)
            {
                lamFlip = (dPsi_ds1 + dPsi_ds2) / (S[0] + S[1]);
            }
            else
            {
                lamFlip = this.lameMu;
            }

            // H_scaling = [μ + λσ₂²,   λ(2J - α)]
            //             [λ(2J - α),  μ + λσ₁² ]
            const H11 = this.lameMu + this.lameLambda * S[1] * S[1];
            const H22 = this.lameMu + this.lameLambda * S[0] * S[0];
            const H12 = this.lameLambda * (2 * J - this.a);
            const H21 = H12;

            const tr = H11 + H22;
            const det = H11 * H22 - H12 * H21;
            const disc = tr * tr - 4 * det;

            if (disc >= 0)
            {
                const sqrtDisc = Math.sqrt(disc);
                lamScale1 = 0.5 * (tr + sqrtDisc);
                lamScale2 = 0.5 * (tr - sqrtDisc);
            }
            else
            {
                lamScale1 = tr / 2;
                lamScale2 = tr / 2;
            }

            return [lamScale1, lamScale2, lamTwist, lamFlip];
        }

        //================================//
        private project(eigenvalues: number[]): number[]
        {
            const projected = [...eigenvalues];

            let useAbsolute = false;

            switch (this.projectionMode)
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
                    useAbsolute = Math.abs(this.trustRegionRho - 1.0) > this.trustRegionThreshold;
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
        // Gracefuly handle inverted case
        private handleInvertedElement(F: glm.mat2, J: number, gradNi: glm.vec2): void
        {
            const stiffPenalty = this.lameMu + this.lameLambda;
            
            // Gradient of J with respect to position uses cofactor of F
            // cof(F) = [F₁₁, -F₀₁; -F₁₀, F₀₀] for 2x2
            const cofF = glm.mat2.fromValues(F[3], -F[1], -F[2], F[0]);
            const dJdxi = glm.vec2.transformMat2(glm.vec2.create(), gradNi, cofF);
            
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
            
            let gradNi: glm.vec2;
            switch (body) {
                case this.bodyA: gradNi = this.gradN0; break;
                case this.bodyB: gradNi = this.gradN1; break;
                case this.bodyC: gradNi = this.gradN2; break;
                default: return;
            }

            // Handle inverted/degenerate elements !!EXPERIMENTAL!!
            if (J <= 1e-6) 
            {
                this.handleInvertedElement(F, J, gradNi);
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
            const a = this.a;

            // In order to compute the force, we derive by position the energy using the chain rule:
            // dE/dx = dE/dF * dF/dx

            // 1. Calculate ∂E/∂F (First Piola-Kirchhoff Stress Tensor, P)
            // P = ∂E/∂F = mu * F + 2 * lambda * (J - a) * J * F^-T
            const dEdF: glm.mat2 = glm.mat2.create();

            // We know dI1/dF = 2F, since I1 = trace(F^T F)
            // We know dJ/dF = det(F) * F^-T = J * F^-T
            const t1 = scaleMat2D(glm.mat2.clone(F), this.lameMu);
            const t2 = scaleMat2D(glm.mat2.clone(invFt), this.lameLambda * (J - a) * J);
            glm.mat2.add(dEdF, t1, t2);
            
            // 2. Now we can compute dF/dx and then dE/dx
            // Typically grad_body_i = A0 * P * grad_Ni
            const gradVec = glm.vec2.transformMat2(glm.vec2.create(), gradNi, dEdF);
            this.grad_E[0] = glm.vec3.fromValues(
                this.restArea * gradVec[0],
                this.restArea * gradVec[1],
                0
            );

            // NOW compute the hessian
            const { U, S, V } = SVD2x2(F);
            const eigenvalues = this.computeHessianEigenvalues(S, J);
            const projectedEigenvalues = this.project(eigenvalues);

            // Projected Hessian computation
            // The F-space Hessian eigenvectors are formed from:
            // D_ij = vec(u_i outer v_j) where u_i is column i of U, v_j is column j of V

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

            const H_F: glm.mat4 = glm.mat4.create();
            const addOuterProduct = (H: glm.mat4, D: glm.mat2, scale: number) =>
            {
                for (let i = 0; i < 4; ++i)
                {
                    for (let j = 0; j < 4; ++j)
                    {
                        H[i * 4 + j] += scale * D[i] * D[j];
                    }
                }
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
                },
            ];
        }
    }

    // ================================== //
    export default NeoHookeanEnergy;