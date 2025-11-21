type Point = { x: number; y: number };

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

const canvas = document.getElementById("game") as HTMLCanvasElement | null;
if (!canvas) {
  throw new Error("Не найден canvas с id=\"game\"");
}

const context = canvas.getContext("2d");
if (!context) {
  throw new Error("Canvas 2D контекст недоступен");
}

canvas.width = settings.columns * settings.tile;
canvas.height = settings.rows * settings.tile;

// Направление движения: текущие и запрошенные стрелками векторы.
let direction: Point = { x: 1, y: 0 };
let nextDirection: Point = { x: 1, y: 0 };

let snake: Point[] = [];
let apple: Point = { x: 0, y: 0 };

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
    return { ...snake[0] };
  }
  const pick = Math.floor(Math.random() * freeCells.length);
  return freeCells[pick];
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
  direction = nextDirection;
  const head = snake[0];
  const newHead: Point = { x: head.x + direction.x, y: head.y + direction.y };

  if (isOutOfBounds(newHead) || isOnSnake(newHead)) {
    resetGame();
    draw();
    return;
  }

  const ateApple = newHead.x === apple.x && newHead.y === apple.y;
  snake = [newHead, ...snake];
  if (!ateApple) {
    snake.pop();
  } else {
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
  const requested = directionsByKey[event.key];
  if (requested) {
    event.preventDefault();
    tryChangeDirection(requested);
  }
});

resetGame();
draw();
window.setInterval(step, settings.tickMs);
