import * as THREE from "three";
import { Body, Box, ContactMaterial, Material, Plane, Vec3, World } from "cannon-es";

type Point = { x: number; y: number };
type Direction = Point;
type ObstacleType = "wall" | "bush" | "water" | "rock";
type CollectibleType = "apple" | "life" | "slow" | "artifact";
type GamePhase = "menu" | "playing" | "transition" | "exploding";
type ActionKind = "jump" | "burrow";

type ObstacleCell = Point & { type: ObstacleType };
type Collectible = {
  id: number;
  type: CollectibleType;
  position: Point;
  mesh: THREE.Object3D;
  bobOffset: number;
};

type Level = {
  id: number;
  title: string;
  description: string;
  columns: number;
  rows: number;
  tickMs: number;
  applesGoal: number;
  artifactsGoal: number;
  seed: number;
  cameraHeight: number;
  bonusLives?: number;
  bonusSlows?: number;
};

const settings = {
  unit: 1.15,
  jumpDistance: 3,
  jumpCooldown: 650,
  burrowCooldown: 900,
};

const obstacleRules: Record<
  ObstacleType,
  { normalBlocked: boolean; jumpAllowed: boolean; burrowAllowed: boolean }
> = {
  wall: { normalBlocked: true, jumpAllowed: false, burrowAllowed: true },
  bush: { normalBlocked: true, jumpAllowed: true, burrowAllowed: true },
  water: { normalBlocked: true, jumpAllowed: true, burrowAllowed: false },
  rock: { normalBlocked: true, jumpAllowed: true, burrowAllowed: true },
};

const levels: Level[] = [
  {
    id: 0,
    title: "Стартовые холмы",
    description: "Редкие кусты и мелкие лужи, чтобы освоить прыжок.",
    columns: 14,
    rows: 14,
    tickMs: 150,
    applesGoal: 5,
    artifactsGoal: 1,
    seed: 1,
    cameraHeight: 16,
    bonusLives: 1,
  },
  {
    id: 1,
    title: "Каменное кольцо",
    description: "Кольцевые стены с двумя проходами, требуются прыжки через воду.",
    columns: 18,
    rows: 18,
    tickMs: 140,
    applesGoal: 6,
    artifactsGoal: 1,
    seed: 2,
    cameraHeight: 18,
  },
  {
    id: 2,
    title: "Коридоры",
    description: "Узкие ходы, где важно прыгать волной.",
    columns: 20,
    rows: 16,
    tickMs: 130,
    applesGoal: 7,
    artifactsGoal: 1,
    seed: 3,
    cameraHeight: 19,
    bonusSlows: 1,
  },
  {
    id: 3,
    title: "Озёра",
    description: "Полосы воды, которые можно только перепрыгивать.",
    columns: 22,
    rows: 22,
    tickMs: 125,
    applesGoal: 8,
    artifactsGoal: 2,
    seed: 4,
    cameraHeight: 20,
  },
  {
    id: 4,
    title: "Каньон",
    description: "Стены не перепрыгнуть, зато можно уйти под землю.",
    columns: 24,
    rows: 18,
    tickMs: 120,
    applesGoal: 9,
    artifactsGoal: 2,
    seed: 5,
    cameraHeight: 21,
  },
  {
    id: 5,
    title: "Джунгли",
    description: "Много кустов, камни и редкие просветы.",
    columns: 26,
    rows: 22,
    tickMs: 115,
    applesGoal: 9,
    artifactsGoal: 2,
    seed: 6,
    cameraHeight: 22,
    bonusLives: 1,
  },
  {
    id: 6,
    title: "Острова",
    description: "Острова суши в воде, нужен точный прыжок.",
    columns: 28,
    rows: 24,
    tickMs: 110,
    applesGoal: 10,
    artifactsGoal: 2,
    seed: 7,
    cameraHeight: 23,
  },
  {
    id: 7,
    title: "Цитадель",
    description: "Высокие стены, только подкоп поможет пройти глубже.",
    columns: 30,
    rows: 26,
    tickMs: 105,
    applesGoal: 10,
    artifactsGoal: 3,
    seed: 8,
    cameraHeight: 24,
    bonusSlows: 1,
  },
  {
    id: 8,
    title: "Долина ветров",
    description: "Просторная карта — камера следует за головой.",
    columns: 34,
    rows: 30,
    tickMs: 100,
    applesGoal: 11,
    artifactsGoal: 3,
    seed: 9,
    cameraHeight: 26,
  },
  {
    id: 9,
    title: "Последний марш",
    description: "Комбо стен, воды и камней. Финал на десятом уровне.",
    columns: 36,
    rows: 28,
    tickMs: 95,
    applesGoal: 12,
    artifactsGoal: 3,
    seed: 10,
    cameraHeight: 27,
    bonusLives: 1,
    bonusSlows: 1,
  },
];

const foundContainer = document.getElementById("scene-container");
if (!(foundContainer instanceof HTMLDivElement)) {
  throw new Error("Не найден контейнер для сцены");
}
const sceneContainer = foundContainer;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.autoClear = false;
sceneContainer.appendChild(renderer.domElement);

const worldScene = new THREE.Scene();
worldScene.background = new THREE.Color(0x04070e);
worldScene.fog = new THREE.Fog(0x04070e, 18, 130);
const uiScene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 450);
const cameraTarget = new THREE.Vector3(0, 0.4, 0);
const cameraLook = new THREE.Vector3(0, 0.4, 0);
const uiCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);

let viewport = { width: sceneContainer.clientWidth, height: sceneContainer.clientHeight };

function resizeRenderer(): void {
  viewport = { width: sceneContainer.clientWidth, height: sceneContainer.clientHeight };
  renderer.setSize(viewport.width, viewport.height);
  camera.aspect = viewport.width / viewport.height;
  camera.updateProjectionMatrix();

  const halfW = viewport.width / 2;
  const halfH = viewport.height / 2;
  uiCamera.left = -halfW;
  uiCamera.right = halfW;
  uiCamera.top = halfH;
  uiCamera.bottom = -halfH;
  uiCamera.updateProjectionMatrix();

  layoutUi();
}

window.addEventListener("resize", resizeRenderer);

const ambient = new THREE.AmbientLight(0xcdd8ff, 0.63);
const mainLight = new THREE.DirectionalLight(0xffffff, 1.05);
mainLight.position.set(-18, 26, 12);
mainLight.castShadow = true;
mainLight.shadow.mapSize.set(1024, 1024);
mainLight.shadow.camera.left = -45;
mainLight.shadow.camera.right = 45;
mainLight.shadow.camera.top = 45;
mainLight.shadow.camera.bottom = -45;
const rimLight = new THREE.DirectionalLight(0x7ab9ff, 0.4);
rimLight.position.set(22, 18, -14);
worldScene.add(ambient, mainLight, rimLight);

let floor: THREE.Mesh | null = null;
let grid: THREE.GridHelper | null = null;

const snakeGroup = new THREE.Group();
const obstacleGroup = new THREE.Group();
const collectibleGroup = new THREE.Group();
const effectGroup = new THREE.Group();
worldScene.add(snakeGroup, obstacleGroup, collectibleGroup, effectGroup);

const segmentSize = settings.unit * 0.9;
const halfSegment = segmentSize / 2;
const segmentGeometry = new THREE.BoxGeometry(segmentSize, segmentSize, segmentSize);
const headMaterial = new THREE.MeshStandardMaterial({
  color: 0x3ae17a,
  emissive: 0x113b27,
  roughness: 0.35,
  metalness: 0.14,
});
const bodyMaterial = new THREE.MeshStandardMaterial({
  color: 0x38c975,
  emissive: 0x0f2e1c,
  roughness: 0.42,
  metalness: 0.09,
});

const obstacleMaterials: Record<ObstacleType, THREE.Material> = {
  wall: new THREE.MeshStandardMaterial({
    color: 0x4f5566,
    emissive: 0x1a1c28,
    roughness: 0.55,
    metalness: 0.08,
  }),
  bush: new THREE.MeshStandardMaterial({
    color: 0x3a7a4a,
    emissive: 0x0f2b1a,
    roughness: 0.58,
    metalness: 0.05,
  }),
  water: new THREE.MeshStandardMaterial({
    color: 0x3a9fe1,
    emissive: 0x0a2b42,
    roughness: 0.28,
    metalness: 0.12,
    transparent: true,
    opacity: 0.9,
  }),
  rock: new THREE.MeshStandardMaterial({
    color: 0x7d6d5c,
    emissive: 0x241c14,
    roughness: 0.78,
    metalness: 0.04,
  }),
};

const collectibleMaterials: Record<CollectibleType, THREE.Material> = {
  apple: new THREE.MeshStandardMaterial({
    color: 0xff546d,
    emissive: 0x62151f,
    roughness: 0.38,
    metalness: 0.2,
  }),
  life: new THREE.MeshStandardMaterial({
    color: 0xff9ad5,
    emissive: 0x402032,
    roughness: 0.35,
    metalness: 0.14,
  }),
  slow: new THREE.MeshStandardMaterial({
    color: 0x6ddcff,
    emissive: 0x19304b,
    roughness: 0.32,
    metalness: 0.18,
  }),
  artifact: new THREE.MeshStandardMaterial({
    color: 0xffe29f,
    emissive: 0x5a3a14,
    roughness: 0.25,
    metalness: 0.35,
  }),
};

const hudCanvas = document.createElement("canvas");
hudCanvas.width = 1024;
hudCanvas.height = 280;
const hudCtx = hudCanvas.getContext("2d") as CanvasRenderingContext2D;
if (!hudCtx) {
  throw new Error("Не удалось создать HUD canvas");
}
const hudTexture = new THREE.CanvasTexture(hudCanvas);
const hudMaterial = new THREE.MeshBasicMaterial({
  map: hudTexture,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});
const hudPlane = new THREE.Mesh(new THREE.PlaneGeometry(hudCanvas.width, hudCanvas.height), hudMaterial);
uiScene.add(hudPlane);

const messageCanvas = document.createElement("canvas");
messageCanvas.width = 940;
messageCanvas.height = 320;
const messageCtx = messageCanvas.getContext("2d") as CanvasRenderingContext2D;
if (!messageCtx) {
  throw new Error("Не удалось создать message canvas");
}
const messageTexture = new THREE.CanvasTexture(messageCanvas);
const messageMaterial = new THREE.MeshBasicMaterial({
  map: messageTexture,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  opacity: 0.95,
});
const messagePlane = new THREE.Mesh(
  new THREE.PlaneGeometry(messageCanvas.width, messageCanvas.height),
  messageMaterial,
);
uiScene.add(messagePlane);

const controlsCanvas = document.createElement("canvas");
controlsCanvas.width = 1024;
controlsCanvas.height = 260;
const controlsCtx = controlsCanvas.getContext("2d") as CanvasRenderingContext2D;
if (!controlsCtx) {
  throw new Error("Не удалось создать controls canvas");
}
const controlsTexture = new THREE.CanvasTexture(controlsCanvas);
const controlsMaterial = new THREE.MeshBasicMaterial({
  map: controlsTexture,
  transparent: true,
  depthTest: false,
  depthWrite: false,
  opacity: 0.9,
});
const controlsPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(controlsCanvas.width, controlsCanvas.height),
  controlsMaterial,
);
uiScene.add(controlsPlane);

let controlZones = {
  steer: { x: 140, y: viewport.height - 130, r: 120 },
  jump: { x: viewport.width - 150, y: viewport.height - 150, r: 80 },
  burrow: { x: viewport.width - 320, y: viewport.height - 90, r: 70 },
};

let snake: Point[] = [];
let snakeMeshes: THREE.Mesh[] = [];
let direction: Direction = { x: 1, y: 0 };
let nextDirection: Direction = { x: 1, y: 0 };
let queuedAction: ActionKind | null = null;
let actionWave: { type: ActionKind; progress: number; duration: number } | null = null;
const initialLevel = levels[0]!;
let boardWidth = initialLevel.columns * settings.unit;
let boardDepth = initialLevel.rows * settings.unit;
let tickInterval = initialLevel.tickMs / 1000;
let obstacles: ObstacleCell[] = [];
let obstacleMap = new Map<string, ObstacleType>();
let collectibles: Collectible[] = [];
let collectibleId = 0;
let appleEaten = 0;
let artifactsCollected = 0;
let score = 0;
let lives = 2;
let slowUntil = 0;
let gamePhase: GamePhase = "menu";
let accumulator = 0;
let lastFrame = performance.now();
let hudDirty = true;
let messageText = "Тапните или нажмите пробел, чтобы начать.";
let messageVisible = true;
let transitionTimer = 0;
let jumpCooldownUntil = 0;
let burrowCooldownUntil = 0;
let currentLevelIndex = 0;
let currentLevel: Level = levels[currentLevelIndex]!;

let physicsWorld: World | null = null;
let debrisPieces: { mesh: THREE.Mesh; body: Body }[] = [];
const debrisGroup = new THREE.Group();
worldScene.add(debrisGroup);
const physicsMaterials = {
  floor: new Material("floor"),
  segment: new Material("segment"),
};
let explosionFx: { mesh: THREE.Mesh; time: number } | null = null;
const noiseData = new Uint8Array(16 * 16 * 4);
for (let i = 0; i < noiseData.length; i += 4) {
  const value = Math.random() * 255;
  noiseData[i] = value;
  noiseData[i + 1] = value * 0.7;
  noiseData[i + 2] = 255;
  noiseData[i + 3] = 255;
}
const noiseTexture = new THREE.DataTexture(noiseData, 16, 16);
noiseTexture.needsUpdate = true;

class Soundscape {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  ambientGain: GainNode | null = null;
  ready = false;
  playingAmbient = false;

  ensure(): void {
    if (this.ready) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);
    this.ready = true;
  }

  resume(): void {
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  playAmbient(): void {
    if (!this.ready || this.playingAmbient || !this.ctx || !this.master) return;
    const left = this.ctx.createOscillator();
    const right = this.ctx.createOscillator();
    const lGain = this.ctx.createGain();
    const rGain = this.ctx.createGain();
    left.type = "sine";
    right.type = "triangle";
    left.frequency.value = 126;
    right.frequency.value = 214;
    lGain.gain.value = 0.07;
    rGain.gain.value = 0.05;
    left.connect(lGain).connect(this.master);
    right.connect(rGain).connect(this.master);
    left.start();
    right.start();
    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0.6;
    this.playingAmbient = true;
  }

  blip(frequency: number, duration = 0.16, volume = 0.3): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = frequency;
    osc.type = "sawtooth";
    gain.gain.value = volume;
    osc.connect(gain).connect(this.master);
    const now = this.ctx.currentTime;
    gain.gain.linearRampToValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  clickDown(): void {
    this.blip(320, 0.12, 0.25);
  }

  pickup(): void {
    this.blip(520, 0.12, 0.25);
  }

  slow(): void {
    this.blip(240, 0.26, 0.22);
  }

  explode(): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.3, this.ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const source = this.ctx.createBufferSource();
    source.buffer = noise;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.8;
    source.connect(gain).connect(this.master);
    source.start();
  }
}

const soundscape = new Soundscape();

function layoutUi(): void {
  hudPlane.position.set(0, viewport.height / 2 - hudCanvas.height / 2 - 10, 0);
  messagePlane.position.set(0, viewport.height / 2 - messageCanvas.height / 2 - 40, 0);
  controlsCanvas.width = Math.max(720, Math.floor(viewport.width * 0.9));
  controlsCanvas.height = 240;
  controlsPlane.geometry.dispose();
  controlsPlane.geometry = new THREE.PlaneGeometry(controlsCanvas.width, controlsCanvas.height);
  controlsPlane.position.set(0, -viewport.height / 2 + controlsCanvas.height / 2 + 10, 0);
  controlZones = {
    steer: { x: 120, y: viewport.height - 140, r: 120 },
    jump: { x: viewport.width - 140, y: viewport.height - 150, r: 80 },
    burrow: { x: viewport.width - 320, y: viewport.height - 90, r: 70 },
  };
  drawControlsOverlay();
  hudDirty = true;
}

function keyFor(point: Point): string {
  return `${point.x},${point.y}`;
}

function toWorld(point: Point, height = halfSegment): THREE.Vector3 {
  return new THREE.Vector3(
    -boardWidth / 2 + settings.unit * point.x + settings.unit / 2,
    height,
    -boardDepth / 2 + settings.unit * point.y + settings.unit / 2,
  );
}

function mulberry32(seed: number): () => number {
  return function rng(): number {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isOutOfBounds(point: Point): boolean {
  return (
    point.x < 0 ||
    point.y < 0 ||
    point.x >= currentLevel.columns ||
    point.y >= currentLevel.rows
  );
}

function obstacleAt(point: Point): ObstacleType | null {
  return obstacleMap.get(keyFor(point)) ?? null;
}

function isOnSnake(point: Point): boolean {
  return snake.some((segment) => segment.x === point.x && segment.y === point.y);
}

function isCellFree(point: Point): boolean {
  return !isOutOfBounds(point) && !isOnSnake(point) && !obstacleAt(point);
}

function updateBoardGeometry(): void {
  boardWidth = currentLevel.columns * settings.unit;
  boardDepth = currentLevel.rows * settings.unit;
  if (floor) {
    floor.geometry.dispose();
    if (Array.isArray(floor.material)) {
      floor.material.forEach((m) => m.dispose());
    } else {
      floor.material.dispose();
    }
    worldScene.remove(floor);
  }
  floor = new THREE.Mesh(
    new THREE.PlaneGeometry(boardWidth + 6, boardDepth + 6),
    new THREE.MeshStandardMaterial({
      color: 0x0c1120,
      roughness: 0.95,
      metalness: 0.06,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  worldScene.add(floor);

  if (grid) {
    grid.geometry.dispose();
    if (Array.isArray(grid.material)) {
      grid.material.forEach((m) => m.dispose());
    } else {
      grid.material.dispose();
    }
    worldScene.remove(grid);
  }
  grid = new THREE.GridHelper(boardWidth, currentLevel.columns, 0x35405a, 0x1e2535);
  grid.position.y = 0.015;
  if (!Array.isArray(grid.material)) {
    grid.material.transparent = true;
    grid.material.opacity = 0.22;
  }
  worldScene.add(grid);
}

function addObstacleMeshes(): void {
  obstacleGroup.clear();
  obstacleMap = new Map();
  obstacles.forEach((cell) => {
    obstacleMap.set(keyFor(cell), cell.type);
    let mesh: THREE.Mesh;
    if (cell.type === "water") {
      mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(settings.unit, settings.unit),
        obstacleMaterials.water,
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.copy(toWorld(cell, 0.02));
    } else if (cell.type === "wall") {
      const wallHeight = settings.unit * (1.8 + Math.random() * 0.6);
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(settings.unit, wallHeight, settings.unit),
        obstacleMaterials.wall,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.copy(toWorld(cell, wallHeight / 2));
    } else if (cell.type === "bush") {
      const geo = new THREE.IcosahedronGeometry(settings.unit * 0.7, 0);
      mesh = new THREE.Mesh(geo, obstacleMaterials.bush);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.copy(toWorld(cell, settings.unit * 0.35));
    } else {
      const geo = new THREE.DodecahedronGeometry(settings.unit * 0.55, 0);
      mesh = new THREE.Mesh(geo, obstacleMaterials.rock);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.copy(toWorld(cell, settings.unit * 0.35));
    }
    obstacleGroup.add(mesh);
  });
}

function buildObstacles(level: Level): ObstacleCell[] {
  const rng = mulberry32(level.seed);
  const cells: ObstacleCell[] = [];
  const used = new Set<string>();
  const start = { x: Math.floor(level.columns / 2), y: Math.floor(level.rows / 2) };
  const outOfBounds = (x: number, y: number): boolean =>
    x < 0 || y < 0 || x >= level.columns || y >= level.rows;

  const guard = (x: number, y: number): boolean => {
    const nearStart = Math.abs(x - start.x) + Math.abs(y - start.y) <= 3;
    const key = `${x},${y}`;
    if (nearStart || used.has(key) || outOfBounds(x, y)) return false;
    used.add(key);
    return true;
  };

  const addPerimeter = (type: ObstacleType, gapEvery = 0): void => {
    for (let x = 0; x < level.columns; x += 1) {
      for (let y = 0; y < level.rows; y += 1) {
        const onBorder = x === 0 || y === 0 || x === level.columns - 1 || y === level.rows - 1;
        if (!onBorder) continue;
        if (gapEvery > 0 && (x + y) % gapEvery === 0) continue;
        if (guard(x, y)) cells.push({ x, y, type });
      }
    }
  };

  const scatter = (type: ObstacleType, count: number, padding = 0): void => {
    let placed = 0;
    let fails = 0;
    while (placed < count && fails < count * 10) {
      const x = Math.floor(rng() * level.columns);
      const y = Math.floor(rng() * level.rows);
      if (Math.abs(x - start.x) <= padding && Math.abs(y - start.y) <= padding) {
        fails += 1;
        continue;
      }
      if (guard(x, y)) {
        cells.push({ x, y, type });
        placed += 1;
      } else {
        fails += 1;
      }
    }
  };

  const addStripe = (
    type: ObstacleType,
    axis: "x" | "y",
    positions: number[],
    lengthPercent = 1,
  ): void => {
    const max = axis === "x" ? level.columns : level.rows;
    const limit = Math.floor(max * lengthPercent);
    positions.forEach((pos) => {
      for (let i = 1; i < limit - 1; i += 1) {
        const x = axis === "x" ? pos : i;
        const y = axis === "y" ? pos : i;
        if (guard(x, y)) {
          cells.push({ x, y, type });
        }
      }
    });
  };

  switch (level.id) {
    case 0:
      scatter("bush", 18, 2);
      scatter("rock", 10, 2);
      addStripe("water", "x", [4, 9], 0.45);
      break;
    case 1:
      addPerimeter("wall", 5);
      scatter("rock", 16, 3);
      addStripe("water", "y", [6, level.rows - 6], 0.7);
      scatter("bush", 12, 3);
      break;
    case 2:
      addStripe("wall", "x", [4, 8, 12, 16], 0.9);
      addStripe("wall", "y", [5, 10], 0.8);
      scatter("bush", 14, 2);
      scatter("rock", 10, 2);
      break;
    case 3:
      addStripe("water", "x", [5, 9, 13, 17], 1);
      addStripe("water", "y", [6, 14], 0.7);
      scatter("rock", 12, 3);
      scatter("bush", 14, 2);
      break;
    case 4:
      addStripe("wall", "y", [4, 8, 12, 16], 1);
      addStripe("rock", "x", [3, 7, 11, 15, 19], 0.75);
      scatter("water", 8, 3);
      scatter("bush", 16, 2);
      break;
    case 5:
      scatter("bush", 32, 2);
      scatter("rock", 18, 2);
      addStripe("water", "x", [7, 15, 21], 0.6);
      break;
    case 6:
      addPerimeter("water", 0);
      scatter("water", 24, 3);
      scatter("rock", 20, 3);
      scatter("bush", 18, 2);
      addStripe("wall", "x", [Math.floor(level.columns / 2)], 0.9);
      break;
    case 7:
      addPerimeter("wall", 0);
      addStripe("wall", "y", [Math.floor(level.rows / 2) - 2, Math.floor(level.rows / 2) + 2], 0.9);
      addStripe("wall", "x", [Math.floor(level.columns / 3), Math.floor((level.columns / 3) * 2)], 0.8);
      scatter("rock", 18, 3);
      scatter("water", 12, 3);
      break;
    case 8:
      scatter("bush", 30, 3);
      scatter("rock", 24, 3);
      addStripe("water", "y", [8, 16, 24], 1);
      addStripe("wall", "x", [6, 18, 26], 0.9);
      break;
    default:
      addPerimeter("wall", 6);
      addStripe("water", "y", [10, 18], 0.9);
      addStripe("wall", "x", [8, 16, 24, 30], 0.85);
      scatter("rock", 24, 3);
      scatter("bush", 26, 3);
      break;
  }

  return cells;
}

function pickFreeCell(): Point {
  const free: Point[] = [];
  for (let y = 0; y < currentLevel.rows; y += 1) {
    for (let x = 0; x < currentLevel.columns; x += 1) {
      const cell = { x, y };
      if (isCellFree(cell) && !collectibles.some((c) => c.position.x === x && c.position.y === y)) {
        free.push(cell);
      }
    }
  }
  if (free.length === 0) {
    return { x: 0, y: 0 };
  }
  const pick = Math.floor(Math.random() * free.length);
  return free[pick]!;
}

function createCollectibleMesh(type: CollectibleType): THREE.Object3D {
  switch (type) {
    case "apple":
      return new THREE.Mesh(new THREE.SphereGeometry(segmentSize * 0.35, 20, 20), collectibleMaterials.apple);
    case "life":
      return new THREE.Mesh(new THREE.OctahedronGeometry(segmentSize * 0.45, 0), collectibleMaterials.life);
    case "slow":
      return new THREE.Mesh(new THREE.DodecahedronGeometry(segmentSize * 0.48, 0), collectibleMaterials.slow);
    default:
      return new THREE.Mesh(new THREE.IcosahedronGeometry(segmentSize * 0.5, 0), collectibleMaterials.artifact);
  }
}

function spawnCollectible(type: CollectibleType): void {
  const position = pickFreeCell();
  const mesh = createCollectibleMesh(type);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.copy(toWorld(position, halfSegment));
  collectibleGroup.add(mesh);
  collectibles.push({
    id: collectibleId += 1,
    type,
    position,
    mesh,
    bobOffset: Math.random() * Math.PI * 2,
  });
}

function clearCollectibles(): void {
  collectibles.forEach((c) => collectibleGroup.remove(c.mesh));
  collectibles = [];
}

function resetSnake(): void {
  const startX = Math.floor(currentLevel.columns / 2);
  const startY = Math.floor(currentLevel.rows / 2);
  direction = { x: 1, y: 0 };
  nextDirection = { x: 1, y: 0 };
  snake = [
    { x: startX, y: startY },
    { x: startX - 1, y: startY },
    { x: startX - 2, y: startY },
    { x: startX - 3, y: startY },
  ];
  syncSnakeMeshes();
}

function syncSnakeMeshes(): void {
  while (snakeMeshes.length < snake.length) {
    const mesh = new THREE.Mesh(segmentGeometry, bodyMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    snakeMeshes.push(mesh);
    snakeGroup.add(mesh);
  }
  while (snakeMeshes.length > snake.length) {
    const mesh = snakeMeshes.pop();
    if (mesh) {
      snakeGroup.remove(mesh);
    }
  }
  snake.forEach((segment, index) => {
    const mesh = snakeMeshes[index];
    if (!mesh) return;
    mesh.material = index === 0 ? headMaterial : bodyMaterial;
    const base = toWorld(segment, halfSegment);
    mesh.position.set(base.x, base.y + computeWaveOffset(index), base.z);
    mesh.rotation.set(0, 0, 0);
  });
}

function computeWaveOffset(index: number): number {
  if (!actionWave) return 0;
  const t = Math.min(1, actionWave.progress);
  const waveHead = t * (snake.length + 3);
  const distance = Math.max(0, waveHead - index);
  const pulse = Math.sin(Math.min(1, distance) * Math.PI);
  const attenuation = Math.max(0, 1 - distance * 0.25);
  const amplitude = actionWave.type === "jump" ? halfSegment * 0.9 : -halfSegment * 0.7;
  return pulse * attenuation * amplitude;
}

function drawHud(): void {
  hudCtx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
  const gradient = hudCtx.createLinearGradient(0, 0, hudCanvas.width, hudCanvas.height);
  gradient.addColorStop(0, "rgba(17,28,46,0.9)");
  gradient.addColorStop(1, "rgba(10,18,33,0.9)");
  hudCtx.fillStyle = gradient;
  roundRect(hudCtx, 12, 12, hudCanvas.width - 24, hudCanvas.height - 24, 18);
  hudCtx.fill();

  hudCtx.fillStyle = "rgba(255,255,255,0.08)";
  hudCtx.fillRect(20, 70, hudCanvas.width - 40, 2);

  hudCtx.fillStyle = "#93c5fd";
  hudCtx.font = "700 26px 'Space Grotesk', 'Fira Sans', sans-serif";
  hudCtx.fillText(`Уровень ${currentLevelIndex + 1}/10 — ${currentLevel.title}`, 28, 50);
  hudCtx.fillStyle = "#cbd5f5";
  hudCtx.font = "400 18px 'Space Grotesk', 'Fira Sans', sans-serif";
  hudCtx.fillText(currentLevel.description, 28, 80);

  hudCtx.font = "600 22px 'Space Grotesk', 'Fira Sans', sans-serif";
  const labels = [
    `Счёт: ${score}`,
    `Яблоки: ${appleEaten}/${currentLevel.applesGoal}`,
    `Артефакты: ${artifactsCollected}/${currentLevel.artifactsGoal}`,
    `Жизни: ${lives}`,
  ];
  labels.forEach((text, i) => {
    hudCtx.fillStyle = "#e5edff";
    hudCtx.fillText(text, 28 + i * 240, 128);
  });

  hudCtx.font = "600 18px 'Space Grotesk', 'Fira Sans', sans-serif";
  hudCtx.fillStyle = "rgba(255,255,255,0.74)";
  const slowActive = performance.now() < slowUntil;
  const status = slowActive ? "Замедление активно" : "Скорость базовая";
  hudCtx.fillText(status, 28, 170);

  hudCtx.fillStyle = "#8ef0b5";
  hudCtx.fillText("Управление: стрелки/WASD или свайпы. Space — прыжок, Shift — подкоп.", 28, 210);

  hudTexture.needsUpdate = true;
}

function drawMessage(): void {
  messageCtx.clearRect(0, 0, messageCanvas.width, messageCanvas.height);
  if (!messageVisible) {
    messageTexture.needsUpdate = true;
    return;
  }
  const gradient = messageCtx.createLinearGradient(0, 0, messageCanvas.width, messageCanvas.height);
  gradient.addColorStop(0, "rgba(10,14,24,0.92)");
  gradient.addColorStop(1, "rgba(12,16,28,0.88)");
  messageCtx.fillStyle = gradient;
  roundRect(messageCtx, 20, 20, messageCanvas.width - 40, messageCanvas.height - 40, 22);
  messageCtx.fill();
  messageCtx.strokeStyle = "rgba(255,255,255,0.08)";
  messageCtx.lineWidth = 2;
  roundRect(messageCtx, 22, 22, messageCanvas.width - 44, messageCanvas.height - 44, 20);
  messageCtx.stroke();
  messageCtx.fillStyle = "#f3f4f6";
  messageCtx.font = "700 34px 'Space Grotesk', 'Fira Sans', sans-serif";
  messageCtx.fillText(messageText, 44, messageCanvas.height / 2);
  messageCtx.font = "500 18px 'Space Grotesk', 'Fira Sans', sans-serif";
  messageCtx.fillStyle = "rgba(255,255,255,0.78)";
  messageCtx.fillText("Тапните или нажмите Enter, чтобы продолжить", 44, messageCanvas.height / 2 + 38);
  messageTexture.needsUpdate = true;
}

function drawControlsOverlay(): void {
  controlsCtx.clearRect(0, 0, controlsCanvas.width, controlsCanvas.height);
  const padRadius = 120;
  controlsCtx.globalAlpha = 0.55;
  controlsCtx.fillStyle = "rgba(19, 26, 38, 0.7)";
  controlsCtx.strokeStyle = "rgba(255,255,255,0.1)";
  controlsCtx.lineWidth = 3;
  controlsCtx.beginPath();
  controlsCtx.arc(padRadius + 16, controlsCanvas.height - padRadius, padRadius, 0, Math.PI * 2);
  controlsCtx.fill();
  controlsCtx.stroke();
  controlsCtx.globalAlpha = 1;

  controlsCtx.fillStyle = "#9ae6b4";
  controlsCtx.font = "600 18px 'Space Grotesk', 'Fira Sans', sans-serif";
  controlsCtx.fillText("Свайпните для поворота", 16, controlsCanvas.height - padRadius * 2);

  const buttonY = controlsCanvas.height - 110;
  drawButton(controlsCtx, controlsCanvas.width - 120, buttonY - 20, 70, "Прыжок");
  drawButton(controlsCtx, controlsCanvas.width - 300, buttonY + 20, 60, "Подкоп");
  controlsTexture.needsUpdate = true;
}

function drawButton(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  label: string,
): void {
  const gradient = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, r * 0.3, x, y, r);
  gradient.addColorStop(0, "rgba(49, 205, 144, 0.9)");
  gradient.addColorStop(1, "rgba(26, 96, 71, 0.85)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0b120f";
  ctx.font = "700 16px 'Space Grotesk', 'Fira Sans', sans-serif";
  const textWidth = ctx.measureText(label).width;
  ctx.fillText(label, x - textWidth / 2, y + 6);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function canEnterCell(cell: Point, mode: "normal" | "jump" | "burrow"): boolean {
  if (isOutOfBounds(cell)) return false;
  const obstacle = obstacleAt(cell);
  if (!obstacle) return true;
  const rule = obstacleRules[obstacle];
  if (mode === "normal") return !rule.normalBlocked;
  if (mode === "jump") return rule.jumpAllowed;
  return rule.burrowAllowed;
}

function tryChangeDirection(requested: Direction): void {
  const reversing =
    requested.x + direction.x === 0 && requested.y + direction.y === 0;
  if (reversing) return;
  nextDirection = requested;
}

function queueAction(action: ActionKind): void {
  const now = performance.now();
  if (action === "jump" && now < jumpCooldownUntil) return;
  if (action === "burrow" && now < burrowCooldownUntil) return;
  queuedAction = action;
}

function performStep(): void {
  if (snake.length === 0) return;
  direction = nextDirection;
  const head = snake[0]!;
  const now = performance.now();
  let path: Point[] = [];
  let mode: "normal" | "jump" | "burrow" = "normal";
  if (queuedAction === "jump") {
    mode = "jump";
    path = [];
    for (let i = 1; i <= settings.jumpDistance; i += 1) {
      path.push({ x: head.x + direction.x * i, y: head.y + direction.y * i });
    }
    actionWave = { type: "jump", progress: 0, duration: 0.6 };
    queuedAction = null;
    jumpCooldownUntil = now + settings.jumpCooldown;
    soundscape.blip(680, 0.14, 0.3);
  } else if (queuedAction === "burrow") {
    mode = "burrow";
    path = [];
    for (let i = 1; i <= settings.jumpDistance; i += 1) {
      path.push({ x: head.x + direction.x * i, y: head.y + direction.y * i });
    }
    actionWave = { type: "burrow", progress: 0, duration: 0.7 };
    queuedAction = null;
    burrowCooldownUntil = now + settings.burrowCooldown;
    soundscape.blip(180, 0.2, 0.3);
  } else {
    path = [{ x: head.x + direction.x, y: head.y + direction.y }];
  }

  if (path.length === 0) return;

  for (const cell of path) {
    if (!canEnterCell(cell, mode)) {
      handleCrash("Столкновение.");
      return;
    }
  }

  const landing = path[path.length - 1]!;
  if (isOnSnake(landing)) {
    handleCrash("Хвост перекрыл путь.");
    return;
  }

  const found = collectibles.find(
    (c) => c.position.x === landing.x && c.position.y === landing.y,
  );
  const grow = found?.type === "apple" || found?.type === "life";
  snake = [landing, ...snake];
  if (!grow) {
    snake.pop();
  }

  if (found) {
    collectibleGroup.remove(found.mesh);
    collectibles = collectibles.filter((c) => c.id !== found.id);
    applyCollectible(found.type);
  }

  syncSnakeMeshes();
  hudDirty = true;
  checkWin();
}

function applyCollectible(type: CollectibleType): void {
  switch (type) {
    case "apple":
      appleEaten += 1;
      score += 1;
      spawnCollectible("apple");
      soundscape.pickup();
      break;
    case "life":
      lives += 1;
      soundscape.pickup();
      break;
    case "slow":
      slowUntil = performance.now() + 9000;
      soundscape.slow();
      break;
    case "artifact":
      artifactsCollected += 1;
      score += 2;
      soundscape.pickup();
      if (artifactsCollected < currentLevel.artifactsGoal) {
        spawnCollectible("artifact");
      }
      break;
  }
}

function handleCrash(reason: string): void {
  gamePhase = "exploding";
  messageText = `${reason} Жизни: ${lives}.`;
  messageVisible = true;
  drawMessage();
  snakeGroup.visible = false;
  startExplosion();
  soundscape.explode();
}

function startExplosion(): void {
  clearExplosion();
  physicsWorld = new World({ gravity: new Vec3(0, -18, 0) });
  physicsWorld.defaultContactMaterial.friction = 0.35;
  physicsWorld.defaultContactMaterial.restitution = 0.22;
  physicsWorld.addContactMaterial(
    new ContactMaterial(physicsMaterials.segment, physicsMaterials.floor, {
      friction: 0.38,
      restitution: 0.32,
    }),
  );

  const ground = new Body({
    mass: 0,
    shape: new Plane(),
    material: physicsMaterials.floor,
  });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  physicsWorld.addBody(ground);

  const shape = new Box(new Vec3(halfSegment, halfSegment, halfSegment));
  const blastOrigin = toWorld(snake[0]!, halfSegment);
  snake.forEach((segment, index) => {
    const mesh = new THREE.Mesh(segmentGeometry, index === 0 ? headMaterial : bodyMaterial);
    mesh.castShadow = true;
    debrisGroup.add(mesh);
    const world = toWorld(segment, halfSegment);
    const body = new Body({
      mass: 1.1,
      shape,
      position: new Vec3(world.x, world.y + 0.35, world.z),
      material: physicsMaterials.segment,
      angularDamping: 0.05,
      linearDamping: 0.01,
    });
    const spread = 6;
    body.velocity.set(
      (Math.random() - 0.5) * spread,
      5 + Math.random() * 2,
      (Math.random() - 0.5) * spread,
    );
    body.angularVelocity.set(
      (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 6,
    );
    physicsWorld?.addBody(body);
    debrisPieces.push({ mesh, body });
  });

  const shaderMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uNoise: { value: noiseTexture },
      uColor: { value: new THREE.Color(0xffc475) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform sampler2D uNoise;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float t = uTime;
        vec2 uv = vUv * 2.0 - 1.0;
        float dist = length(uv);
        float noise = texture2D(uNoise, vUv * 2.0 + t * 0.6).r;
        float ring = smoothstep(0.45 + t * 0.6, 0.1 + t * 0.3, dist);
        float glow = (1.0 - smoothstep(0.0, 1.0, dist * 1.1 + t * 0.4)) * 0.9;
        float alpha = (ring + glow * (0.5 + noise * 0.5)) * (1.0 - t * 0.8);
        if (alpha < 0.02) discard;
        gl_FragColor = vec4(uColor * (1.0 + noise), alpha);
      }
    `,
  });
  const blast = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), shaderMaterial);
  blast.position.copy(blastOrigin);
  blast.rotation.x = -Math.PI / 2;
  effectGroup.add(blast);
  explosionFx = { mesh: blast, time: 0 };
}

function clearExplosion(): void {
  debrisPieces = [];
  while (debrisGroup.children.length > 0) {
    const child = debrisGroup.children[0]!;
    debrisGroup.remove(child);
  }
  physicsWorld = null;
  if (explosionFx) {
    effectGroup.remove(explosionFx.mesh);
    explosionFx.mesh.geometry.dispose();
    if (Array.isArray(explosionFx.mesh.material)) {
      explosionFx.mesh.material.forEach((m) => m.dispose());
    } else {
      explosionFx.mesh.material.dispose();
    }
    explosionFx = null;
  }
}

function finishCrash(): void {
  if (lives > 0) {
    lives -= 1;
    startLevel(currentLevelIndex, true);
  } else {
    lives = 2;
    currentLevelIndex = 0;
    score = 0;
    startLevel(currentLevelIndex);
  }
}

function checkWin(): void {
  if (appleEaten >= currentLevel.applesGoal && artifactsCollected >= currentLevel.artifactsGoal) {
    gamePhase = "transition";
    messageText = `Уровень ${currentLevelIndex + 1} пройден!`;
    messageVisible = true;
    drawMessage();
    transitionTimer = 1.4;
  }
}

function startLevel(index: number, autoStart = false): void {
  currentLevelIndex = index % levels.length;
  const level = levels[currentLevelIndex]!;
  currentLevel = level;
  tickInterval = currentLevel.tickMs / 1000;
  appleEaten = 0;
  artifactsCollected = 0;
  accumulator = 0;
  actionWave = null;
  snakeGroup.visible = true;
  obstacles = buildObstacles(currentLevel);
  updateBoardGeometry();
  addObstacleMeshes();
  clearCollectibles();
  resetSnake();
  spawnCollectible("apple");
  for (let i = 0; i < (currentLevel.artifactsGoal > 0 ? 1 : 0); i += 1) {
    spawnCollectible("artifact");
  }
  if (currentLevel.bonusLives) {
    for (let i = 0; i < currentLevel.bonusLives; i += 1) spawnCollectible("life");
  }
  if (currentLevel.bonusSlows) {
    for (let i = 0; i < currentLevel.bonusSlows; i += 1) spawnCollectible("slow");
  }
  messageText = `Уровень ${currentLevelIndex + 1}. ${currentLevel.title}`;
  messageVisible = true;
  drawMessage();
  hudDirty = true;
  queuedAction = null;
  jumpCooldownUntil = 0;
  burrowCooldownUntil = 0;
  gamePhase = "menu";
  if (autoStart) {
    startRun();
  }
}

function startRun(): void {
  soundscape.ensure();
  soundscape.resume();
  soundscape.playAmbient();
  messageVisible = false;
  drawMessage();
  gamePhase = "playing";
}

const directionsByKey: Record<string, Direction> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  KeyW: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
};

window.addEventListener("keydown", (event) => {
  const requested = directionsByKey[event.code];
  if (requested) {
    event.preventDefault();
    if (gamePhase === "playing") {
      tryChangeDirection(requested);
    }
  } else if (event.code === "Space") {
    event.preventDefault();
    if (gamePhase === "playing") {
      queueAction("jump");
    } else {
      startRun();
    }
  } else if (event.code === "ShiftLeft" || event.code === "ShiftRight" || event.code === "ControlLeft") {
    if (gamePhase === "playing") {
      queueAction("burrow");
    }
  } else if (event.code === "Enter") {
    if (gamePhase !== "playing") startRun();
  }
});

let activePointerId: number | null = null;
let swipeStart: { x: number; y: number } | null = null;

function pointerToUi(point: { x: number; y: number }): { x: number; y: number } {
  return {
    x: point.x,
    y: point.y,
  };
}

function handlePointerDown(event: PointerEvent): void {
  activePointerId = event.pointerId;
  swipeStart = { x: event.clientX, y: event.clientY };
  const pos = pointerToUi({ x: event.clientX, y: event.clientY });
  const jumpDist = distance(pos, controlZones.jump);
  const burrowDist = distance(pos, controlZones.burrow);
  if (jumpDist < controlZones.jump.r) {
    queueAction("jump");
  } else if (burrowDist < controlZones.burrow.r) {
    queueAction("burrow");
  }
  if (gamePhase !== "playing") {
    startRun();
  }
}

function handlePointerMove(event: PointerEvent): void {
  if (activePointerId !== event.pointerId || !swipeStart) return;
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  if (Math.abs(dx) > 28 || Math.abs(dy) > 28) {
    if (Math.abs(dx) > Math.abs(dy)) {
      tryChangeDirection({ x: dx > 0 ? 1 : -1, y: 0 });
    } else {
      tryChangeDirection({ x: 0, y: dy > 0 ? 1 : -1 });
    }
    swipeStart = { x: event.clientX, y: event.clientY };
  }
}

function handlePointerUp(event: PointerEvent): void {
  if (event.pointerId === activePointerId) {
    activePointerId = null;
    swipeStart = null;
  }
}

sceneContainer.addEventListener("pointerdown", handlePointerDown);
sceneContainer.addEventListener("pointermove", handlePointerMove);
sceneContainer.addEventListener("pointerup", handlePointerUp);
sceneContainer.addEventListener("pointercancel", handlePointerUp);

function distance(a: { x: number; y: number }, b: { x: number; y: number; r?: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function updateCamera(delta: number): void {
  if (snake.length === 0) return;
  const head = toWorld(snake[0]!, halfSegment);
  cameraTarget.set(head.x, halfSegment * 0.5, head.z);
  const distance = Math.max(boardWidth, boardDepth) * (currentLevel.columns > 24 ? 0.55 : 0.42);
  const desired = new THREE.Vector3(head.x + boardWidth * 0.18, currentLevel.cameraHeight, head.z + distance * 0.6);
  camera.position.lerp(desired, 1 - Math.pow(0.0001, delta));
  cameraLook.lerp(cameraTarget, 1 - Math.pow(0.0001, delta));
  camera.lookAt(cameraLook);
}

function updateHudIfNeeded(): void {
  if (hudDirty) {
    drawHud();
    hudDirty = false;
  }
}

function animate(now: number): void {
  const delta = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  const effectiveTick =
    (performance.now() < slowUntil ? currentLevel.tickMs * 1.6 : currentLevel.tickMs) / 1000;
  tickInterval = effectiveTick;

  if (gamePhase === "playing") {
    accumulator += delta;
    while (accumulator >= tickInterval) {
      performStep();
      accumulator -= tickInterval;
    }
  } else if (gamePhase === "transition") {
    transitionTimer -= delta;
    if (transitionTimer <= 0) {
      startLevel(currentLevelIndex + 1, true);
    }
  }

  if (actionWave) {
    actionWave.progress += delta / actionWave.duration;
    if (actionWave.progress >= 1.1) {
      actionWave = null;
    }
  }

  if (physicsWorld) {
    physicsWorld.step(1 / 60, delta, 3);
    debrisPieces.forEach(({ mesh, body }) => {
      mesh.position.set(body.position.x, body.position.y, body.position.z);
      mesh.quaternion.set(
        body.quaternion.x,
        body.quaternion.y,
        body.quaternion.z,
        body.quaternion.w,
      );
    });
  }

  if (explosionFx) {
    explosionFx.time += delta;
    const material = explosionFx.mesh.material;
    if (material instanceof THREE.ShaderMaterial) {
      if (material.uniforms.uTime) {
        material.uniforms.uTime.value = explosionFx.time;
      }
    }
    if (explosionFx.time > 1.4) {
      clearExplosion();
      finishCrash();
    }
  }

  collectibles.forEach((c) => {
    const offset = Math.sin(now * 0.002 + c.bobOffset) * 0.2 + (c.type === "artifact" ? 0.25 : 0);
    c.mesh.position.y = halfSegment + offset;
    c.mesh.rotation.y += delta * 0.7;
  });

  updateCamera(delta);
  syncSnakeMeshes();
  updateHudIfNeeded();

  renderer.clear();
  renderer.render(worldScene, camera);
  renderer.clearDepth();
  renderer.render(uiScene, uiCamera);

  requestAnimationFrame(animate);
}

startLevel(0);
resizeRenderer();
drawHud();
drawMessage();
drawControlsOverlay();
requestAnimationFrame(animate);
