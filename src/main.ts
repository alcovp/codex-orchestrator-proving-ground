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

attachKeyboardControls((direction) => game.tryChangeDirection(direction));

function tick(): void {
  const result = game.step();
  scene.updateSnake(game.snake);
  scene.updateApple(game.apple);
  if (result.reset) {
    scene.updateSnake(game.snake);
    scene.updateApple(game.apple);
  }
}

function renderLoop(): void {
  scene.render();
  window.requestAnimationFrame(renderLoop);
}

game.reset();
scene.updateSnake(game.snake);
scene.updateApple(game.apple);
window.requestAnimationFrame(renderLoop);
window.setInterval(tick, settings.tickMs);
window.addEventListener("resize", () => scene.resize());
