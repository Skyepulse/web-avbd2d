import RigidBox from "@src/components/src/game/RigidBox";
import { vec2, vec3 } from 'gl-matrix';

//================================//
export function getInfoElement(): HTMLElement | null 
{
    return document.getElementById("info");
}

//================================//
export function getUtilElement(): HTMLElement | null
{
    return document.getElementById("utils");
}

// ================================== //
export function createParticle(position: vec2, mass: number, color: string): RigidBox
{
    const size: vec2 = vec2.fromValues(0.5, 0.5);
    const density: number = mass / (size[0] * size[1]);
    const friction: number = 0.0;

    const colorArr = new Uint8Array(4);
    colorArr[0] = parseInt(color.slice(1, 3), 16);
    colorArr[1] = parseInt(color.slice(3, 5), 16);
    colorArr[2] = parseInt(color.slice(5, 7), 16);
    colorArr[3] = 255;

    const position3D: vec3 = vec3.fromValues(position[0], position[1], 0);
    const velocity: vec3 = vec3.fromValues(0, 0, 0);

    return new RigidBox(size, colorArr, density, friction, position3D, velocity);
}