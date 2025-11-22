import * as THREE from "three";
import {
  Body,
  Box as CannonBox,
  ContactMaterial,
  Material as CannonMaterial,
  Plane,
  Vec3,
  World,
} from "cannon-es";

type Cell = { x: number; y: number };
type GameState = "idle" | "playing" | "paused" | "exploding";

const settings = {
  columns: 16,
  rows: 16,
  tileSize: 1,
  tickMs: 160,
};

const colors = {
  background: "#0b0f16",
  grid: "#1e2533",
  snake: "#4ade80",
  snakeHead: "#22c55e",
  apple: "#f43f5e",
  floor: "#0f172a",
};

const canvasElement = document.getElementById("game");
if (!(canvasElement instanceof HTMLCanvasElement)) {
  throw new Error('Не найден canvas с id="game"');
}
const canvas = canvasElement;

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

const stateLabelByState: Record<GameState, string> = {
  idle: "Ожидание",
  playing: "Игра",
  paused: "Пауза",
  exploding: "Поражение",
};

const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(colors.background);

const boardWidth = settings.columns * settings.tileSize;
const boardDepth = settings.rows * settings.tileSize;
const camera = new THREE.PerspectiveCamera(
  55,
  canvas.clientWidth / canvas.clientHeight,
  0.1,
  200,
);
camera.position.set(boardWidth * 0.45, boardWidth * 0.9, boardDepth * 0.75);
camera.lookAt(new THREE.Vector3(0, 0, 0));

scene.add(new THREE.AmbientLight(0xffffff, 0.65));

const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
keyLight.position.set(12, 16, 10);
keyLight.castShadow = false;
scene.add(keyLight);

const floorMaterial = new THREE.MeshStandardMaterial({
  color: colors.floor,
  metalness: 0.15,
  roughness: 0.85,
});
const floorMesh = new THREE.Mesh(
  new THREE.BoxGeometry(boardWidth + 1, 0.4, boardDepth + 1),
  floorMaterial,
);
floorMesh.position.set(0, -0.2, 0);
floorMesh.receiveShadow = true;
scene.add(floorMesh);

const gridHelper = new THREE.GridHelper(
  boardWidth,
  settings.columns,
  colors.grid,
  colors.grid,
);
gridHelper.position.y = 0.001;
scene.add(gridHelper);

const snakeGeometry = new THREE.BoxGeometry(
  settings.tileSize * 0.9,
  settings.tileSize * 0.9,
  settings.tileSize * 0.9,
);
const snakeMaterial = new THREE.MeshStandardMaterial({ color: colors.snake });
const snakeHeadMaterial = new THREE.MeshStandardMaterial({
  color: colors.snakeHead,
  emissive: new THREE.Color(colors.snakeHead).multiplyScalar(0.1),
});
const snakeMeshes: THREE.Mesh[] = [];
const snakeGroup = new THREE.Group();
scene.add(snakeGroup);

const appleGeometry = new THREE.SphereGeometry(
  settings.tileSize * 0.35,
  22,
  22,
);
const appleMaterial = new THREE.MeshStandardMaterial({
  color: colors.apple,
  emissive: new THREE.Color(colors.apple).multiplyScalar(0.2),
});
const appleMesh = new THREE.Mesh(appleGeometry, appleMaterial);
appleMesh.castShadow = false;
scene.add(appleMesh);

let direction: Cell = { x: 1, y: 0 };
let nextDirection: Cell = { x: 1, y: 0 };
let snake: Cell[] = [];
let apple: Cell = { x: 0, y: 0 };
let gameState: GameState = "idle";
let score = 0;

let physicsWorld: World | null = null;
let physicsBodies: Body[] = [];
let explosionTimeoutId: number | null = null;

let tickAccumulatorMs = 0;
let lastFrame = performance.now();

function setGameState(next: GameState): void {
  gameState = next;
  statusLabel.textContent = stateLabelByState[next];
  const paused = next === "paused";
  pauseButton.disabled = next === "idle" || next === "exploding";
  pauseButton.textContent = paused ? "Продолжить" : "Пауза";
  pauseButton.setAttribute("aria-pressed", paused ? "true" : "false");
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

function gridToWorld(cell: Cell): THREE.Vector3 {
  const x = (cell.x - settings.columns / 2 + 0.5) * settings.tileSize;
  const z = (cell.y - settings.rows / 2 + 0.5) * settings.tileSize;
  return new THREE.Vector3(x, settings.tileSize * 0.5, z);
}

function resizeRenderer(): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

function isOnSnake(cell: Cell): boolean {
  return snake.some((segment) => segment.x === cell.x && segment.y === cell.y);
}

function isOutOfBounds(cell: Cell): boolean {
  return (
    cell.x < 0 ||
    cell.y < 0 ||
    cell.x >= settings.columns ||
    cell.y >= settings.rows
  );
}

function spawnApple(): Cell {
  const freeCells: Cell[] = [];
  for (let y = 0; y < settings.rows; y += 1) {
    for (let x = 0; x < settings.columns; x += 1) {
      const candidate = { x, y };
      if (!isOnSnake(candidate)) {
        freeCells.push(candidate);
      }
    }
  }
  if (freeCells.length === 0) {
    return snake[0] ? { ...snake[0] } : { x: 0, y: 0 };
  }
  const pick = Math.floor(Math.random() * freeCells.length);
  return freeCells[pick] ?? { x: 0, y: 0 };
}

function ensureSnakeMeshes(): void {
  while (snakeMeshes.length < snake.length) {
    const segment = new THREE.Mesh(snakeGeometry, snakeMaterial);
    segment.castShadow = true;
    snakeMeshes.push(segment);
    snakeGroup.add(segment);
  }
  while (snakeMeshes.length > snake.length) {
    const segment = snakeMeshes.pop();
    if (segment) {
      snakeGroup.remove(segment);
    }
  }

  snakeMeshes.forEach((mesh, index) => {
    mesh.material = index === 0 ? snakeHeadMaterial : snakeMaterial;
  });
}

function updateSnakeMeshesFromGrid(): void {
  ensureSnakeMeshes();
  snakeMeshes.forEach((mesh) => {
    mesh.quaternion.identity();
  });
  snake.forEach((segment, index) => {
    const mesh = snakeMeshes[index];
    if (!mesh) {
      return;
    }
    const worldPos = gridToWorld(segment);
    mesh.position.copy(worldPos);
  });
}

function updateAppleMesh(): void {
  const worldPos = gridToWorld(apple);
  appleMesh.position.copy(worldPos);
}

function resetRound(): void {
  destroyPhysicsWorld();
  direction = { x: 1, y: 0 };
  nextDirection = { x: 1, y: 0 };
  const startX = Math.floor(settings.columns / 2);
  const startY = Math.floor(settings.rows / 2);
  snake = [
    { x: startX, y: startY },
    { x: startX - 1, y: startY },
    { x: startX - 2, y: startY },
  ];
  apple = spawnApple();
  tickAccumulatorMs = 0;
  updateSnakeMeshesFromGrid();
  updateAppleMesh();
}

function cancelExplosionTimeout(): void {
  if (explosionTimeoutId !== null) {
    window.clearTimeout(explosionTimeoutId);
    explosionTimeoutId = null;
  }
}

function startNewGame(): void {
  cancelExplosionTimeout();
  score = 0;
  updateScoreDisplay();
  resetRound();
  hideMenu();
  setGameState("playing");
}

function tryChangeDirection(requested: Cell): void {
  if (gameState !== "playing") {
    return;
  }
  const reversing =
    requested.x + direction.x === 0 && requested.y + direction.y === 0;
  if (reversing) {
    return;
  }
  nextDirection = requested;
}

const directionsByKey: Record<string, Cell> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

function handleResize(): void {
  resizeRenderer();
  renderer.render(scene, camera);
}

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

  if (event.key === "Enter") {
    if (gameState === "idle") {
      event.preventDefault();
      startNewGame();
      return;
    }
    if (gameState === "exploding") {
      event.preventDefault();
      finishExplosion();
      return;
    }
  }

  const requested = directionsByKey[event.key];
  if (!requested) {
    return;
  }

  event.preventDefault();
  tryChangeDirection(requested);
});

menuAction.addEventListener("click", () => {
  startNewGame();
});

pauseButton.addEventListener("click", () => {
  if (gameState === "playing") {
    setGameState("paused");
  } else if (gameState === "paused") {
    setGameState("playing");
  }
});

function stepGame(): void {
  if (gameState !== "playing") {
    return;
  }
  direction = nextDirection;
  const head = snake[0];
  if (!head) {
    return;
  }
  const newHead: Cell = { x: head.x + direction.x, y: head.y + direction.y };

  if (isOutOfBounds(newHead) || isOnSnake(newHead)) {
    triggerDeath();
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
    updateAppleMesh();
  }

  updateSnakeMeshesFromGrid();
}

function triggerDeath(): void {
  if (gameState === "exploding") {
    return;
  }
  setGameState("exploding");
  cancelExplosionTimeout();
  startExplosionPhysics();
  explosionTimeoutId = window.setTimeout(() => {
    if (gameState === "exploding") {
      finishExplosion();
    }
  }, 2600);
}

function finishExplosion(): void {
  cancelExplosionTimeout();
  resetRound();
  setGameState("idle");
  showGameOverMenu();
}

function startExplosionPhysics(): void {
  destroyPhysicsWorld();
  physicsWorld = new World({
    gravity: new Vec3(0, -18, 0),
  });
  const groundMaterial = new CannonMaterial("ground");
  const segmentMaterial = new CannonMaterial("segment");
  physicsWorld.addContactMaterial(
    new ContactMaterial(segmentMaterial, groundMaterial, {
      friction: 0.45,
      restitution: 0.35,
    }),
  );

  const groundBody = new Body({
    mass: 0,
    material: groundMaterial,
  });
  groundBody.addShape(new Plane());
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  physicsWorld.addBody(groundBody);

  const halfSize = (settings.tileSize * 0.9) / 2;
  physicsBodies = snakeMeshes.map((mesh) => {
    const body = new Body({
      mass: 1,
      material: segmentMaterial,
      position: new Vec3(mesh.position.x, mesh.position.y, mesh.position.z),
      angularDamping: 0.1,
      linearDamping: 0.02,
    });
    body.addShape(new CannonBox(new Vec3(halfSize, halfSize, halfSize)));
    body.quaternion.set(
      mesh.quaternion.x,
      mesh.quaternion.y,
      mesh.quaternion.z,
      mesh.quaternion.w,
    );
    physicsWorld!.addBody(body);

    const impulseStrength = 5 + Math.random() * 2;
    const impulse = new Vec3(
      (Math.random() - 0.5) * impulseStrength,
      impulseStrength * 0.7,
      (Math.random() - 0.5) * impulseStrength,
    );
    body.applyImpulse(impulse, body.position);
    return body;
  });
}

function destroyPhysicsWorld(): void {
  if (!physicsWorld) {
    return;
  }
  physicsBodies.forEach((body) => physicsWorld?.removeBody(body));
  physicsBodies = [];
  physicsWorld = null;
}

function stepPhysics(deltaSeconds: number): void {
  if (!physicsWorld) {
    return;
  }
  physicsWorld.step(1 / 60, deltaSeconds, 3);
  physicsBodies.forEach((body, index) => {
    const mesh = snakeMeshes[index];
    if (!mesh) {
      return;
    }
    mesh.position.set(body.position.x, body.position.y, body.position.z);
    mesh.quaternion.set(
      body.quaternion.x,
      body.quaternion.y,
      body.quaternion.z,
      body.quaternion.w,
    );
  });
}

function animate(now: number): void {
  const deltaMs = now - lastFrame;
  lastFrame = now;

  if (gameState === "playing") {
    tickAccumulatorMs += deltaMs;
    while (tickAccumulatorMs >= settings.tickMs) {
      tickAccumulatorMs -= settings.tickMs;
      stepGame();
    }
  } else {
    tickAccumulatorMs = 0;
  }

  stepPhysics(deltaMs / 1000);
  resizeRenderer();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

updateScoreDisplay();
resetRound();
showStartMenu();
setGameState("idle");
resizeRenderer();
requestAnimationFrame(animate);
