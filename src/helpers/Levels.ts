import { ref } from 'vue';
import levelsJson from '@src/assets/Levels/levels.json';
import * as glm from 'gl-matrix';

// ================================== //
export interface GObject {
    Position: glm.vec2;
    Rotation: number;
    Scale: glm.vec2;
    Color: string;
}

// ================================== //
export interface Scene {
    Static: GObject[];
    Dynamic: GObject[];
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
                Rotation: number[]; // matches your JSON
                Scale: number[];
                Color: string;
            }[];
            Dynamic?: {
                Position: number[];
                Rotation: number[];
                Scale: number[];
                Color: string;
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
            Rotation: obj.Rotation[0],
            Scale: glm.vec2.fromValues(obj.Scale[0], obj.Scale[1]),
            Color: obj.Color
        })),
        Dynamic: l.Scene.Dynamic?.map(obj => ({
            Position: glm.vec2.fromValues(obj.Position[0], obj.Position[1]),
            Rotation: obj.Rotation[0],
            Scale: glm.vec2.fromValues(obj.Scale[0], obj.Scale[1]),
            Color: obj.Color
        })) ?? []
    }
}));

// ================================== //
export function useLevels() 
{
    return {
        parsedLevels
    };
}