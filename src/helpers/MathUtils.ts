  import * as glm from 'gl-matrix';

  //================================//
  export function rotationMatrix(angle: number): glm.mat2
  {
    const c = Math.cos(angle);
    const s = Math.sin(angle);

    return glm.mat2.fromValues( c, s, 
                                -s, c  );
  }

  //================================//
  export function scaleByValue(m: glm.mat3, v: number): glm.mat3
  {
    const out = glm.mat3.create();
    for (let i = 0; i < 9; ++i) out[i] = m[i] * v;
    return out;
  }

  //================================//
  export function solveLDLT(A: glm.mat3, b: glm.vec3): glm.vec3
  {
    // Decompose A into LDL^T
    let D1 = A[0];
    let L21 = A[3] / A[0];
    let L31 = A[6] / A[0];
    let D2 = A[4] - L21 * L21 * D1;
    let L32 = (A[7] - L31 * L21 * D1) / D2;
    let D3 = A[8] - (L31 * L31 * D1 + L32 * L32 * D2);

    // Ly = b
    let y1 = b[0];
    let y2 = b[1] - L21 * y1;
    let y3 = b[2] - L31 * y1 - L32 * y2;

    // Dz = y
    let z1 = y1 / D1;
    let z2 = y2 / D2;
    let z3 = y3 / D3;

    // L^Tx = z
    const x: glm.vec3 = glm.vec3.fromValues(0, 0, 0);
    x[2] = z3;
    x[1] = z2 - L32 * x[2];
    x[0] = z1 - L21 * x[1] - L31 * x[2];

    return x;
  }

  //================================//
  export function rand(min: number = 0, max: number = 1)
  {
    if (min === undefined) {
      min = 0;
      max = 1;
    } else if (max === undefined) {
      max = min;
      min = 0;
    }
    return min + Math.random() * (max - min);
  };

  //================================//
  export function randomPosInRect(x: number, y: number, width: number, height: number): glm.vec2
  {
    return glm.vec2.fromValues(rand(x, x + width), rand(y, y + height));
  };

  //================================//
  export function randomPosInRectRot(x: number, y: number, width: number, height: number): glm.vec3
  {
    return glm.vec3.fromValues(rand(x, x + width), rand(y, y + height), rand(0, Math.PI * 2));
  };

  //================================//
  export function randomColorUint8(): Uint8Array
  {
    const r = Math.floor(rand(0, 256));
    const g = Math.floor(rand(0, 256));
    const b = Math.floor(rand(0, 256));
    const a = 255;
    return new Uint8Array([r, g, b, a]);
  }

  //================================//
  export function dot2(a: Float32Array, b: Float32Array): number
  {
    return a[0] * b[0] + a[1] * b[1];
  }

  //================================//
  export function dot3(a: Float32Array, b: Float32Array): number
  {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  //================================//
  export function cross2(a: glm.vec2, b: glm.vec2): number
  {
    return a[0] * b[1] - a[1] * b[0];
  }

  // ================================== //
  export function degreesToRadians(degrees: number): number
  {
      return degrees * (Math.PI / 180);
  }

  // ================================== //
  export function rotate2D(v: glm.vec2, angle: number): glm.vec2
  {
      const rotMat: glm.mat2 = rotationMatrix(angle);
      const out: glm.vec2 = glm.vec2.create();
      glm.vec2.transformMat2(out, v, rotMat);
      return out;
  }

  // ================================== //
  export function transform2D(v: glm.vec3, r: glm.vec2): glm.vec2
  {
      const rotMat: glm.mat2 = rotationMatrix(v[2]);
      const out: glm.vec2 = glm.vec2.create();
      glm.vec2.transformMat2(out, r, rotMat);
      glm.vec2.add(out, out, glm.vec2.fromValues(v[0], v[1]));
      return out;
  }

  // ================================== //
  export function scale2D(v: glm.vec2, scale: number): glm.vec2
  {
      const out: glm.vec2 = glm.vec2.create();
      glm.vec2.scale(out, v, scale);
      return out;
  }

  // ================================== //
  export function scaleMat2D(m: glm.mat2, scale: number): glm.mat2
  {
      const out: glm.mat2 = glm.mat2.create();
      for (let i = 0; i < 4; ++i) out[i] = m[i] * scale;
      return out;
  }

  //================================//
  export function scaleMat3D(m: glm.mat3, scale: number): glm.mat3
  {
      const out: glm.mat3 = glm.mat3.create();
      for (let i = 0; i < 9; ++i) out[i] = m[i] * scale;
      return out;
  }

  // ================================== //
  export function outerMat2D(a: glm.vec2, b: glm.vec2): glm.mat2
  {
      const out: glm.mat2 = glm.mat2.create();
      // Do not forget
      // row0, column0 = 0
      // row1, column0 = 1
      // row0, column1 = 2
      // row1, column1 = 3
      // This is called column-major order
      out[0] = a[0] * b[0]; out[2] = a[0] * b[1];
      out[1] = a[1] * b[0]; out[3] = a[1] * b[1];
      return out;
  }

  //================================//
  export function outerMat3D(a: glm.vec3, b: glm.vec3): glm.mat3
  {
    const out = glm.mat3.create();
    out[0] = a[0] * b[0]; out[3] = a[0] * b[1]; out[6] = a[0] * b[2];
    out[1] = a[1] * b[0]; out[4] = a[1] * b[1]; out[7] = a[1] * b[2];
    out[2] = a[2] * b[0]; out[5] = a[2] * b[1]; out[8] = a[2] * b[2];
    return out;
  }

  // ================================== //
  export function outerMat4D(a: glm.vec4, b: glm.vec4): glm.mat4
  {
      const out: glm.mat4 = glm.mat4.create();
      out[0]  = a[0] * b[0]; out[4]  = a[0] * b[1]; out[8]  = a[0] * b[2]; out[12] = a[0] * b[3];
      out[1]  = a[1] * b[0]; out[5]  = a[1] * b[1]; out[9]  = a[1] * b[2]; out[13] = a[1] * b[3];
      out[2]  = a[2] * b[0]; out[6]  = a[2] * b[1]; out[10] = a[2] * b[2]; out[14] = a[2] * b[3];
      out[3]  = a[3] * b[0]; out[7]  = a[3] * b[1]; out[11] = a[3] * b[2]; out[15] = a[3] * b[3];
      return out;
  }

  //================================//
  export function TESTS(): void
  {
      // Validating glm.mat2 column-major order
      const m: glm.mat2 = glm.mat2.fromValues(1, 2, 3, 4);
      console.assert(m[0] === 1 && m[1] === 2 && m[2] === 3 && m[3] === 4, "glm.mat2 column-major order test failed.");

      glm.mat2.set(m,
          1, 3,
          2, 4
      );
      console.assert(m[0] === 1 && m[1] === 3 && m[2] === 2 && m[3] === 4, "glm.mat2 set function test failed.");

      const m1 = glm.mat2.create();
      m1[0] = 1; m1[1] = 3; m1[2] = 2; m1[3] = 4;
      const m2 = glm.mat2.create();
      m2[0] = 5; m2[1] = 7; m2[2] = 6; m2[3] = 8;

      // [ 1, 2       [ 5, 6        [19, 22 
      //   3, 4 ]  x    7, 8 ]  =     43, 50 ]
      //
      const mMul = glm.mat2.multiply(glm.mat2.create(), m1, m2);
      console.assert(mMul[0] === 19 && mMul[1] === 43 && mMul[2] === 22 && mMul[3] === 50, "glm.mat2 multiplication test failed.");
  }