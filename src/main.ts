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
type GameState =
  | "idle"
  | "playing"
  | "paused"
  | "exploding"
  | "levelComplete"
  | "campaignComplete";
type ObstacleType = "wall" | "bush" | "water" | "rock";
type Obstacle = { cell: Cell; type: ObstacleType };
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
type ResourceType = "artifact" | "extraLife" | "timeSlow";
type LevelResource = {
  id: string;
  type: ResourceType;
  cell: Cell;
  mandatory?: boolean;
};
type ActiveResource = LevelResource & { collected: boolean };
type LevelDefinition = {
  id: string;
  name: string;
  columns: number;
  rows: number;
  appleGoal: number;
  tickMs?: number;
  obstacles: Obstacle[];
  resources: LevelResource[];
};

function verticalLine(
  type: ObstacleType,
  x: number,
  from: number,
  to: number,
): Obstacle[] {
  const result: Obstacle[] = [];
  for (let y = from; y <= to; y += 1) {
    result.push({ cell: { x, y }, type });
  }
  return result;
}

function horizontalLine(
  type: ObstacleType,
  y: number,
  from: number,
  to: number,
): Obstacle[] {
  const result: Obstacle[] = [];
  for (let x = from; x <= to; x += 1) {
    result.push({ cell: { x, y }, type });
  }
  return result;
}

const baseTickMs = 160;
const baseLives = 3;
const slowEffectDurationMs = 5500;
const slowEffectMultiplier = 1.8;

const settings = {
  columns: 16,
  rows: 16,
  tileSize: 1,
  tickMs: baseTickMs,
  jumpDistance: 3, // перескакиваем две клетки и приземляемся на третью
  burrowDistance: 3,
  jumpWaveDurationMs: 420,
  burrowWaveDurationMs: 420,
  slowTimeDurationMs: slowEffectDurationMs,
  slowTimeMultiplier: slowEffectMultiplier,
  requiredArtifacts: 3,
  baseLives,
};

const obstacleColors: Record<ObstacleType, string> = {
  wall: "#475569",
  bush: "#16a34a",
  water: "#0ea5e9",
  rock: "#cbd5e1",
};

const resourceColors: Record<ResourceType, string> = {
  artifact: "#facc15",
  extraLife: "#a855f7",
  timeSlow: "#38bdf8",
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

const levels: LevelDefinition[] = [
  {
    id: "courtyard",
    name: "Дворик",
    columns: 12,
    rows: 12,
    appleGoal: 4,
    obstacles: [
      ...horizontalLine("bush", 9, 2, 4),
      { cell: { x: 5, y: 2 }, type: "wall" },
      { cell: { x: 6, y: 2 }, type: "wall" },
      { cell: { x: 8, y: 8 }, type: "rock" },
    ],
    resources: [
      {
        id: "l1-artifact-1",
        type: "artifact",
        cell: { x: 9, y: 9 },
        mandatory: true,
      },
      { id: "l1-slow-1", type: "timeSlow", cell: { x: 2, y: 2 } },
    ],
  },
  {
    id: "crossroad",
    name: "Перекрёсток",
    columns: 14,
    rows: 14,
    appleGoal: 5,
    obstacles: [
      ...verticalLine("wall", 7, 3, 10),
      { cell: { x: 3, y: 7 }, type: "rock" },
      { cell: { x: 10, y: 7 }, type: "bush" },
      { cell: { x: 1, y: 5 }, type: "water" },
    ],
    resources: [
      { id: "l2-life-1", type: "extraLife", cell: { x: 11, y: 2 } },
      {
        id: "l2-artifact-1",
        type: "artifact",
        cell: { x: 1, y: 12 },
        mandatory: true,
      },
      { id: "l2-slow-1", type: "timeSlow", cell: { x: 12, y: 11 } },
    ],
  },
  {
    id: "terraces",
    name: "Террасы",
    columns: 16,
    rows: 14,
    appleGoal: 6,
    obstacles: [
      ...horizontalLine("wall", 5, 4, 7),
      ...verticalLine("bush", 11, 7, 10),
      { cell: { x: 2, y: 11 }, type: "water" },
      { cell: { x: 13, y: 3 }, type: "rock" },
    ],
    resources: [
      {
        id: "l3-artifact-1",
        type: "artifact",
        cell: { x: 14, y: 12 },
        mandatory: true,
      },
      {
        id: "l3-artifact-2",
        type: "artifact",
        cell: { x: 1, y: 1 },
        mandatory: true,
      },
      { id: "l3-life-1", type: "extraLife", cell: { x: 8, y: 1 } },
    ],
  },
  {
    id: "canals",
    name: "Каналы",
    columns: 16,
    rows: 18,
    appleGoal: 7,
    obstacles: [
      ...horizontalLine("water", 6, 3, 12),
      ...horizontalLine("water", 12, 2, 13),
      ...verticalLine("wall", 8, 4, 14),
      { cell: { x: 4, y: 9 }, type: "rock" },
      { cell: { x: 11, y: 14 }, type: "bush" },
    ],
    resources: [
      { id: "l4-life-1", type: "extraLife", cell: { x: 2, y: 2 } },
      {
        id: "l4-artifact-1",
        type: "artifact",
        cell: { x: 14, y: 16 },
        mandatory: true,
      },
      { id: "l4-slow-1", type: "timeSlow", cell: { x: 7, y: 8 } },
    ],
  },
  {
    id: "garden",
    name: "Сад",
    columns: 18,
    rows: 18,
    appleGoal: 8,
    obstacles: [
      ...horizontalLine("wall", 4, 3, 14),
      ...horizontalLine("wall", 13, 3, 14),
      ...verticalLine("wall", 3, 5, 12),
      ...verticalLine("wall", 14, 5, 12),
      { cell: { x: 9, y: 9 }, type: "water" },
      { cell: { x: 6, y: 6 }, type: "bush" },
    ],
    resources: [
      {
        id: "l5-artifact-1",
        type: "artifact",
        cell: { x: 9, y: 2 },
        mandatory: true,
      },
      {
        id: "l5-artifact-2",
        type: "artifact",
        cell: { x: 16, y: 15 },
        mandatory: true,
      },
      { id: "l5-life-1", type: "extraLife", cell: { x: 1, y: 8 } },
      { id: "l5-slow-1", type: "timeSlow", cell: { x: 6, y: 12 } },
    ],
  },
  {
    id: "canyon",
    name: "Каньон",
    columns: 20,
    rows: 14,
    appleGoal: 8,
    obstacles: [
      ...verticalLine("rock", 9, 2, 11),
      ...horizontalLine("bush", 6, 2, 8),
      ...horizontalLine("bush", 7, 11, 17),
      { cell: { x: 15, y: 3 }, type: "water" },
      { cell: { x: 4, y: 10 }, type: "wall" },
    ],
    resources: [
      {
        id: "l6-artifact-1",
        type: "artifact",
        cell: { x: 18, y: 12 },
        mandatory: true,
      },
      { id: "l6-life-1", type: "extraLife", cell: { x: 2, y: 1 } },
      { id: "l6-slow-1", type: "timeSlow", cell: { x: 12, y: 5 } },
    ],
  },
  {
    id: "plateau",
    name: "Плато",
    columns: 22,
    rows: 22,
    appleGoal: 9,
    obstacles: [
      ...horizontalLine("wall", 5, 4, 17),
      ...horizontalLine("wall", 16, 4, 17),
      ...verticalLine("wall", 4, 6, 15),
      ...verticalLine("wall", 17, 6, 15),
      { cell: { x: 10, y: 10 }, type: "rock" },
      { cell: { x: 11, y: 11 }, type: "rock" },
      { cell: { x: 5, y: 18 }, type: "water" },
    ],
    resources: [
      {
        id: "l7-artifact-1",
        type: "artifact",
        cell: { x: 3, y: 3 },
        mandatory: true,
      },
      {
        id: "l7-artifact-2",
        type: "artifact",
        cell: { x: 18, y: 18 },
        mandatory: true,
      },
      { id: "l7-life-1", type: "extraLife", cell: { x: 8, y: 4 } },
      { id: "l7-slow-1", type: "timeSlow", cell: { x: 14, y: 14 } },
    ],
  },
  {
    id: "steps",
    name: "Ступени",
    columns: 24,
    rows: 18,
    appleGoal: 9,
    obstacles: [
      ...horizontalLine("bush", 4, 4, 19),
      ...horizontalLine("bush", 9, 2, 15),
      ...horizontalLine("bush", 13, 6, 21),
      { cell: { x: 17, y: 5 }, type: "wall" },
      { cell: { x: 4, y: 15 }, type: "rock" },
    ],
    resources: [
      {
        id: "l8-artifact-1",
        type: "artifact",
        cell: { x: 21, y: 15 },
        mandatory: true,
      },
      {
        id: "l8-artifact-2",
        type: "artifact",
        cell: { x: 2, y: 2 },
        mandatory: true,
      },
      { id: "l8-life-1", type: "extraLife", cell: { x: 10, y: 7 } },
      { id: "l8-slow-1", type: "timeSlow", cell: { x: 6, y: 13 } },
    ],
  },
  {
    id: "valley",
    name: "Долина",
    columns: 28,
    rows: 20,
    appleGoal: 10,
    obstacles: [
      ...horizontalLine("water", 6, 4, 23),
      ...horizontalLine("water", 13, 4, 23),
      ...verticalLine("rock", 4, 4, 15),
      ...verticalLine("rock", 23, 4, 15),
      { cell: { x: 14, y: 9 }, type: "bush" },
      { cell: { x: 7, y: 2 }, type: "wall" },
    ],
    resources: [
      {
        id: "l9-artifact-1",
        type: "artifact",
        cell: { x: 25, y: 17 },
        mandatory: true,
      },
      {
        id: "l9-artifact-2",
        type: "artifact",
        cell: { x: 2, y: 17 },
        mandatory: true,
      },
      { id: "l9-life-1", type: "extraLife", cell: { x: 14, y: 2 } },
      { id: "l9-slow-1", type: "timeSlow", cell: { x: 9, y: 9 } },
    ],
  },
  {
    id: "capital",
    name: "Столица",
    columns: 30,
    rows: 24,
    appleGoal: 12,
    obstacles: [
      ...horizontalLine("wall", 4, 5, 24),
      ...horizontalLine("wall", 19, 5, 24),
      ...verticalLine("wall", 5, 4, 19),
      ...verticalLine("wall", 24, 4, 19),
      ...horizontalLine("water", 11, 8, 21),
      ...verticalLine("rock", 15, 6, 17),
      { cell: { x: 10, y: 8 }, type: "bush" },
      { cell: { x: 20, y: 15 }, type: "bush" },
    ],
    resources: [
      {
        id: "l10-artifact-1",
        type: "artifact",
        cell: { x: 27, y: 21 },
        mandatory: true,
      },
      {
        id: "l10-artifact-2",
        type: "artifact",
        cell: { x: 2, y: 2 },
        mandatory: true,
      },
      {
        id: "l10-artifact-3",
        type: "artifact",
        cell: { x: 14, y: 4 },
        mandatory: true,
      },
      { id: "l10-life-1", type: "extraLife", cell: { x: 7, y: 18 } },
      { id: "l10-life-2", type: "extraLife", cell: { x: 22, y: 6 } },
      { id: "l10-slow-1", type: "timeSlow", cell: { x: 12, y: 16 } },
    ],
  },
];

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
const levelValue = (() => {
  const element = document.getElementById("level-value");
  if (!(element instanceof HTMLElement)) {
    throw new Error("Не найден счётчик уровня");
  }
  return element;
})();
const goalValue = (() => {
  const element = document.getElementById("goal-value");
  if (!(element instanceof HTMLElement)) {
    throw new Error("Не найдено описание цели");
  }
  return element;
})();
const livesValue = (() => {
  const element = document.getElementById("lives-value");
  if (!(element instanceof HTMLElement)) {
    throw new Error("Не найдено поле жизней");
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

let menuActionHandler: (() => void) | null = null;

const stateLabelByState: Record<GameState, string> = {
  idle: "Ожидание",
  playing: "Игра",
  paused: "Пауза",
  exploding: "Поражение",
  levelComplete: "Уровень пройден",
  campaignComplete: "Все уровни",
};

const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(colors.background);

let boardWidth = settings.columns * settings.tileSize;
let boardDepth = settings.rows * settings.tileSize;
const camera = new THREE.PerspectiveCamera(
  55,
  canvas.clientWidth / canvas.clientHeight,
  0.1,
  400,
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

let gridHelper = new THREE.GridHelper(
  boardWidth,
  settings.columns,
  colors.grid,
  colors.grid,
);
gridHelper.position.y = 0.001;
scene.add(gridHelper);

const obstaclesGroup = new THREE.Group();
scene.add(obstaclesGroup);

const resourcesGroup = new THREE.Group();
scene.add(resourcesGroup);
const resourceMeshes = new Map<string, THREE.Mesh>();

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
const appleMesh = new THREE.Mesh(
  pickupGeometries.apple,
  pickupMaterials.apple,
);
appleMesh.castShadow = false;
pickupGroup.add(appleMesh);

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
let lives = baseLives;
let currentLevelIndex = 0;
let activeLevel: LevelDefinition = levels[0]!;
let activeResources: ActiveResource[] = [];
let levelProgress = {
  applesCollected: 0,
  mandatoryCollected: 0,
  mandatoryTotal: activeLevel.resources.filter((res) => res.mandatory).length,
};
let apple: Cell = { x: 0, y: 0 };
type PickupEntity = { pickup: Pickup; mesh: THREE.Mesh };
let pickupEntities: PickupEntity[] = [];
let queuedManeuver: ManeuverType | null = null;
let activeManeuver: ManeuverState | null = null;
let slowEffectRemainingMs = 0;
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
  const canPause = next === "playing" || paused;
  pauseButton.disabled = !canPause;
  pauseButton.textContent = paused ? "Продолжить" : "Пауза";
  pauseButton.setAttribute("aria-pressed", paused ? "true" : "false");
}

function updateScoreDisplay(): void {
  const slowText =
    slowEffectRemainingMs > 0
      ? ` | замедл: ${(slowEffectRemainingMs / 1000).toFixed(1)}с`
      : "";
  scoreValue.textContent = `${score} | жизни: ${lives}${slowText}`;
}

function updateLevelDisplay(): void {
  levelValue.textContent = `${currentLevelIndex + 1} / ${levels.length} · ${
    activeLevel.name
  }`;
}

function updateGoalDisplay(): void {
  const goalParts = [
    `Яблоки ${levelProgress.applesCollected}/${activeLevel.appleGoal}`,
  ];
  if (levelProgress.mandatoryTotal > 0) {
    goalParts.push(
      `Артефакты ${levelProgress.mandatoryCollected}/${levelProgress.mandatoryTotal}`,
    );
  }
  goalValue.textContent = goalParts.join(" · ");
}

function updateLivesDisplay(): void {
  livesValue.textContent = lives.toString();
}

function updateHud(): void {
  updateScoreDisplay();
  updateLevelDisplay();
  updateGoalDisplay();
  updateLivesDisplay();
}

function bindMenuAction(action: () => void): void {
  menuActionHandler = action;
}

function showMenu(config: {
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction: () => void;
}): void {
  menuTitle.textContent = config.title;
  menuSubtitle.textContent = config.subtitle;
  menuAction.textContent = config.actionLabel;
  bindMenuAction(config.onAction);
  menu.classList.remove("hidden");
}

function hideMenu(): void {
  menu.classList.add("hidden");
  menuActionHandler = null;
}

function showStartMenu(): void {
  showMenu({
    title: "Змейка: Кампания",
    subtitle: "Соберите яблоки и артефакты, пройдя 10 уровней.",
    actionLabel: "Начать игру",
    onAction: startNewGame,
  });
}

function showGameOverMenu(): void {
  showMenu({
    title: "Поражение",
    subtitle: "Жизней не осталось. Сброс прогресса кампании.",
    actionLabel: "Начать заново",
    onAction: startNewGame,
  });
}

function showLifeLostMenu(): void {
  showMenu({
    title: "Жизнь потеряна",
    subtitle: `Осталось жизней: ${lives}. Уровень будет перезапущен.`,
    actionLabel: "Продолжить уровень",
    onAction: () => {
      restartCurrentLevel();
    },
  });
}

function showLevelCompleteMenu(): void {
  const nextLevel = levels[currentLevelIndex + 1];
  if (!nextLevel) {
    showCampaignCompleteMenu();
    return;
  }
  showMenu({
    title: `Уровень ${currentLevelIndex + 1} пройден`,
    subtitle: `Далее: ${nextLevel.name}. Осталось уровней: ${
      levels.length - currentLevelIndex - 1
    }`,
    actionLabel: "Следующий уровень",
    onAction: () => startLevel(currentLevelIndex + 1),
  });
}

function showCampaignCompleteMenu(): void {
  showMenu({
    title: "Кампания пройдена",
    subtitle: "Все артефакты собраны. Можно начать новый забег.",
    actionLabel: "Играть снова",
    onAction: startNewGame,
  });
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

function recalcBoardDimensions(): void {
  boardWidth = settings.columns * settings.tileSize;
  boardDepth = settings.rows * settings.tileSize;
}

function updateFloorGeometry(): void {
  floorMesh.geometry.dispose();
  floorMesh.geometry = new THREE.BoxGeometry(
    boardWidth + 1,
    0.4,
    boardDepth + 1,
  );
  floorMesh.position.set(0, -0.2, 0);
}

function rebuildGridHelper(): void {
  scene.remove(gridHelper);
  gridHelper.geometry.dispose();
  gridHelper = new THREE.GridHelper(
    boardWidth,
    settings.columns,
    colors.grid,
    colors.grid,
  );
  gridHelper.position.y = 0.001;
  scene.add(gridHelper);
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

function getObstacleAt(cell: Cell): ObstacleType | null {
  if (isOutOfBounds(cell)) {
    return null;
  }
  return (
    activeLevel.obstacles.find(
      (obstacle) => obstacle.cell.x === cell.x && obstacle.cell.y === cell.y,
    )?.type ?? null
  );
}

function isObstacleCell(cell: Cell): boolean {
  return getObstacleAt(cell) !== null;
}

function getActiveResourceAtCell(cell: Cell): ActiveResource | undefined {
  return activeResources.find(
    (resource) =>
      !resource.collected &&
      resource.cell.x === cell.x &&
      resource.cell.y === cell.y,
  );
}

function isCellFreeForSpawn(cell: Cell): boolean {
  if (isOutOfBounds(cell)) {
    return false;
  }
  return !isOnSnake(cell) && !isObstacleCell(cell) && !getActiveResourceAtCell(cell);
}

function findFreeCells(): Cell[] {
  const freeCells: Cell[] = [];
  for (let y = 0; y < settings.rows; y += 1) {
    for (let x = 0; x < settings.columns; x += 1) {
      const candidate = { x, y };
      if (isCellFreeForSpawn(candidate)) {
        freeCells.push(candidate);
      }
    }
  }
  return freeCells;
}

function spawnApple(): Cell {
  const freeCells: Cell[] = [];
  for (let y = 0; y < settings.rows; y += 1) {
    for (let x = 0; x < settings.columns; x += 1) {
      const candidate = { x, y };
      if (isCellFreeForSpawn(candidate)) {
        freeCells.push(candidate);
      }
    }
  }
  if (freeCells.length === 0) {
    return { x: Math.floor(settings.columns / 2), y: Math.floor(settings.rows / 2) };
  }
  const pick = Math.floor(Math.random() * freeCells.length);
  return freeCells[pick] ?? freeCells[0];
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
}

function removePickup(entity: PickupEntity): void {
  pickupGroup.remove(entity.mesh);
  pickupEntities = pickupEntities.filter((item) => item !== entity);
}

function rebuildObstacleMeshes(): void {
  obstaclesGroup.clear();
  activeLevel.obstacles.forEach((obstacle) => {
    const geometry = new THREE.BoxGeometry(
      settings.tileSize * 0.95,
      settings.tileSize,
      settings.tileSize * 0.95,
    );
    const material = new THREE.MeshStandardMaterial({
      color: obstacleColors[obstacle.type],
      roughness: 0.85,
      metalness: 0.1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const worldPos = gridToWorld(obstacle.cell);
    mesh.position.copy(worldPos);
    obstaclesGroup.add(mesh);
  });
}

function createResourceGeometry(type: ResourceType): THREE.BufferGeometry {
  if (type === "artifact") {
    return new THREE.OctahedronGeometry(settings.tileSize * 0.36);
  }
  if (type === "extraLife") {
    return new THREE.TorusGeometry(
      settings.tileSize * 0.32,
      settings.tileSize * 0.09,
      12,
      32,
    );
  }
  return new THREE.DodecahedronGeometry(settings.tileSize * 0.33);
}

function rebuildResourceMeshes(): void {
  resourceMeshes.forEach((mesh) => {
    resourcesGroup.remove(mesh);
  });
  resourceMeshes.clear();

  activeResources.forEach((resource) => {
    if (resource.collected) {
      return;
    }
    const geometry = createResourceGeometry(resource.type);
    const material = new THREE.MeshStandardMaterial({
      color: resourceColors[resource.type],
      emissive: new THREE.Color(resourceColors[resource.type]).multiplyScalar(0.18),
      metalness: 0.2,
      roughness: 0.35,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.position.copy(gridToWorld(resource.cell));
    resourcesGroup.add(mesh);
    resourceMeshes.set(resource.id, mesh);
  });
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

function updateAppleMesh(): void {
  const worldPos = gridToWorld(apple);
  appleMesh.position.copy(worldPos);
}

function buildStartingSnake(): Cell[] {
  const headOptions: Cell[] = [
    { x: Math.floor(settings.columns / 2), y: Math.floor(settings.rows / 2) },
    { x: Math.floor(settings.columns / 2), y: Math.floor(settings.rows / 2) - 1 },
    { x: Math.floor(settings.columns / 2) - 1, y: Math.floor(settings.rows / 2) },
  ];
  const directionsToTry: Cell[] = [
    { x: -1, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
    { x: 0, y: 1 },
  ];

  for (const head of headOptions) {
    for (const dir of directionsToTry) {
      const body = { x: head.x + dir.x, y: head.y + dir.y };
      const tail = { x: body.x + dir.x, y: body.y + dir.y };
      if (
        isOutOfBounds(head) ||
        isOutOfBounds(body) ||
        isOutOfBounds(tail) ||
        !isCellFreeForSpawn(head) ||
        !isCellFreeForSpawn(body) ||
        !isCellFreeForSpawn(tail)
      ) {
        continue;
      }
      return [head, body, tail];
    }
  }

  return [
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: 0, y: 0 },
  ];
}

function resetLevel(): void {
  destroyPhysicsWorld();
  queuedManeuver = null;
  activeManeuver = null;
  deathInfo = null;
  explosionOrigin = null;
  direction = { x: 1, y: 0 };
  nextDirection = { x: 1, y: 0 };
  snake = [];
  tickAccumulatorMs = 0;
  slowEffectRemainingMs = 0;

  activeResources = activeLevel.resources.map((resource) => ({
    ...resource,
    collected: false,
  }));
  levelProgress = {
    applesCollected: 0,
    mandatoryCollected: 0,
    mandatoryTotal: activeResources.filter((res) => res.mandatory).length,
  };

  rebuildObstacleMeshes();
  rebuildResourceMeshes();

  snake = buildStartingSnake();
  apple = spawnApple();
  updateSnakeMeshesFromGrid();
  updateAppleMesh();
  updateHud();
}

function applyLevelConfig(level: LevelDefinition): void {
  settings.columns = level.columns;
  settings.rows = level.rows;
  settings.tickMs = level.tickMs ?? baseTickMs;
  recalcBoardDimensions();
  updateFloorGeometry();
  rebuildGridHelper();
  slowEffectRemainingMs = 0;
}

function startLevel(levelIndex: number): void {
  const nextLevel = levels[levelIndex];
  if (!nextLevel) {
    return;
  }
  currentLevelIndex = levelIndex;
  activeLevel = nextLevel;
  applyLevelConfig(activeLevel);
  resetLevel();
  hideMenu();
  setGameState("playing");
}

function restartCurrentLevel(): void {
  applyLevelConfig(activeLevel);
  resetLevel();
  hideMenu();
  setGameState("playing");
}

function startNewGame(): void {
  cancelExplosionTimeout();
  score = 0;
  lives = baseLives;
  currentLevelIndex = 0;
  activeLevel = levels[0]!;
  startLevel(0);
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

function handleResourcePickup(resource: ActiveResource): void {
  resource.collected = true;
  const mesh = resourceMeshes.get(resource.id);
  if (mesh) {
    resourcesGroup.remove(mesh);
    resourceMeshes.delete(resource.id);
  }

  if (resource.type === "artifact") {
    levelProgress.mandatoryCollected += 1;
    score += 2;
  } else if (resource.type === "extraLife") {
    lives += 1;
  } else if (resource.type === "timeSlow") {
    slowEffectRemainingMs = slowEffectDurationMs;
  }
  updateScoreDisplay();
  updateLivesDisplay();
  updateGoalDisplay();
}

function checkVictory(): void {
  if (
    levelProgress.applesCollected >= activeLevel.appleGoal &&
    levelProgress.mandatoryCollected >= levelProgress.mandatoryTotal
  ) {
    tickAccumulatorMs = 0;
    slowEffectRemainingMs = 0;
    if (currentLevelIndex >= levels.length - 1) {
      setGameState("campaignComplete");
      showCampaignCompleteMenu();
    } else {
      setGameState("levelComplete");
      showLevelCompleteMenu();
    }
  }
}

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
    slowEffectRemainingMs = Math.max(
      slowEffectRemainingMs,
      settings.slowTimeDurationMs,
    );
  }
  if (type === "artifact") {
    levelProgress.mandatoryCollected += 1;
    updateGoalDisplay();
  }
  removePickup(entity);
  if (meta.respawn && type !== "apple") {
    spawnPickup(type);
  }
  updateScoreDisplay();
  updateLivesDisplay();
  return meta.grow;
}

function handleDeath(info: DeathInfo): void {
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
  const resourceHit = getActiveResourceAtCell(target);
  const ateApple = target.x === apple.x && target.y === apple.y;
  const pickupGrows = pickupEntity ? applyPickup(pickupEntity) : false;
  const grows = pickupGrows || ateApple || resourceHit?.type === "artifact";

  if (ateApple) {
    score += 1;
    levelProgress.applesCollected += 1;
    apple = spawnApple();
    updateAppleMesh();
    updateGoalDisplay();
  }

  if (resourceHit) {
    handleResourcePickup(resourceHit);
  }

  snake = [target, ...snake];
  if (!grows) {
    snake.pop();
  }

  if (maneuver) {
    startManeuverAnimation(maneuver, distance);
  }

  updateSnakeMeshesFromGrid();
  updateScoreDisplay();
  checkVictory();
}

function triggerDeath(): void {
  if (gameState === "exploding") {
    return;
  }
  setGameState("exploding");
  slowEffectRemainingMs = 0;
  cancelExplosionTimeout();
  startExplosionPhysics();
  explosionTimeoutId = window.setTimeout(() => {
    if (gameState === "exploding") {
      finishExplosion();
    }
  }, 2600);
}

function cancelExplosionTimeout(): void {
  if (explosionTimeoutId !== null) {
    window.clearTimeout(explosionTimeoutId);
    explosionTimeoutId = null;
  }
}

function finishExplosion(): void {
  cancelExplosionTimeout();
  destroyPhysicsWorld();
  lives = Math.max(0, lives - 1);
  updateLivesDisplay();
  resetLevel();
  setGameState("idle");

  if (lives > 0) {
    showLifeLostMenu();
  } else {
    showGameOverMenu();
  }
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
  if (slowEffectRemainingMs > 0) {
    return settings.tickMs * slowEffectMultiplier;
  }
  return settings.tickMs;
}

function getHeadPosition(): THREE.Vector3 {
  const headMesh = snakeMeshes[0];
  if (physicsWorld && headMesh) {
    return headMesh.position.clone();
  }
  const head = snake[0];
  return head ? gridToWorld(head) : new THREE.Vector3(0, settings.tileSize * 0.5, 0);
}

function updateCameraFollow(deltaSeconds: number): void {
  const headPos = getHeadPosition();
  const longestSide = Math.max(settings.columns, settings.rows) * settings.tileSize;
  const distance = Math.max(6, longestSide * 0.55);
  const height = Math.max(8, longestSide * 0.75);
  const lateral = Math.max(4, longestSide * 0.35);
  const desiredPosition = new THREE.Vector3(
    headPos.x + lateral,
    headPos.y + height,
    headPos.z + distance,
  );
  const followStrength = THREE.MathUtils.clamp(0.08 + deltaSeconds * 2, 0.08, 0.18);
  camera.position.lerp(desiredPosition, followStrength);
  camera.lookAt(headPos.x, headPos.y, headPos.z);
}

function animate(now: number): void {
  const deltaMs = now - lastFrame;
  lastFrame = now;
  const previousSlowEffect = slowEffectRemainingMs;
  if (slowEffectRemainingMs > 0) {
    slowEffectRemainingMs = Math.max(0, slowEffectRemainingMs - deltaMs);
  }

  const tickMs = getCurrentTickMs();
  if (gameState === "playing") {
    tickAccumulatorMs += deltaMs;
    while (tickAccumulatorMs >= tickMs) {
      tickAccumulatorMs -= tickMs;
      stepGame();
      if (gameState !== "playing") {
        break;
      }
    }
  } else {
    tickAccumulatorMs = 0;
  }

  stepPhysics(deltaMs / 1000);
  if (!physicsWorld) {
    applyManeuverOffsets(now);
  }

  if (
    slowEffectRemainingMs > 0 ||
    (previousSlowEffect > 0 && slowEffectRemainingMs === 0)
  ) {
    updateScoreDisplay();
  }

  resizeRenderer();
  updateCameraFollow(deltaMs / 1000);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
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
    if (gameState === "exploding") {
      event.preventDefault();
      finishExplosion();
      return;
    }
    if (!menu.classList.contains("hidden") && menuActionHandler) {
      event.preventDefault();
      menuActionHandler();
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
  if (menuActionHandler) {
    menuActionHandler();
  }
});

pauseButton.addEventListener("click", () => {
  if (gameState === "playing") {
    setGameState("paused");
  } else if (gameState === "paused") {
    setGameState("playing");
  }
});

applyLevelConfig(activeLevel);
resetLevel();
showStartMenu();
setGameState("idle");
resizeRenderer();
requestAnimationFrame(animate);
