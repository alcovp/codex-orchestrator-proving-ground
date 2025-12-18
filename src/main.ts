import { attachKeyboardControls } from "./controls";
import { createScene3D } from "./scene";
import { settings } from "./settings";
import { SnakeGameState } from "./state";

const canvasElement = document.getElementById("game");
if (!(canvasElement instanceof HTMLCanvasElement)) {
  throw new Error('Не найден canvas с id="game"');
}

const scene = createScene3D(canvasElement, settings);
const game = new SnakeGameState(settings);
const explosionDurationMs = 3000;
let explosionTimeoutId: number | null = null;
let isExploding = false;
let lastFrameTime = performance.now();

attachKeyboardControls((direction) => game.tryChangeDirection(direction));

function renderLoop(): void {
  const now = performance.now();
  const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.2);
  lastFrameTime = now;

  if (!isExploding) {
    const result = game.step(deltaSeconds);
    scene.updateSnake(game.snake);
    scene.updateApple(game.apple);
    scene.updateEnemies(game.enemies);
    if (result.status === "dead") {
      isExploding = true;
      scene.startExplosion(result.segments);
      if (explosionTimeoutId !== null) {
        window.clearTimeout(explosionTimeoutId);
      }
      explosionTimeoutId = window.setTimeout(() => {
        scene.stopExplosion();
        game.reset();
        scene.updateSnake(game.snake);
        scene.updateApple(game.apple);
        scene.updateScore(game.score);
        scene.updateEnemies(game.enemies);
        isExploding = false;
      }, explosionDurationMs);
    } else if (result.ateApple) {
      scene.updateScore(game.score);
    }
  }

  scene.render();
  window.requestAnimationFrame(renderLoop);
}

game.reset();
scene.updateSnake(game.snake);
scene.updateApple(game.apple);
scene.updateScore(game.score);
scene.updateEnemies(game.enemies);
window.requestAnimationFrame(renderLoop);
window.addEventListener("resize", () => scene.resize());
