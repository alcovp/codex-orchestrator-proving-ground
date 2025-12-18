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

attachKeyboardControls((direction) => game.tryChangeDirection(direction));

function tick(): void {
  if (isExploding) {
    return;
  }
  const result = game.step();
  if (result.status === "dead") {
    isExploding = true;
    scene.startExplosion(result.segments);
    scene.updateEnemies(game.enemies);
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
    return;
  }
  scene.updateSnake(game.snake);
  scene.updateApple(game.apple);
  scene.updateEnemies(game.enemies);
  if (result.ateApple) {
    scene.updateScore(game.score);
  }
}

function renderLoop(): void {
  scene.render();
  window.requestAnimationFrame(renderLoop);
}

game.reset();
scene.updateSnake(game.snake);
scene.updateApple(game.apple);
scene.updateScore(game.score);
scene.updateEnemies(game.enemies);
window.requestAnimationFrame(renderLoop);
window.setInterval(tick, settings.tickMs);
window.addEventListener("resize", () => scene.resize());
