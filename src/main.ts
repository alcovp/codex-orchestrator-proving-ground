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
type OverlayMode =
  | "start"
  | "gameover"
  | "paused"
  | "lifeLost"
  | "levelComplete"
  | "campaignComplete"
  | null;
type UiButtonId = "primary" | "pause" | "jump" | "burrow";
type UiButton = {
  id: UiButtonId;
  rect: { x: number; y: number; w: number; h: number };
  visible: boolean;
};
type Buff = { label: string; remainingMs: number; color: string };
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
  hudAccent: "#7dd3fc",
  hudAccent2: "#c084fc",
  hudPanel: "rgba(12, 18, 26, 0.78)",
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
const hudScene = new THREE.Scene();
const hudCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
const hudCanvas = document.createElement("canvas");
const hudContext = (() => {
  const ctx = hudCanvas.getContext("2d");
  if (!ctx) {
    throw new Error("Не удалось создать контекст HUD");
  }
  return ctx;
})();
const hudTexture = new THREE.CanvasTexture(hudCanvas);
hudTexture.colorSpace = THREE.SRGBColorSpace;
hudTexture.needsUpdate = true;
const hudMaterial = new THREE.MeshBasicMaterial({
  map: hudTexture,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});
const hudMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hudMaterial);
hudMesh.position.set(0.5, 0.5, 0);
hudMesh.renderOrder = 5;
hudScene.add(hudMesh);

let overlayMode: OverlayMode = "start";
let overlayTitle = "Змейка";
let overlaySubtitle = "Свайпайте или нажмите Enter, чтобы начать";
let overlayActionLabel = "Начать";
let menuActionHandler: (() => void) | null = null;

let boardWidth = settings.columns * settings.tileSize;
let boardDepth = settings.rows * settings.tileSize;
const stateLabelByState: Record<GameState, string> = {
  idle: "Ожидание",
  playing: "Игра",
  paused: "Пауза",
  exploding: "Поражение",
  levelComplete: "Уровень пройден",
  campaignComplete: "Все уровни",
};

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, canvas });
renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(colors.background);
const camera = new THREE.PerspectiveCamera(
  55,
  canvas.clientWidth / Math.max(1, canvas.clientHeight),
  0.1,
  400,
);
const cameraTarget = new THREE.Vector3(0, 0, 0);
camera.position.set(boardWidth * 0.45, boardWidth * 0.9, boardDepth * 0.75);
camera.lookAt(cameraTarget);

scene.add(new THREE.AmbientLight(0xffffff, 0.68));
const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
keyLight.position.set(12, 16, 10);
keyLight.castShadow = false;
scene.add(keyLight);

const floorMaterial = new THREE.MeshStandardMaterial({
  color: colors.floor,
  metalness: 0.12,
  roughness: 0.82,
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
if (gridHelper.material instanceof THREE.Material) {
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.45;
}
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
const snakeMaterial = new THREE.MeshStandardMaterial({
  color: colors.snake,
  emissive: new THREE.Color(colors.snake).multiplyScalar(0.08),
  roughness: 0.4,
});
const snakeHeadMaterial = new THREE.MeshStandardMaterial({
  color: colors.snakeHead,
  emissive: new THREE.Color(colors.snakeHead).multiplyScalar(0.16),
  roughness: 0.25,
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
  if (next === "playing") {
    overlayMode = null;
  } else if (next === "paused") {
    overlayMode = "paused";
  } else if (next === "levelComplete") {
    overlayMode = "levelComplete";
  } else if (next === "campaignComplete") {
    overlayMode = "campaignComplete";
  } else if (next === "idle" && overlayMode === null) {
    overlayMode = "start";
  }
  markHudDirty();
}

function updateHud(): void {
  markHudDirty();
}

function bindMenuAction(action: () => void): void {
  menuActionHandler = action;
}

function showMenu(config: {
  mode: OverlayMode;
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction: () => void;
}): void {
  overlayMode = config.mode;
  overlayTitle = config.title;
  overlaySubtitle = config.subtitle;
  overlayActionLabel = config.actionLabel;
  bindMenuAction(config.onAction);
  markHudDirty();
}

function hideMenu(): void {
  overlayMode = null;
  overlayActionLabel = "Продолжить";
  menuActionHandler = null;
  markHudDirty();
}

function showStartMenu(): void {
  showMenu({
    mode: "start",
    title: "Змейка: Кампания",
    subtitle: "Соберите яблоки и артефакты, пройдя 10 уровней.",
    actionLabel: "Начать игру",
    onAction: startNewGame,
  });
}

function showGameOverMenu(): void {
  showMenu({
    mode: "gameover",
    title: "Поражение",
    subtitle: "Жизней не осталось. Сброс прогресса кампании.",
    actionLabel: "Начать заново",
    onAction: startNewGame,
  });
}

function showLifeLostMenu(): void {
  showMenu({
    mode: "lifeLost",
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
    mode: "levelComplete",
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
    mode: "campaignComplete",
    title: "Кампания пройдена",
    subtitle: "Все артефакты собраны. Можно начать новый забег.",
    actionLabel: "Играть снова",
    onAction: startNewGame,
  });
}

let hudButtons: UiButton[] = [];
let hudNeedsRedraw = true;
let hudPixelRatio = 1;
let buffRedrawTimerMs = 0;

let waveMode: "jump" | "burrow" | null = null;
let waveStrength = 0;
let waveTime = 0;
let jumpCooldownMs = 0;
let burrowCooldownMs = 0;

let activeBuffs: Buff[] = [];

const swipeState = {
  pointerId: null as number | null,
  startX: 0,
  startY: 0,
  startTime: 0,
  moved: false,
  activeButton: null as UiButtonId | null,
};
let lastTapTime = 0;

const directionsByKey: Record<string, Cell> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

function gridToWorld(cell: Cell): THREE.Vector3 {
  const x = (cell.x - settings.columns / 2 + 0.5) * settings.tileSize;
  const z = (cell.y - settings.rows / 2 + 0.5) * settings.tileSize;
  return new THREE.Vector3(x, settings.tileSize * 0.5, z);
}

function markHudDirty(): void {
  hudNeedsRedraw = true;
}

function resizeRenderer(): void {
  const width = canvas.clientWidth || 1;
  const height = canvas.clientHeight || 1;
  const pixelRatio = Math.min(window.devicePixelRatio ?? 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  hudPixelRatio = Math.min(pixelRatio, 1.6);
  hudCanvas.width = Math.max(1, Math.floor(width * hudPixelRatio));
  hudCanvas.height = Math.max(1, Math.floor(height * hudPixelRatio));
  hudMesh.scale.set(width, height, 1);
  hudMesh.position.set(width / 2, height / 2, 0);
  hudCamera.left = 0;
  hudCamera.right = width;
  hudCamera.top = height;
  hudCamera.bottom = 0;
  hudCamera.updateProjectionMatrix();
  markHudDirty();
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
    mesh.scale.set(1, 1, 1);
    mesh.quaternion.identity();
  });
}

function applyWaveOffsets(): void {
  if (waveStrength <= 0 || gameState === "exploding") {
    return;
  }
  const amplitude =
    (waveMode === "burrow"
      ? -settings.tileSize * 0.55
      : settings.tileSize * 0.85) * waveStrength;
  snakeMeshes.forEach((mesh, index) => {
    const offset = Math.sin(waveTime * 7 + index * 0.45) * amplitude * 0.55;
    mesh.position.y += offset;
    mesh.scale.y = 0.95 + Math.sin(waveTime * 6.5 + index * 0.35) * 0.04;
  });
}

function updateSnakeMeshesFromGrid(): void {
  ensureSnakeMeshes();
  snake.forEach((segment, index) => {
    const mesh = snakeMeshes[index];
    if (!mesh) {
      return;
    }
    const worldPos = gridToWorld(segment);
    mesh.position.copy(worldPos);
    mesh.userData.baseY = worldPos.y;
  });
  applyWaveOffsets();
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
  activeBuffs = [];
  buffRedrawTimerMs = 0;
  waveStrength = 0;
  waveMode = null;
  jumpCooldownMs = 0;
  burrowCooldownMs = 0;
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

function triggerJump(): void {
  if (gameState !== "playing" || jumpCooldownMs > 0) {
    return;
  }
  queueManeuver("jump");
  waveMode = "jump";
  waveStrength = 1;
  waveTime = 0;
  jumpCooldownMs = 900;
  addBuff("Прыжок", colors.hudAccent, 1200);
}

function triggerBurrow(): void {
  if (gameState !== "playing" || burrowCooldownMs > 0) {
    return;
  }
  queueManeuver("burrow");
  waveMode = "burrow";
  waveStrength = 1;
  waveTime = 0;
  burrowCooldownMs = 900;
  addBuff("Под землю", colors.hudAccent2, 1200);
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
    addBuff("Замедление", colors.slowTime, slowEffectDurationMs);
  }
  updateHud();
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

function addBuff(label: string, color: string, durationMs: number): void {
  activeBuffs.push({ label, color, remainingMs: durationMs });
  buffRedrawTimerMs = 0;
  markHudDirty();
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
    addBuff("Замедление", colors.slowTime, settings.slowTimeDurationMs);
  }
  if (type === "artifact") {
    levelProgress.mandatoryCollected += 1;
  }
  removePickup(entity);
  if (meta.respawn && type !== "apple") {
    spawnPickup(type);
  }
  updateHud();
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
  updateHud();
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
  updateHud();
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

function registerButton(id: UiButtonId, rect: UiButton["rect"]): void {
  hudButtons.push({ id, rect, visible: true });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  rect: UiButton["rect"],
  radius: number,
): void {
  const r = Math.min(radius, rect.w / 2, rect.h / 2);
  ctx.beginPath();
  ctx.moveTo(rect.x + r, rect.y);
  ctx.lineTo(rect.x + rect.w - r, rect.y);
  ctx.quadraticCurveTo(rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + r);
  ctx.lineTo(rect.x + rect.w, rect.y + rect.h - r);
  ctx.quadraticCurveTo(
    rect.x + rect.w,
    rect.y + rect.h,
    rect.x + rect.w - r,
    rect.y + rect.h,
  );
  ctx.lineTo(rect.x + r, rect.y + rect.h);
  ctx.quadraticCurveTo(rect.x, rect.y + rect.h, rect.x, rect.y + rect.h - r);
  ctx.lineTo(rect.x, rect.y + r);
  ctx.quadraticCurveTo(rect.x, rect.y, rect.x + r, rect.y);
  ctx.closePath();
}

function drawHud(): void {
  hudNeedsRedraw = false;
  hudButtons = [];
  const ctx = hudContext;
  const cssWidth = canvas.clientWidth || 1;
  const cssHeight = canvas.clientHeight || 1;
  const scale = Math.max(0.82, Math.min(cssWidth, cssHeight) / 720);
  const margin = 14 * scale;
  const hudScale = hudPixelRatio;

  const statusPanelHeight = 64 * scale;
  const panelRadius = 14 * scale;

  const barY = margin * hudScale;
  const barHeight = statusPanelHeight * hudScale;

  ctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);

  ctx.fillStyle = "rgba(5, 9, 15, 0.55)";
  ctx.fillRect(
    0,
    0,
    hudCanvas.width,
    Math.max(barHeight + margin * hudScale * 1.5, hudCanvas.height * 0.16),
  );

  const statusRect: UiButton["rect"] = {
    x: margin * hudScale,
    y: barY,
    w: 220 * scale * hudScale,
    h: barHeight,
  };
  drawRoundedRect(ctx, statusRect, panelRadius * hudScale);
  ctx.fillStyle = colors.hudPanel;
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  drawRoundedRect(ctx, statusRect, panelRadius * hudScale);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.stroke();

  const labelSize = 14 * scale * hudScale;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = `500 ${labelSize}px "Inter", "Segoe UI", system-ui`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Статус", statusRect.x + 14 * scale * hudScale, statusRect.y + 10 * scale * hudScale);

  const stateValueSize = 20 * scale * hudScale;
  ctx.font = `700 ${stateValueSize}px "Inter", "Segoe UI", system-ui`;
  ctx.fillStyle = "#f8fafc";
  ctx.fillText(
    stateLabelByState[gameState],
    statusRect.x + 14 * scale * hudScale,
    statusRect.y + 28 * scale * hudScale,
  );

  ctx.fillStyle = "rgba(226,232,240,0.8)";
  ctx.font = `500 ${13 * scale * hudScale}px "Inter", "Segoe UI", system-ui`;
  const goalText =
    levelProgress.mandatoryTotal > 0
      ? `Ур. ${currentLevelIndex + 1}/${levels.length} · Ябл ${levelProgress.applesCollected}/${activeLevel.appleGoal} · Арт ${levelProgress.mandatoryCollected}/${levelProgress.mandatoryTotal}`
      : `Ур. ${currentLevelIndex + 1}/${levels.length} · Ябл ${levelProgress.applesCollected}/${activeLevel.appleGoal}`;
  ctx.fillText(goalText, statusRect.x + 14 * scale * hudScale, statusRect.y + 50 * scale * hudScale);

  const dotX = statusRect.x + statusRect.w - 22 * hudScale * scale;
  const dotY = statusRect.y + statusRect.h - 22 * hudScale * scale;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 8 * scale * hudScale, 0, Math.PI * 2);
  ctx.fillStyle =
    gameState === "playing"
      ? colors.hudAccent
      : gameState === "paused"
        ? "#f59e0b"
        : "#f43f5e";
  ctx.fill();

  const scoreRect: UiButton["rect"] = {
    x: cssWidth * hudScale - (240 * scale + margin) * hudScale,
    y: barY,
    w: 240 * scale * hudScale,
    h: barHeight,
  };
  drawRoundedRect(ctx, scoreRect, panelRadius * hudScale);
  const scoreGradient = ctx.createLinearGradient(
    scoreRect.x,
    scoreRect.y,
    scoreRect.x + scoreRect.w,
    scoreRect.y + scoreRect.h,
  );
  scoreGradient.addColorStop(0, "rgba(16, 134, 82, 0.75)");
  scoreGradient.addColorStop(1, "rgba(34, 197, 94, 0.82)");
  ctx.fillStyle = scoreGradient;
  ctx.fill();

  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
  ctx.font = `500 ${labelSize}px "Inter", "Segoe UI", system-ui`;
  ctx.fillText("Очки", scoreRect.x + 14 * scale * hudScale, scoreRect.y + 12 * scale * hudScale);

  ctx.fillStyle = "#0b0f16";
  ctx.font = `700 ${stateValueSize}px "Inter", "Segoe UI", system-ui`;
  ctx.fillText(
    score.toString(),
    scoreRect.x + 14 * scale * hudScale,
    scoreRect.y + 30 * scale * hudScale,
  );

  ctx.fillStyle = "rgba(11, 15, 22, 0.55)";
  ctx.font = `600 ${labelSize * 0.95}px "Inter", "Segoe UI", system-ui`;
  ctx.textAlign = "right";
  ctx.fillText(
    `Жизни: ${Math.max(0, lives)}`,
    scoreRect.x + scoreRect.w - 14 * scale * hudScale,
    scoreRect.y + 30 * scale * hudScale,
  );

  const buffAreaY = statusRect.y + statusRect.h + 10 * scale * hudScale;
  const buffAreaX = statusRect.x;
  const chipHeight = 28 * scale * hudScale;
  const chipPadding = 8 * scale * hudScale;
  const buffGap = 8 * scale * hudScale;

  if (activeBuffs.length === 0) {
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = `500 ${12 * scale * hudScale}px "Inter", "Segoe UI", system-ui`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Баффы: пока пусто", buffAreaX, buffAreaY + chipHeight / 2);
  } else {
    let chipX = buffAreaX;
    activeBuffs.forEach((buff) => {
      const textSize = 13 * scale * hudScale;
      ctx.font = `600 ${textSize}px "Inter", "Segoe UI", system-ui`;
      const textWidth = ctx.measureText(buff.label).width;
      const chipWidth = textWidth + chipPadding * 2 + 30 * hudScale * scale;
      const chipRect: UiButton["rect"] = {
        x: chipX,
        y: buffAreaY,
        w: chipWidth,
        h: chipHeight,
      };
      drawRoundedRect(ctx, chipRect, chipHeight / 2);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fill();
      ctx.strokeStyle = buff.color;
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = buff.color;
      ctx.beginPath();
      ctx.arc(
        chipRect.x + chipHeight / 2,
        chipRect.y + chipHeight / 2,
        (chipHeight / 2) * 0.7,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.fillStyle = "#e5e7eb";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(
        buff.label,
        chipRect.x + chipHeight * 0.9,
        chipRect.y + chipHeight / 2,
      );
      chipX += chipWidth + buffGap;
    });
  }

  const actionSize = 64 * scale;
  const actionMargin = 16 * scale;
  const jumpRect: UiButton["rect"] = {
    x: actionMargin * hudScale,
    y: cssHeight * hudScale - (actionSize + actionMargin) * hudScale,
    w: actionSize * hudScale,
    h: actionSize * hudScale,
  };
  drawRoundedRect(ctx, jumpRect, actionSize * 0.5 * hudScale);
  ctx.fillStyle = "rgba(125, 211, 252, 0.22)";
  ctx.fill();
  ctx.strokeStyle = colors.hudAccent;
  ctx.stroke();
  ctx.fillStyle = "#e0f2fe";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${18 * scale * hudScale}px "Inter", "Segoe UI", system-ui`;
  ctx.fillText("⤴︎", jumpRect.x + jumpRect.w / 2, jumpRect.y + jumpRect.h / 2);
  ctx.font = `500 ${12 * scale * hudScale}px "Inter", "Segoe UI", system-ui`;
  ctx.fillText(
    "Прыжок",
    jumpRect.x + jumpRect.w / 2,
    jumpRect.y + jumpRect.h + 14 * scale * hudScale,
  );
  registerButton("jump", {
    x: jumpRect.x / hudScale,
    y: jumpRect.y / hudScale,
    w: jumpRect.w / hudScale,
    h: jumpRect.h / hudScale,
  });

  const burrowRect: UiButton["rect"] = {
    x: cssWidth * hudScale - (actionSize + actionMargin) * hudScale,
    y: cssHeight * hudScale - (actionSize + actionMargin) * hudScale,
    w: actionSize * hudScale,
    h: actionSize * hudScale,
  };
  drawRoundedRect(ctx, burrowRect, actionSize * 0.5 * hudScale);
  ctx.fillStyle = "rgba(192, 132, 252, 0.22)";
  ctx.fill();
  ctx.strokeStyle = colors.hudAccent2;
  ctx.stroke();
  ctx.fillStyle = "#f3e8ff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${16 * scale * hudScale}px "Inter", "Segoe UI", system-ui`;
  ctx.fillText("⇣", burrowRect.x + burrowRect.w / 2, burrowRect.y + burrowRect.h / 2);
  ctx.font = `500 ${12 * scale * hudScale}px "Inter", "Segoe UI", system-ui`;
  ctx.fillText(
    "Под землю",
    burrowRect.x + burrowRect.w / 2,
    burrowRect.y + burrowRect.h + 14 * scale * hudScale,
  );
  registerButton("burrow", {
    x: burrowRect.x / hudScale,
    y: burrowRect.y / hudScale,
    w: burrowRect.w / hudScale,
    h: burrowRect.h / hudScale,
  });

  const pauseSize = 42 * scale;
  const pauseRect: UiButton["rect"] = {
    x: cssWidth * hudScale - (pauseSize + margin) * hudScale,
    y: margin * hudScale,
    w: pauseSize * hudScale,
    h: pauseSize * hudScale,
  };
  drawRoundedRect(ctx, pauseRect, pauseSize * hudScale * 0.35);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.stroke();
  ctx.fillStyle = "#e2e8f0";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${18 * scale * hudScale}px "Inter", "Segoe UI", system-ui`;
  ctx.fillText(
    gameState === "paused" ? "▶" : "Ⅱ",
    pauseRect.x + pauseRect.w / 2,
    pauseRect.y + pauseRect.h / 2,
  );
  registerButton("pause", {
    x: pauseRect.x / hudScale,
    y: pauseRect.y / hudScale,
    w: pauseRect.w / hudScale,
    h: pauseRect.h / hudScale,
  });

  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = `500 ${12 * scale * hudScale}px "Inter", "Segoe UI", system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(
    "Свайп — поворот, тап по центру — задать направление",
    (cssWidth * hudScale) / 2,
    cssHeight * hudScale - actionSize * hudScale - actionMargin * hudScale - 8 * hudScale,
  );

  if (overlayMode) {
    ctx.fillStyle = "rgba(5, 8, 12, 0.66)";
    ctx.fillRect(0, 0, hudCanvas.width, hudCanvas.height);
    const cardWidth = 320 * scale * hudScale;
    const cardHeight = 190 * scale * hudScale;
    const cardRect: UiButton["rect"] = {
      x: (cssWidth * hudScale - cardWidth) / 2,
      y: (cssHeight * hudScale - cardHeight) / 2,
      w: cardWidth,
      h: cardHeight,
    };
    drawRoundedRect(ctx, cardRect, 18 * scale * hudScale);
    ctx.fillStyle = "rgba(13, 19, 28, 0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#f8fafc";
    ctx.font = `700 ${20 * scale * hudScale}px "Inter", "Segoe UI", system-ui`;
    ctx.fillText(overlayTitle, cardRect.x + cardRect.w / 2, cardRect.y + 20 * scale * hudScale);

    ctx.fillStyle = "rgba(226, 232, 240, 0.82)";
    ctx.font = `500 ${14 * scale * hudScale}px "Inter", "Segoe UI", system-ui`;
    ctx.fillText(
      overlaySubtitle,
      cardRect.x + cardRect.w / 2,
      cardRect.y + 52 * scale * hudScale,
    );

    const btnWidth = 200 * scale * hudScale;
    const btnHeight = 46 * scale * hudScale;
    const btnRect: UiButton["rect"] = {
      x: cardRect.x + (cardRect.w - btnWidth) / 2,
      y: cardRect.y + cardRect.h - btnHeight - 20 * scale * hudScale,
      w: btnWidth,
      h: btnHeight,
    };
    drawRoundedRect(ctx, btnRect, 12 * scale * hudScale);
    const btnGradient = ctx.createLinearGradient(
      btnRect.x,
      btnRect.y,
      btnRect.x + btnRect.w,
      btnRect.y + btnRect.h,
    );
    btnGradient.addColorStop(0, colors.hudAccent);
    btnGradient.addColorStop(1, colors.hudAccent2);
    ctx.fillStyle = btnGradient;
    ctx.fill();
    ctx.fillStyle = "#0b0f16";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${15 * scale * hudScale}px "Inter", "Segoe UI", system-ui`;
    ctx.fillText(overlayActionLabel, btnRect.x + btnRect.w / 2, btnRect.y + btnRect.h / 2);
    registerButton("primary", {
      x: btnRect.x / hudScale,
      y: btnRect.y / hudScale,
      w: btnRect.w / hudScale,
      h: btnRect.h / hudScale,
    });
  }

  hudTexture.needsUpdate = true;
}
function findButtonAt(clientX: number, clientY: number): UiButtonId | null {
  for (const button of hudButtons) {
    if (!button.visible) {
      continue;
    }
    const { rect } = button;
    if (
      clientX >= rect.x &&
      clientX <= rect.x + rect.w &&
      clientY >= rect.y &&
      clientY <= rect.y + rect.h
    ) {
      return button.id;
    }
  }
  return null;
}

function handlePrimaryAction(): void {
  if (overlayMode) {
    if (menuActionHandler) {
      menuActionHandler();
      return;
    }
    if (overlayMode === "paused") {
      setGameState("playing");
      overlayMode = null;
      markHudDirty();
      return;
    }
  }

  if (gameState === "playing") {
    setGameState("paused");
    overlayMode = "paused";
    markHudDirty();
  }
}

function togglePause(): void {
  if (gameState === "playing") {
    setGameState("paused");
    overlayMode = "paused";
    overlayTitle = "Пауза";
    overlaySubtitle = "Нажмите кнопку, чтобы продолжить";
    overlayActionLabel = "Продолжить";
    menuActionHandler = () => {
      setGameState("playing");
      overlayMode = null;
      markHudDirty();
    };
  } else if (gameState === "paused") {
    setGameState("playing");
    overlayMode = null;
    menuActionHandler = null;
  }
  markHudDirty();
}

function handleSwipeOrTap(
  dx: number,
  dy: number,
  distance: number,
  totalTime: number,
  clientX: number,
  clientY: number,
): void {
  const now = performance.now();
  const isTap = distance < 14 && totalTime < 240;
  const doubleTap = isTap && now - lastTapTime < 280;
  if (doubleTap) {
    togglePause();
    lastTapTime = 0;
    return;
  }
  if (overlayMode && isTap) {
    handlePrimaryAction();
    lastTapTime = now;
    return;
  }
  if (isTap) {
    const centerX = (canvas.clientWidth || 1) / 2;
    const centerY = (canvas.clientHeight || 1) / 2;
    const dirX = clientX - centerX;
    const dirY = clientY - centerY;
    if (Math.abs(dirX) > Math.abs(dirY)) {
      tryChangeDirection({ x: dirX > 0 ? 1 : -1, y: 0 });
    } else {
      tryChangeDirection({ x: 0, y: dirY > 0 ? 1 : -1 });
    }
    lastTapTime = now;
    return;
  }
  if (distance >= 16) {
    if (Math.abs(dx) > Math.abs(dy)) {
      tryChangeDirection({ x: dx > 0 ? 1 : -1, y: 0 });
    } else {
      tryChangeDirection({ x: 0, y: dy > 0 ? 1 : -1 });
    }
  }
  lastTapTime = now;
}

function onPointerDown(event: PointerEvent): void {
  event.preventDefault();
  swipeState.pointerId = event.pointerId;
  swipeState.startX = event.clientX;
  swipeState.startY = event.clientY;
  swipeState.startTime = performance.now();
  swipeState.moved = false;
  swipeState.activeButton = findButtonAt(event.clientX, event.clientY);
  canvas.setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  if (swipeState.pointerId !== event.pointerId) {
    return;
  }
  const dx = event.clientX - swipeState.startX;
  const dy = event.clientY - swipeState.startY;
  if (!swipeState.moved && Math.hypot(dx, dy) > 6) {
    swipeState.moved = true;
  }
}

function onPointerUp(event: PointerEvent): void {
  if (swipeState.pointerId !== event.pointerId) {
    return;
  }
  const dx = event.clientX - swipeState.startX;
  const dy = event.clientY - swipeState.startY;
  const distance = Math.hypot(dx, dy);
  const totalTime = performance.now() - swipeState.startTime;
  const button = swipeState.activeButton;

  if (button && !swipeState.moved) {
    switch (button) {
      case "primary":
        handlePrimaryAction();
        break;
      case "pause":
        togglePause();
        break;
      case "jump":
        triggerJump();
        break;
      case "burrow":
        triggerBurrow();
        break;
    }
  } else {
    handleSwipeOrTap(dx, dy, distance, totalTime, event.clientX, event.clientY);
  }

  swipeState.pointerId = null;
  swipeState.activeButton = null;
  canvas.releasePointerCapture(event.pointerId);
}

function onPointerCancel(event: PointerEvent): void {
  if (swipeState.pointerId !== event.pointerId) {
    return;
  }
  swipeState.pointerId = null;
  swipeState.activeButton = null;
  canvas.releasePointerCapture(event.pointerId);
}

function handleResize(): void {
  resizeRenderer();
  renderer.render(scene, camera);
  hudTexture.needsUpdate = true;
}

window.addEventListener("resize", handleResize);
window.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "Spacebar") {
    event.preventDefault();
    togglePause();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    if (gameState === "exploding") {
      finishExplosion();
      return;
    }
    handlePrimaryAction();
    return;
  }

  if (event.key === "j" || event.key === "J") {
    event.preventDefault();
    triggerJump();
    return;
  }

  if (event.key === "k" || event.key === "K") {
    event.preventDefault();
    triggerBurrow();
    return;
  }

  const requested = directionsByKey[event.key];
  if (!requested) {
    return;
  }
  event.preventDefault();
  tryChangeDirection(requested);
});

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerCancel);

function updateBuffTimers(deltaMs: number): void {
  if (activeBuffs.length === 0) {
    return;
  }
  let removed = false;
  activeBuffs.forEach((buff) => {
    buff.remainingMs -= deltaMs;
    if (buff.remainingMs <= 0) {
      removed = true;
    }
  });
  if (removed) {
    activeBuffs = activeBuffs.filter((buff) => buff.remainingMs > 0);
    markHudDirty();
  }
}

function animate(now: number): void {
  const deltaMs = now - lastFrame;
  lastFrame = now;
  if (slowEffectRemainingMs > 0) {
    slowEffectRemainingMs = Math.max(0, slowEffectRemainingMs - deltaMs);
  }

  jumpCooldownMs = Math.max(0, jumpCooldownMs - deltaMs);
  burrowCooldownMs = Math.max(0, burrowCooldownMs - deltaMs);

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

  updateBuffTimers(deltaMs);
  buffRedrawTimerMs += deltaMs;
  if (activeBuffs.length > 0 && buffRedrawTimerMs > 220) {
    buffRedrawTimerMs = 0;
    markHudDirty();
  }

  if (waveStrength > 0) {
    waveStrength = Math.max(0, waveStrength - deltaMs * 0.0012);
    waveTime += deltaMs * 0.001;
  }

  stepPhysics(deltaMs / 1000);
  if (!physicsWorld) {
    applyManeuverOffsets(now);
  }

  resizeRenderer();
  updateCameraFollow(deltaMs / 1000);

  renderer.setRenderTarget(null);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  if (hudNeedsRedraw) {
    drawHud();
  }
  renderer.render(hudScene, hudCamera);
  requestAnimationFrame(animate);
}

applyLevelConfig(activeLevel);
resetLevel();
showStartMenu();
setGameState("idle");
resizeRenderer();
markHudDirty();
requestAnimationFrame(animate);
