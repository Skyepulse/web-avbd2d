//================================//
import GameManager from "./src/game/GameManager";

//================================//
export async function startupGame(canvas: HTMLCanvasElement)
{
    const gameManager = new GameManager(canvas);
    await gameManager.initialize();
    return gameManager;
}