import { outerMat4D } from "@src/helpers/MathUtils";
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

        // Derivative gradient helpers
        const dmInvT = glm.mat2.transpose(glm.mat2.create(), this.DmInverse);

        this.gradN1 = glm.vec2.fromValues(dmInvT[0], dmInvT[1]);
        this.gradN2 = glm.vec2.fromValues(dmInvT[2], dmInvT[3]);

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
        const a: number = 1 + this.lameMu / this.lameLambda;

        // TO COMPUTE DERIVATIVES:
        // E = μ/2 (I1 - 2) + λ/2 (J - a)^2
        // first Piola P = μ F + λ (J - a)*J*F^{-T}
        const P : glm.mat2 = glm.mat2.create();
        const fact1: glm.mat2 = glm.mat2.create();
        const fact2: glm.mat2 = glm.mat2.create();

        glm.mat2.multiplyScalar(fact1, F, this.lameMu);

        const scale = this.lameLambda * (J - a) * J;
        glm.mat2.multiplyScalar(fact2, invFt, scale);
        glm.mat2.add(P, fact1, fact2);

        const fi = glm.vec2.create();
        switch (body)
        {
            case this.bodyA:
                glm.vec2.transformMat2(fi, this.gradN0, P); // P * gradN0
                break;
            
            case this.bodyB:
                glm.vec2.transformMat2(fi, this.gradN1, P);

                break;
            
            case this.bodyC:
                glm.vec2.transformMat2(fi, this.gradN2, P);
                break;

            default:
                return;
        }

        glm.vec2.scale(fi, fi, -this.restArea);
        this.grad_E[0] = glm.vec3.fromValues(fi[0], fi[1], 0);

        // hessian = dE^2/dF^2
        // H = mu H1 + lambda H2
        // H1 = mu * d(trace(F^T F))/dF^2
        // H2 = lambda * d( (J - a)^2 )/dF^2
        // 
        //  H1 = mu * I (4th order identity)
        //  because J = f0 f3 - f1 f2
        // dJ/dF = [ f3  -f2 ]
        //         [ -f1  f0 ]
        //
        // d2J/dF2 = [ 0    0   0   1 ]
        //           [ 0    0  -1   0 ]
        //           [ 0   -1   0   0 ]
        //           [ 1    0   0   0 ]
        //
        // H2 = lambda * ( (dJ/dF) ⊗ (dJ/dF) + (J - a) * d2J/dF2 )
        const H = glm.mat4.create();

        const H1 = glm.mat4.identity(glm.mat4.create());
        glm.mat4.multiplyScalar(H1, H1, this.lameMu);

        const dJ_dF = glm.vec4.fromValues(
            F[3], -F[2],
            -F[1], F[0]
        );

        const outer: glm.mat4 = outerMat4D(dJ_dF, dJ_dF);
        const HJ = glm.mat4.fromValues(
            0, 0, 0, 1,
            0, 0, -1, 0,
            0, -1, 0, 0,
            1, 0, 0, 0
        );

        const H2 = glm.mat4.create();
        glm.mat4.multiplyScalar(H2, outer, this.lameLambda);
        const HJ_scaled = glm.mat4.create();
        glm.mat4.multiplyScalar(HJ_scaled, HJ, this.lameLambda * (J - a));
        glm.mat4.add(H2, H2, HJ_scaled);

        // Combine H1 and H2 into H
        glm.mat4.add(H, H1 as unknown as glm.mat4, H2);

        // Transform into per body hessian 3x3
        // Convert H(F) (4x4) → Hessian wrt vertex displacements (2x2)

        const makeGi = (g: glm.vec2): glm.mat4 => {
            const Gi = glm.mat4.create();

            // vec(F) ordering: [F00, F10, F01, F11]

            // Column 0 (dx)
            Gi[0]  = g[0];   // F00 += dx * gx
            Gi[1]  = g[1];   // F10 += dx * gy
            Gi[2]  = 0;
            Gi[3]  = 0;

            // Column 1 (dy)
            Gi[4]  = 0;
            Gi[5]  = 0;
            Gi[6]  = g[0];   // F01 += dy * gx
            Gi[7]  = g[1];   // F11 += dy * gy

            return Gi;
        };

        let g;
        if (body === this.bodyA) g = this.gradN0;
        else if (body === this.bodyB) g = this.gradN1;
        else if (body === this.bodyC) g = this.gradN2;
        else return;

        const Gi = makeGi(g);
        const GiT = glm.mat4.transpose(glm.mat4.create(), Gi); // 2×4

        // temp = H_F * Gi
        const temp = glm.mat4.multiply(glm.mat4.create(), H, Gi); // (4×4)*(4×2) = 4×2

        const Hi = glm.mat2.create();
        {
            const M = glm.mat2.create();

            for (let r = 0; r < 2; ++r) {
                for (let c = 0; c < 2; ++c) {
                    let sum = 0;
                    for (let k = 0; k < 4; ++k) {
                        sum += GiT[r*4 + k] * temp[k*2 + c];
                    }
                    M[r*2 + c] = sum;
                }
            }

            glm.mat2.multiplyScalar(Hi, M, this.restArea);
        }

        // Embed 2×2 into your 3×3 body Hessian
        this.hess_E[0] = glm.mat3.fromValues(
            Hi[0], Hi[1], 0,
            Hi[2], Hi[3], 0,
            0,     0,     0
        );
    }
}

// ================================== //
export default NeoHookianEnergy;