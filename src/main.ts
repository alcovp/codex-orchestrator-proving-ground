type Point = { x: number; y: number };
type GameState = "idle" | "playing" | "paused" | "gameover";

const settings = {
  columns: 20,
  rows: 20,
  tile: 30,
  tickMs: 140,
  background: "#0b0f16",
  grid: "rgba(255, 255, 255, 0.06)",
  snake: "#4ade80",
  snakeHead: "#22c55e",
  apple: "#f43f5e",
};

const canvas = (() => {
  const element = document.getElementById("game");
  if (!(element instanceof HTMLCanvasElement)) {
    throw new Error("Не найден canvas с id=\"game\"");
  }
  return element;
})();
const statusLabel = (() => {
  const element = document.getElementById("status-label");
  if (!(element instanceof HTMLElement)) {
    throw new Error("Не найден элемент статуса");
  }
  return element;
})();
const scoreValue = (() => {
  const element = document.getElementById("score-value");
  if (!(element instanceof HTMLElement)) {
    throw new Error("Не найден счётчик очков");
  }
  return element;
})();
const pauseButton = (() => {
  const element = document.getElementById("pause-btn");
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error("Не найдена кнопка паузы");
  }
  return element;
})();
const menu = (() => {
  const element = document.getElementById("menu");
  if (!(element instanceof HTMLElement)) {
    throw new Error("Не найдено меню");
  }
  return element;
})();
const menuTitle = (() => {
  const element = document.getElementById("menu-title");
  if (!(element instanceof HTMLElement)) {
    throw new Error("Не найден заголовок меню");
  }
  return element;
})();
const menuSubtitle = (() => {
  const element = document.getElementById("menu-subtitle");
  if (!(element instanceof HTMLElement)) {
    throw new Error("Не найден подзаголовок меню");
  }
  return element;
})();
const menuAction = (() => {
  const element = document.getElementById("menu-action");
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error("Не найдена кнопка в меню");
  }
  return element;
})();

const context = (() => {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D контекст недоступен");
  }
  return ctx;
})();

canvas.width = settings.columns * settings.tile;
canvas.height = settings.rows * settings.tile;

const stateLabelByState: Record<GameState, string> = {
  idle: "Ожидание",
  playing: "Игра",
  paused: "Пауза",
  gameover: "Поражение",
};

// Направление движения: текущие и запрошенные стрелками векторы.
let direction: Point = { x: 1, y: 0 };
let nextDirection: Point = { x: 1, y: 0 };

let snake: Point[] = [];
let apple: Point = { x: 0, y: 0 };
let gameState: GameState = "idle";
let score = 0;

function setGameState(next: GameState): void {
  gameState = next;
  statusLabel.textContent = stateLabelByState[next];
  pauseButton.disabled = next === "idle" || next === "gameover";
  pauseButton.textContent = next === "paused" ? "Продолжить" : "Пауза";
  pauseButton.setAttribute("aria-pressed", next === "paused" ? "true" : "false");
}

function updateScoreDisplay(): void {
  scoreValue.textContent = score.toString();
}

function showStartMenu(): void {
  menuTitle.textContent = "Змейка";
  menuSubtitle.textContent = "Нажмите старт, чтобы начать партию";
  menuAction.textContent = "Начать игру";
  menu.classList.remove("hidden");
}

function showGameOverMenu(): void {
  menuTitle.textContent = "Поражение";
  menuSubtitle.textContent = "Змейка врезалась. Попробуйте снова!";
  menuAction.textContent = "Начать заново";
  menu.classList.remove("hidden");
}

function hideMenu(): void {
  menu.classList.add("hidden");
}

function resetGame(): void {
  const startX = Math.floor(settings.columns / 2);
  const startY = Math.floor(settings.rows / 2);
  direction = { x: 1, y: 0 };
  nextDirection = { x: 1, y: 0 };
  snake = [
    { x: startX, y: startY },
    { x: startX - 1, y: startY },
    { x: startX - 2, y: startY },
  ];
  apple = spawnApple();
}

function spawnApple(): Point {
  const freeCells: Point[] = [];
  for (let y = 0; y < settings.rows; y += 1) {
    for (let x = 0; x < settings.columns; x += 1) {
      const cell = { x, y };
      if (!isOnSnake(cell)) {
        freeCells.push(cell);
      }
    }
  }
  if (freeCells.length === 0) {
    const fallback = snake[0];
    return fallback ? { ...fallback } : { x: 0, y: 0 };
  }
  const pick = Math.floor(Math.random() * freeCells.length);
  const cell = freeCells[pick];
  return cell ?? { x: 0, y: 0 };
}

function isOnSnake(point: Point): boolean {
  return snake.some((segment) => segment.x === point.x && segment.y === point.y);
}

function isOutOfBounds(point: Point): boolean {
  return (
    point.x < 0 ||
    point.y < 0 ||
    point.x >= settings.columns ||
    point.y >= settings.rows
  );
}

function drawBackground(): void {
  context.fillStyle = settings.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = settings.grid;
  context.lineWidth = 1;

  // Небольшая сетка помогает оценивать позицию.
  for (let x = 0; x <= settings.columns; x += 1) {
    const pos = x * settings.tile + 0.5;
    context.beginPath();
    context.moveTo(pos, 0);
    context.lineTo(pos, canvas.height);
    context.stroke();
  }
  for (let y = 0; y <= settings.rows; y += 1) {
    const pos = y * settings.tile + 0.5;
    context.beginPath();
    context.moveTo(0, pos);
    context.lineTo(canvas.width, pos);
    context.stroke();
  }
}

function drawCell(point: Point, color: string): void {
  context.fillStyle = color;
  context.fillRect(
    point.x * settings.tile + 1,
    point.y * settings.tile + 1,
    settings.tile - 2,
    settings.tile - 2,
  );
}

function draw(): void {
  drawBackground();
  snake.forEach((segment, index) => {
    drawCell(segment, index === 0 ? settings.snakeHead : settings.snake);
  });
  drawCell(apple, settings.apple);
}

function step(): void {
  if (gameState !== "playing") {
    return;
  }

  direction = nextDirection;
  const head = snake[0];
  if (!head) {
    return;
  }
  const newHead: Point = { x: head.x + direction.x, y: head.y + direction.y };

  if (isOutOfBounds(newHead) || isOnSnake(newHead)) {
    setGameState("gameover");
    showGameOverMenu();
    draw();
    return;
  }

  const ateApple = newHead.x === apple.x && newHead.y === apple.y;
  snake = [newHead, ...snake];
  if (!ateApple) {
    snake.pop();
  } else {
    score += 1;
    updateScoreDisplay();
    apple = spawnApple();
  }

  draw();
}

function tryChangeDirection(requested: Point): void {
  const reversing =
    requested.x + direction.x === 0 && requested.y + direction.y === 0;
  if (reversing) {
    return;
  }
  nextDirection = requested;
}

const directionsByKey: Record<string, Point> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

window.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "Spacebar") {
    event.preventDefault();
    if (gameState === "playing") {
      setGameState("paused");
    } else if (gameState === "paused") {
      setGameState("playing");
    }
    return;
  }

  const requested = directionsByKey[event.key];
  if (!requested) {
    return;
  }
  if (gameState !== "playing") {
    return;
  }

  event.preventDefault();
  tryChangeDirection(requested);
});

menuAction.addEventListener("click", () => {
  resetGame();
  score = 0;
  updateScoreDisplay();
  hideMenu();
  setGameState("playing");
  draw();
});

pauseButton.addEventListener("click", () => {
  if (gameState === "playing") {
    setGameState("paused");
  } else if (gameState === "paused") {
    setGameState("playing");
  }
});

resetGame();
draw();
updateScoreDisplay();
setGameState("idle");
showStartMenu();
window.setInterval(step, settings.tickMs);
