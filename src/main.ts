import * as THREE from "three";

type Point = { x: number; y: number };
type GameState = "idle" | "playing" | "paused" | "gameover";

const settings = {
  columns: 20,
  rows: 20,
  tile: 30,
  tickMs: 140,
  background: "#0b0f16",
  grid: "#d1d5db",
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
const unit = settings.tile;
const boardWidth = settings.columns * unit;
const boardHeight = settings.rows * unit;
const boardOffset = new THREE.Vector3(
  -boardWidth / 2 + unit / 2,
  0,
  -boardHeight / 2 + unit / 2,
);
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

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(settings.background, 1);
renderer.setSize(boardWidth, boardHeight, false);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
const cameraHeight = Math.max(boardWidth, boardHeight) * 0.9;
camera.position.set(boardWidth * 0.35, cameraHeight, boardHeight * 0.9);
camera.lookAt(0, 0, 0);

const ambient = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambient);
const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
keyLight.position.set(boardWidth, boardHeight * 1.4, boardHeight);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
fillLight.position.set(-boardWidth * 0.6, boardHeight, -boardHeight * 0.5);
scene.add(fillLight);

const floorMaterial = new THREE.MeshStandardMaterial({
  color: "#0f172a",
  roughness: 0.9,
  metalness: 0.02,
});
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(boardWidth + unit, boardHeight + unit),
  floorMaterial,
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

scene.add(createGrid());

const snakeGeometry = new THREE.BoxGeometry(unit * 0.9, unit * 0.9, unit * 0.9);
const snakeMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color(settings.snake),
});
const snakeHeadMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color(settings.snakeHead),
});

const appleGeometry = new THREE.BoxGeometry(unit * 0.8, unit * 0.8, unit * 0.8);
const appleMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color(settings.apple),
  emissive: new THREE.Color(settings.apple),
  emissiveIntensity: 0.22,
});

const snakeMeshes: THREE.Mesh[] = [];
const appleMesh = new THREE.Mesh(appleGeometry, appleMaterial);
scene.add(appleMesh);

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

function createGrid(): THREE.LineSegments {
  const positions: number[] = [];
  for (let col = 0; col <= settings.columns; col += 1) {
    const x = -boardWidth / 2 + col * unit;
    positions.push(x, 0.01, -boardHeight / 2, x, 0.01, boardHeight / 2);
  }
  for (let row = 0; row <= settings.rows; row += 1) {
    const z = -boardHeight / 2 + row * unit;
    positions.push(-boardWidth / 2, 0.01, z, boardWidth / 2, 0.01, z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color(settings.grid),
    transparent: true,
    opacity: 0.18,
  });
  return new THREE.LineSegments(geometry, material);
}

function cellToWorld(point: Point): THREE.Vector3 {
  return new THREE.Vector3(
    boardOffset.x + point.x * unit,
    unit * 0.45,
    boardOffset.z + point.y * unit,
  );
}

function ensureSnakeMeshes(): void {
  while (snakeMeshes.length < snake.length) {
    const mesh = new THREE.Mesh(snakeGeometry, snakeMaterial);
    scene.add(mesh);
    snakeMeshes.push(mesh);
  }
  while (snakeMeshes.length > snake.length) {
    const mesh = snakeMeshes.pop();
    if (mesh) {
      scene.remove(mesh);
    }
  }
  snake.forEach((segment, index) => {
    const mesh = snakeMeshes[index];
    if (!mesh) return;
    mesh.material = index === 0 ? snakeHeadMaterial : snakeMaterial;
    const world = cellToWorld(segment);
    mesh.position.set(world.x, world.y, world.z);
  });
}

function updateAppleMesh(): void {
  const world = cellToWorld(apple);
  appleMesh.position.set(world.x, world.y, world.z);
}

function renderScene(): void {
  ensureSnakeMeshes();
  updateAppleMesh();
  renderer.render(scene, camera);
}

function handleResize(): void {
  const width = canvas.clientWidth || boardWidth;
  const height = (width * boardHeight) / boardWidth;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderScene();
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
  renderScene();
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
    renderScene();
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

  renderScene();
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

window.addEventListener("resize", handleResize);
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
  renderScene();
});

pauseButton.addEventListener("click", () => {
  if (gameState === "playing") {
    setGameState("paused");
  } else if (gameState === "paused") {
    setGameState("playing");
  }
});

resetGame();
updateScoreDisplay();
setGameState("idle");
showStartMenu();
handleResize();
window.setInterval(step, settings.tickMs);
