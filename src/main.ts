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
type ObstacleType = "wall" | "bush" | "water" | "rock";
type ManeuverType = "jump" | "burrow";
type PickupType = "apple" | "extraLife" | "slowTime" | "artifact";

type Pickup = { type: PickupType; cell: Cell; spawnedAt: number };
type ManeuverState = {
  type: ManeuverType;
  startedAt: number;
  durationMs: number;
  distance: number;
};
type DeathInfo =
  | { reason: "self"; cell: Cell }
  | { reason: "out-of-bounds"; cell: Cell }
  | { reason: "obstacle"; cell: Cell; obstacle: ObstacleType };

const settings = {
  columns: 16,
  rows: 16,
  tileSize: 1,
  tickMs: 160,
  jumpDistance: 3, // перескакиваем две клетки и приземляемся на третью
  burrowDistance: 3,
  jumpWaveDurationMs: 420,
  burrowWaveDurationMs: 420,
  slowTimeDurationMs: 4500,
  slowTimeMultiplier: 1.6,
  requiredArtifacts: 3,
  baseLives: 1,
};

const colors = {
  background: "#0b0f16",
  grid: "#1e2533",
  snake: "#4ade80",
  snakeHead: "#22c55e",
  apple: "#f43f5e",
  extraLife: "#38bdf8",
  slowTime: "#a855f7",
  artifact: "#fbbf24",
  wall: "#94a3b8",
  bush: "#22c55e",
  water: "#38bdf8",
  rock: "#f97316",
  floor: "#0f172a",
};

const obstacleRules: Record<
  ObstacleType,
  { jumpable: boolean; burrowable: boolean }
> = {
  wall: { jumpable: false, burrowable: true },
  bush: { jumpable: true, burrowable: false },
  water: { jumpable: true, burrowable: false },
  rock: { jumpable: true, burrowable: true },
};

const pickupMeta: Record<
  PickupType,
  { score: number; grow: boolean; respawn: boolean }
> = {
  apple: { score: 1, grow: true, respawn: true },
  extraLife: { score: 1, grow: false, respawn: true },
  slowTime: { score: 1, grow: false, respawn: true },
  artifact: { score: 3, grow: true, respawn: true },
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

const pickupGeometries: Record<PickupType, THREE.BufferGeometry> = {
  apple: new THREE.SphereGeometry(settings.tileSize * 0.35, 22, 22),
  extraLife: new THREE.OctahedronGeometry(settings.tileSize * 0.4, 0),
  slowTime: new THREE.DodecahedronGeometry(settings.tileSize * 0.4),
  artifact: new THREE.TetrahedronGeometry(settings.tileSize * 0.48),
};

const pickupMaterials: Record<PickupType, THREE.MeshStandardMaterial> = {
  apple: new THREE.MeshStandardMaterial({
    color: colors.apple,
    emissive: new THREE.Color(colors.apple).multiplyScalar(0.2),
  }),
  extraLife: new THREE.MeshStandardMaterial({
    color: colors.extraLife,
    emissive: new THREE.Color(colors.extraLife).multiplyScalar(0.2),
    metalness: 0.25,
  }),
  slowTime: new THREE.MeshStandardMaterial({
    color: colors.slowTime,
    emissive: new THREE.Color(colors.slowTime).multiplyScalar(0.3),
    metalness: 0.35,
  }),
  artifact: new THREE.MeshStandardMaterial({
    color: colors.artifact,
    emissive: new THREE.Color(colors.artifact).multiplyScalar(0.25),
    metalness: 0.5,
    roughness: 0.35,
  }),
};

const pickupGroup = new THREE.Group();
scene.add(pickupGroup);

const obstacleGroup = new THREE.Group();
scene.add(obstacleGroup);
const obstacleGeometries: Record<ObstacleType, THREE.BufferGeometry> = {
  wall: new THREE.BoxGeometry(
    settings.tileSize * 0.9,
    settings.tileSize,
    settings.tileSize * 0.9,
  ),
  bush: new THREE.CylinderGeometry(
    settings.tileSize * 0.25,
    settings.tileSize * 0.45,
    settings.tileSize * 0.9,
    12,
  ),
  water: new THREE.CylinderGeometry(
    settings.tileSize * 0.45,
    settings.tileSize * 0.45,
    settings.tileSize * 0.2,
    16,
  ),
  rock: new THREE.DodecahedronGeometry(settings.tileSize * 0.45),
};

const obstacleMaterials: Record<ObstacleType, THREE.MeshStandardMaterial> = {
  wall: new THREE.MeshStandardMaterial({
    color: colors.wall,
    metalness: 0.15,
    roughness: 0.6,
  }),
  bush: new THREE.MeshStandardMaterial({
    color: colors.bush,
    metalness: 0.05,
    roughness: 0.8,
  }),
  water: new THREE.MeshStandardMaterial({
    color: colors.water,
    metalness: 0.7,
    roughness: 0.1,
    transparent: true,
    opacity: 0.7,
  }),
  rock: new THREE.MeshStandardMaterial({
    color: colors.rock,
    metalness: 0.1,
    roughness: 0.85,
  }),
};

let direction: Cell = { x: 1, y: 0 };
let nextDirection: Cell = { x: 1, y: 0 };
let snake: Cell[] = [];
let gameState: GameState = "idle";
let score = 0;
let lives = settings.baseLives;
let collectedArtifacts = 0;

let obstacleMap: (ObstacleType | null)[][] = [];
type PickupEntity = { pickup: Pickup; mesh: THREE.Mesh };
let pickupEntities: PickupEntity[] = [];
let queuedManeuver: ManeuverType | null = null;
let activeManeuver: ManeuverState | null = null;
let slowdownRemainingMs = 0;

let physicsWorld: World | null = null;
let physicsBodies: Body[] = [];
let deathInfo: DeathInfo | null = null;
let explosionOrigin: THREE.Vector3 | null = null;
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
  const slowText =
    slowdownRemainingMs > 0
      ? ` | замедл: ${(slowdownRemainingMs / 1000).toFixed(1)}с`
      : "";
  scoreValue.textContent = `${score} | жизни: ${lives} | артефакты: ${collectedArtifacts}/${settings.requiredArtifacts}${slowText}`;
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

function createObstacleGrid(): (ObstacleType | null)[][] {
  return Array.from({ length: settings.rows }, () =>
    Array.from({ length: settings.columns }, () => null),
  );
}

function getObstacleAt(cell: Cell): ObstacleType | null {
  if (isOutOfBounds(cell)) {
    return null;
  }
  return obstacleMap[cell.y]?.[cell.x] ?? null;
}

function setObstacle(cell: Cell, obstacle: ObstacleType): void {
  if (isOutOfBounds(cell)) {
    return;
  }
  if (!obstacleMap[cell.y]) {
    obstacleMap[cell.y] = [];
  }
  obstacleMap[cell.y][cell.x] = obstacle;
}

function clearObstacleMeshes(): void {
  while (obstacleGroup.children.length > 0) {
    obstacleGroup.remove(obstacleGroup.children[0]);
  }
}

function rebuildObstacleMeshes(): void {
  clearObstacleMeshes();
  for (let y = 0; y < settings.rows; y += 1) {
    for (let x = 0; x < settings.columns; x += 1) {
      const obstacle = obstacleMap[y]?.[x];
      if (!obstacle) {
        continue;
      }
      const mesh = new THREE.Mesh(
        obstacleGeometries[obstacle],
        obstacleMaterials[obstacle],
      );
      const worldPos = gridToWorld({ x, y });
      if (obstacle === "water") {
        worldPos.y = settings.tileSize * 0.15;
      }
      mesh.position.copy(worldPos);
      obstacleGroup.add(mesh);
    }
  }
}

function generateObstacles(): void {
  const startX = Math.floor(settings.columns / 2);
  const startY = Math.floor(settings.rows / 2);
  const isNearStart = (cell: Cell): boolean => {
    const dx = Math.abs(cell.x - startX);
    const dy = Math.abs(cell.y - startY);
    return dx + dy <= 3;
  };

  obstacleMap = createObstacleGrid();
  const wallLineY = Math.floor(settings.rows * 0.35);
  for (let x = 2; x < settings.columns - 2; x += 1) {
    const cell: Cell = { x, y: wallLineY };
    if (!isNearStart(cell)) {
      setObstacle(cell, "wall");
    }
  }

  for (let y = 2; y < settings.rows - 4; y += 1) {
    const cell: Cell = { x: 4, y };
    if (!isNearStart(cell)) {
      setObstacle(cell, "bush");
    }
  }

  for (let y = Math.floor(settings.rows * 0.55); y < settings.rows - 2; y += 1) {
    for (let x = Math.floor(settings.columns * 0.55); x < settings.columns - 2; x += 1) {
      const cell: Cell = { x, y };
      if (!isNearStart(cell) && (x + y) % 2 === 0) {
        setObstacle(cell, "water");
      }
    }
  }

  let rocksPlaced = 0;
  while (rocksPlaced < 10) {
    const cell: Cell = {
      x: Math.floor(Math.random() * settings.columns),
      y: Math.floor(Math.random() * settings.rows),
    };
    if (isNearStart(cell) || getObstacleAt(cell)) {
      continue;
    }
    setObstacle(cell, "rock");
    rocksPlaced += 1;
  }

  rebuildObstacleMeshes();
}

function pickupAtCell(cell: Cell): PickupEntity | undefined {
  return pickupEntities.find(
    (entity) =>
      entity.pickup.cell.x === cell.x && entity.pickup.cell.y === cell.y,
  );
}

function isCellAvailable(cell: Cell): boolean {
  if (isOutOfBounds(cell)) {
    return false;
  }
  if (isOnSnake(cell)) {
    return false;
  }
  if (getObstacleAt(cell)) {
    return false;
  }
  if (pickupAtCell(cell)) {
    return false;
  }
  return true;
}

function findFreeCells(): Cell[] {
  const freeCells: Cell[] = [];
  for (let y = 0; y < settings.rows; y += 1) {
    for (let x = 0; x < settings.columns; x += 1) {
      const candidate = { x, y };
      if (isCellAvailable(candidate)) {
        freeCells.push(candidate);
      }
    }
  }
  return freeCells;
}

function spawnPickup(type: PickupType): Pickup | null {
  const freeCells = findFreeCells();
  if (freeCells.length === 0) {
    return null;
  }
  const pick = Math.floor(Math.random() * freeCells.length);
  const cell = freeCells[pick] ?? freeCells[0];
  const pickup: Pickup = { type, cell, spawnedAt: performance.now() };
  const mesh = new THREE.Mesh(
    pickupGeometries[type],
    pickupMaterials[type],
  );
  mesh.castShadow = false;
  mesh.position.copy(gridToWorld(cell));
  pickupEntities.push({ pickup, mesh });
  pickupGroup.add(mesh);
  return pickup;
}

function clearPickups(): void {
  pickupEntities.forEach((entity) => {
    pickupGroup.remove(entity.mesh);
  });
  pickupEntities = [];
}

function ensurePickupPresence(): void {
  const hasApple = pickupEntities.some((entity) => entity.pickup.type === "apple");
  if (!hasApple) {
    spawnPickup("apple");
  }
  if (
    collectedArtifacts < settings.requiredArtifacts &&
    !pickupEntities.some((entity) => entity.pickup.type === "artifact")
  ) {
    spawnPickup("artifact");
  }
  const bonusTypes: PickupType[] = ["extraLife", "slowTime"];
  const bonusCount = pickupEntities.filter((entity) =>
    bonusTypes.includes(entity.pickup.type),
  ).length;
  if (bonusCount < 2) {
    const type = bonusTypes[Math.floor(Math.random() * bonusTypes.length)];
    spawnPickup(type);
  }
}

function removePickup(entity: PickupEntity): void {
  pickupGroup.remove(entity.mesh);
  pickupEntities = pickupEntities.filter((item) => item !== entity);
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
    mesh.userData.baseY = worldPos.y;
  });
}

function resetRound(options?: { preserveProgress?: boolean }): void {
  const preserveProgress = options?.preserveProgress ?? false;
  destroyPhysicsWorld();
  queuedManeuver = null;
  activeManeuver = null;
  deathInfo = null;
  explosionOrigin = null;
  direction = { x: 1, y: 0 };
  nextDirection = { x: 1, y: 0 };
  const startX = Math.floor(settings.columns / 2);
  const startY = Math.floor(settings.rows / 2);
  snake = [
    { x: startX, y: startY },
    { x: startX - 1, y: startY },
    { x: startX - 2, y: startY },
  ];
  if (!preserveProgress) {
    collectedArtifacts = 0;
    slowdownRemainingMs = 0;
    lives = settings.baseLives;
  }
  generateObstacles();
  clearPickups();
  ensurePickupPresence();
  tickAccumulatorMs = 0;
  updateSnakeMeshesFromGrid();
  updateScoreDisplay();
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
  lives = settings.baseLives;
  collectedArtifacts = 0;
  slowdownRemainingMs = 0;
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

function queueManeuver(type: ManeuverType): void {
  if (gameState !== "playing") {
    return;
  }
  if (queuedManeuver) {
    return;
  }
  queuedManeuver = type;
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

  if (event.key === "j" || event.key === "J") {
    event.preventDefault();
    queueManeuver("jump");
    return;
  }

  if (event.key === "k" || event.key === "K") {
    event.preventDefault();
    queueManeuver("burrow");
    return;
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

function getDistanceForManeuver(maneuver: ManeuverType | null): number {
  if (maneuver === "jump") {
    return settings.jumpDistance;
  }
  if (maneuver === "burrow") {
    return settings.burrowDistance;
  }
  return 1;
}

function consumeQueuedManeuver(): ManeuverType | null {
  const next = queuedManeuver;
  queuedManeuver = null;
  return next;
}

function startManeuverAnimation(
  maneuver: ManeuverType,
  distance: number,
): void {
  activeManeuver = {
    type: maneuver,
    startedAt: performance.now(),
    durationMs:
      maneuver === "jump"
        ? settings.jumpWaveDurationMs
        : settings.burrowWaveDurationMs,
    distance,
  };
}

function applyPickup(entity: PickupEntity): boolean {
  const { type } = entity.pickup;
  const meta = pickupMeta[type];
  score += meta.score;
  if (type === "extraLife") {
    lives += 1;
  }
  if (type === "slowTime") {
    slowdownRemainingMs = Math.max(
      slowdownRemainingMs,
      settings.slowTimeDurationMs,
    );
  }
  if (type === "artifact") {
    collectedArtifacts = Math.min(
      settings.requiredArtifacts,
      collectedArtifacts + 1,
    );
  }
  removePickup(entity);
  if (
    meta.respawn &&
    (type !== "artifact" || collectedArtifacts < settings.requiredArtifacts)
  ) {
    spawnPickup(type);
  }
  ensurePickupPresence();
  updateScoreDisplay();
  return meta.grow;
}

function handleDeath(info: DeathInfo): void {
  if (lives > 1) {
    lives -= 1;
    resetRound({ preserveProgress: true });
    updateScoreDisplay();
    return;
  }
  deathInfo = info;
  explosionOrigin = gridToWorld(info.cell);
  triggerDeath();
}

function stepGame(): void {
  if (gameState !== "playing") {
    return;
  }
  direction = nextDirection;
  const head = snake[0];
  if (!head) {
    return;
  }

  const maneuver = consumeQueuedManeuver();
  const distance = getDistanceForManeuver(maneuver);
  let target: Cell | null = null;

  for (let step = 1; step <= distance; step += 1) {
    const candidate: Cell = {
      x: head.x + direction.x * step,
      y: head.y + direction.y * step,
    };
    const lastStep = step === distance;
    if (isOutOfBounds(candidate)) {
      handleDeath({ reason: "out-of-bounds", cell: candidate });
      return;
    }
    const obstacle = getObstacleAt(candidate);
    if (obstacle) {
      const rule = obstacleRules[obstacle];
      if (!maneuver) {
        handleDeath({ reason: "obstacle", cell: candidate, obstacle });
        return;
      }
      if (maneuver === "jump" && (!rule.jumpable || lastStep)) {
        handleDeath({ reason: "obstacle", cell: candidate, obstacle });
        return;
      }
      if (maneuver === "burrow" && (!rule.burrowable || lastStep)) {
        handleDeath({ reason: "obstacle", cell: candidate, obstacle });
        return;
      }
    }
    if (lastStep) {
      target = candidate;
    }
  }

  if (!target) {
    handleDeath({ reason: "out-of-bounds", cell: head });
    return;
  }

  if (isOnSnake(target)) {
    handleDeath({ reason: "self", cell: target });
    return;
  }

  const pickupEntity = pickupAtCell(target);
  const grows = pickupEntity ? applyPickup(pickupEntity) : false;

  snake = [target, ...snake];
  if (!grows) {
    snake.pop();
  }

  if (maneuver) {
    startManeuverAnimation(maneuver, distance);
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
  const originVector =
    explosionOrigin ??
    gridToWorld(snake[0] ?? { x: settings.columns / 2, y: settings.rows / 2 });
  const cannonOrigin = new Vec3(originVector.x, originVector.y, originVector.z);
  const obstacleBoost =
    deathInfo?.reason === "obstacle" && deathInfo.obstacle === "rock"
      ? 1.25
      : deathInfo?.reason === "obstacle" && deathInfo.obstacle === "water"
        ? 0.85
        : 1;
  const reasonBoost = deathInfo?.reason === "self" ? 0.95 : 1;
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

    const impulseStrength = (5 + Math.random() * 2) * obstacleBoost * reasonBoost;
    const impulseDirection = new Vec3(
      body.position.x - cannonOrigin.x,
      0.6,
      body.position.z - cannonOrigin.z,
    );
    if (impulseDirection.lengthSquared() === 0) {
      impulseDirection.set(Math.random() - 0.5, 0.6, Math.random() - 0.5);
    }
    impulseDirection.normalize();
    impulseDirection.scale(impulseStrength, impulseDirection);
    body.applyImpulse(impulseDirection, body.position);
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

function applyManeuverOffsets(now: number): void {
  if (gameState === "exploding") {
    return;
  }
  if (!activeManeuver) {
    snakeMeshes.forEach((mesh) => {
      if (typeof mesh.userData.baseY === "number") {
        mesh.position.y = mesh.userData.baseY;
      }
    });
    return;
  }

  const elapsed = now - activeManeuver.startedAt;
  const progress = Math.min(1, elapsed / activeManeuver.durationMs);
  const amplitude =
    activeManeuver.type === "jump"
      ? settings.tileSize * 0.45
      : -settings.tileSize * 0.35;

  snakeMeshes.forEach((mesh, index) => {
    const baseY =
      typeof mesh.userData.baseY === "number"
        ? mesh.userData.baseY
        : mesh.position.y;
    const delayedProgress = Math.min(1, progress + index * 0.05);
    const wave = Math.sin(delayedProgress * Math.PI);
    const attenuation = Math.max(0.2, 1 - index * 0.05);
    const offset = wave * amplitude * attenuation;
    mesh.position.y = baseY + offset;
  });

  if (progress >= 1) {
    activeManeuver = null;
  }
}

function getCurrentTickMs(): number {
  const multiplier = slowdownRemainingMs > 0 ? settings.slowTimeMultiplier : 1;
  return settings.tickMs * multiplier;
}

function animate(now: number): void {
  const deltaMs = now - lastFrame;
  lastFrame = now;

  const previousSlowdown = slowdownRemainingMs;
  slowdownRemainingMs = Math.max(0, slowdownRemainingMs - deltaMs);

  if (gameState === "playing") {
    tickAccumulatorMs += deltaMs;
    while (true) {
      const tickLength = getCurrentTickMs();
      if (tickAccumulatorMs < tickLength) {
        break;
      }
      tickAccumulatorMs -= tickLength;
      stepGame();
    }
  } else {
    tickAccumulatorMs = 0;
  }

  stepPhysics(deltaMs / 1000);
  if (!physicsWorld) {
    applyManeuverOffsets(now);
  }

  if (slowdownRemainingMs > 0 || (previousSlowdown > 0 && slowdownRemainingMs === 0)) {
    updateScoreDisplay();
  }

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
