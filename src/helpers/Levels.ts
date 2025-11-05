import { ref } from 'vue';
import levelsJson from '@src/assets/Levels/levels.json';
import * as glm from 'gl-matrix';
import { degreesToRadians } from './MathUtils';

// ================================== //
export interface GObject {
    Position: glm.vec2;
    Rotation: number;
    InitVelocity: glm.vec3;
    Scale: glm.vec2;
    Friction: number;
    Color: string;
}

// ================================== //
export interface JointForce {
    bodyAIndex: number | null;
    bodyBIndex: number;
    rA_offset_center: glm.vec2;
    rB_offset_center: glm.vec2;
    stiffness: glm.vec3;
    fracture: number;
}

// ================================== //
export interface Scene {
    Static: GObject[];
    Dynamic: GObject[];
    JointForces?: JointForce[];
}

// ================================== //
export interface Level {
    id: number;
    title: string;
    Scene: Scene;
}

//================================//
interface LevelsFile {
    Levels: {
        LevelID: number;
        LevelName: string;
        Scene: {
            Static?: {
                Position: number[];
                Rotation: number[];
                InitVelocity: number[];
                Scale: number[];
                Friction: number;
                Color: string;
            }[];
            Dynamic?: {
                Position: number[];
                Rotation: number[];
                InitVelocity: number[];
                Scale: number[];
                Friction: number;
                Color: string;
            }[];
            JointForces: {
                bodyAIndex: number | null;
                bodyBIndex: number;
                rA_offset_center: number[];
                rB_offset_center: number[];
                stiffness: number[];
                fracture: number;
            }[];
        };
    }[];
}

//================================//
const Levels = ref<LevelsFile | null>(levelsJson as LevelsFile);

// ================================== //
export const parsedLevels = 
Levels.value?.Levels.map(l => (
{
    id: l.LevelID,
    title: l.LevelName,
    Scene: 
    {
        Static: l.Scene.Static?.map(obj => ({
            Position: glm.vec2.fromValues(obj.Position[0], obj.Position[1]),
            Rotation: degreesToRadians(obj.Rotation[0]),
            InitVelocity: glm.vec3.fromValues(obj.InitVelocity[0], obj.InitVelocity[1], obj.InitVelocity[2]),
            Scale: glm.vec2.fromValues(obj.Scale[0], obj.Scale[1]),
            Friction: obj.Friction,
            Color: obj.Color,
        })),
        Dynamic: l.Scene.Dynamic?.map(obj => ({
            Position: glm.vec2.fromValues(obj.Position[0], obj.Position[1]),
            Rotation: degreesToRadians(obj.Rotation[0]),
            InitVelocity: glm.vec3.fromValues(obj.InitVelocity[0], obj.InitVelocity[1], obj.InitVelocity[2]),
            Scale: glm.vec2.fromValues(obj.Scale[0], obj.Scale[1]),
            Friction: obj.Friction,
            Color: obj.Color
        })) ?? [],
        JointForces: l.Scene.JointForces?.map(jf => ({
            bodyAIndex: jf.bodyAIndex,
            bodyBIndex: jf.bodyBIndex,
            rA_offset_center: glm.vec2.fromValues(jf.rA_offset_center[0], jf.rA_offset_center[1]),
            rB_offset_center: glm.vec2.fromValues(jf.rB_offset_center[0], jf.rB_offset_center[1]),
            stiffness: glm.vec3.fromValues(jf.stiffness[0], jf.stiffness[1], jf.stiffness[2]),
            fracture: jf.fracture,
        })),
    }
}));

// ================================== //
export function useLevels() 
{
    return {
        parsedLevels
    };
}