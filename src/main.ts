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
type OverlayMode = "start" | "gameover" | "paused" | null;
type UiButtonId = "primary" | "pause" | "jump" | "burrow";
type UiButton = {
  id: UiButtonId;
  rect: { x: number; y: number; w: number; h: number };
  visible: boolean;
};
type Buff = { label: string; remainingMs: number; color: string };

const settings = {
  columns: 16,
  rows: 16,
  tileSize: 1,
  tickMs: 160,
  baseLives: 3,
};

const colors = {
  background: "#0b0f16",
  grid: "#1e2533",
  snake: "#4ade80",
  snakeHead: "#22c55e",
  apple: "#f43f5e",
  floor: "#0f172a",
  hudAccent: "#7dd3fc",
  hudAccent2: "#c084fc",
  hudPanel: "rgba(12, 18, 26, 0.78)",
};

const canvasElement = document.getElementById("game");
if (!(canvasElement instanceof HTMLCanvasElement)) {
  throw new Error('Не найден canvas с id="game"');
}
const canvas = canvasElement;

const stateLabelByState: Record<GameState, string> = {
  idle: "Ожидание",
  playing: "Игра",
  paused: "Пауза",
  exploding: "Взрыв",
};

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, canvas });
renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(colors.background);

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

const boardWidth = settings.columns * settings.tileSize;
const boardDepth = settings.rows * settings.tileSize;
const camera = new THREE.PerspectiveCamera(
  55,
  canvas.clientWidth / Math.max(1, canvas.clientHeight),
  0.1,
  240,
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

const gridHelper = new THREE.GridHelper(
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

const appleGeometry = new THREE.SphereGeometry(
  settings.tileSize * 0.35,
  22,
  22,
);
const appleMaterial = new THREE.MeshStandardMaterial({
  color: colors.apple,
  emissive: new THREE.Color(colors.apple).multiplyScalar(0.2),
  roughness: 0.15,
});
const appleMesh = new THREE.Mesh(appleGeometry, appleMaterial);
appleMesh.castShadow = false;
scene.add(appleMesh);

let direction: Cell = { x: 1, y: 0 };
let nextDirection: Cell = { x: 1, y: 0 };
let snake: Cell[] = [];
let apple: Cell = { x: 0, y: 0 };
let gameState: GameState = "idle";
let overlayMode: OverlayMode = "start";
let score = 0;
let lives = settings.baseLives;

let physicsWorld: World | null = null;
let physicsBodies: Body[] = [];
let explosionTimeoutId: number | null = null;

let tickAccumulatorMs = 0;
let lastFrame = performance.now();

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

function setGameState(next: GameState): void {
  gameState = next;
  if (next === "playing") {
    overlayMode = null;
  } else if (next === "paused") {
    overlayMode = "paused";
  } else if (next === "idle" && overlayMode === null) {
    overlayMode = "start";
  }
  markHudDirty();
}

function spawnApple(): Cell {
  const freeCells: Cell[] = [];
  for (let y = 0; y < settings.rows; y += 1) {
    for (let x = 0; x < settings.columns; x += 1) {
      const candidate = { x, y };
      if (!snake.some((segment) => segment.x === x && segment.y === y)) {
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
  });
  applyWaveOffsets();
}

function updateAppleMesh(): void {
  const worldPos = gridToWorld(apple);
  appleMesh.position.copy(worldPos);
}

function resetRound(): void {
  destroyPhysicsWorld();
  direction = { x: 1, y: 0 };
  nextDirection = { x: 1, y: 0 };
  waveStrength = 0;
  waveMode = null;
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
  markHudDirty();
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
  activeBuffs = [];
  overlayMode = null;
  setGameState("playing");
  resetRound();
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

function triggerJump(): void {
  if (gameState !== "playing" || jumpCooldownMs > 0) {
    return;
  }
  waveMode = "jump";
  waveStrength = 1;
  waveTime = 0;
  jumpCooldownMs = 900;
  addBuff("Прыжок", colors.hudAccent, 1200);
  markHudDirty();
}

function triggerBurrow(): void {
  if (gameState !== "playing" || burrowCooldownMs > 0) {
    return;
  }
  waveMode = "burrow";
  waveStrength = 1;
  waveTime = 0;
  burrowCooldownMs = 900;
  addBuff("Под землю", colors.hudAccent2, 1200);
  markHudDirty();
}

function addBuff(label: string, color: string, durationMs: number): void {
  activeBuffs.push({ label, color, remainingMs: durationMs });
  buffRedrawTimerMs = 0;
  markHudDirty();
}

function triggerDeath(): void {
  if (gameState === "exploding") {
    return;
  }
  setGameState("exploding");
  overlayMode = "gameover";
  lives = Math.max(0, lives - 1);
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
  overlayMode = "gameover";
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

    const impulseStrength = 5 + Math.random() * 2.5;
    const impulse = new Vec3(
      (Math.random() - 0.5) * impulseStrength,
      impulseStrength * 0.85,
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

function isOutOfBounds(cell: Cell): boolean {
  return (
    cell.x < 0 ||
    cell.y < 0 ||
    cell.x >= settings.columns ||
    cell.y >= settings.rows
  );
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
  const newHead: Cell = { x: head.x + direction.x, y: head.y + direction.y };

  const isOnSnake = snake.some(
    (segment) => segment.x === newHead.x && segment.y === newHead.y,
  );
  if (isOutOfBounds(newHead) || isOnSnake) {
    triggerDeath();
    return;
  }

  const ateApple = newHead.x === apple.x && newHead.y === apple.y;
  snake = [newHead, ...snake];
  if (!ateApple) {
    snake.pop();
  } else {
    score += 1;
    addBuff("Энергия", "#f59e0b", 4200);
    apple = spawnApple();
    updateAppleMesh();
  }

  updateSnakeMeshesFromGrid();
  markHudDirty();
}

function updateCameraFocus(deltaSeconds: number): void {
  const head = snake[0];
  const followStrength = gameState === "playing" ? 0.12 : 0.08;
  if (head) {
    const headWorld = gridToWorld(head);
    cameraTarget.lerp(headWorld, followStrength);
  } else {
    cameraTarget.set(0, 0, 0);
  }
  const targetHeight = Math.max(boardWidth, boardDepth) * 0.55;
  const desiredPosition = new THREE.Vector3(
    cameraTarget.x + boardWidth * 0.32,
    targetHeight,
    cameraTarget.z + boardDepth * 0.35,
  );
  camera.position.lerp(desiredPosition, followStrength * (deltaSeconds * 60));
  camera.lookAt(cameraTarget.x, 0, cameraTarget.z);
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
    w: 210 * scale * hudScale,
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
  ctx.fillText("Статус", statusRect.x + 14 * scale * hudScale, statusRect.y + 12 * scale * hudScale);

  const stateValueSize = 20 * scale * hudScale;
  ctx.font = `700 ${stateValueSize}px "Inter", "Segoe UI", system-ui`;
  ctx.fillStyle = "#f8fafc";
  ctx.fillText(
    stateLabelByState[gameState],
    statusRect.x + 14 * scale * hudScale,
    statusRect.y + 30 * scale * hudScale,
  );

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
    x: cssWidth * hudScale - (220 * scale + margin) * hudScale,
    y: barY,
    w: 220 * scale * hudScale,
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
    ctx.fillText(
      "Баффы: пока пусто",
      buffAreaX,
      buffAreaY + chipHeight / 2,
    );
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

  // Mobile actions.
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
    const title =
      overlayMode === "paused"
        ? "Пауза"
        : overlayMode === "gameover"
          ? "Поражение"
          : "Змейка";
    ctx.fillText(title, cardRect.x + cardRect.w / 2, cardRect.y + 20 * scale * hudScale);

    ctx.fillStyle = "rgba(226, 232, 240, 0.82)";
    ctx.font = `500 ${14 * scale * hudScale}px "Inter", "Segoe UI", system-ui`;
    const subtitle =
      overlayMode === "paused"
        ? "Нажмите продолжить или сделайте двойной тап"
        : overlayMode === "gameover"
          ? "Змейка разбилась. Попробуйте ещё!"
          : "Свайпайте или тапайте для управления. Поехали!";
    ctx.fillText(
      subtitle,
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
    const btnLabel =
      overlayMode === "paused"
        ? "Продолжить"
        : overlayMode === "gameover"
          ? "Сыграть ещё"
          : "Начать";
    ctx.fillText(btnLabel, btnRect.x + btnRect.w / 2, btnRect.y + btnRect.h / 2);
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
  if (overlayMode === "paused") {
    setGameState("playing");
    overlayMode = null;
    markHudDirty();
    return;
  }
  if (overlayMode === "gameover" || overlayMode === "start") {
    startNewGame();
    return;
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
  } else if (gameState === "paused") {
    setGameState("playing");
    overlayMode = null;
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
    handlePrimaryAction();
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

  jumpCooldownMs = Math.max(0, jumpCooldownMs - deltaMs);
  burrowCooldownMs = Math.max(0, burrowCooldownMs - deltaMs);

  if (gameState === "playing") {
    tickAccumulatorMs += deltaMs;
    while (tickAccumulatorMs >= settings.tickMs) {
      tickAccumulatorMs -= settings.tickMs;
      stepGame();
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
  updateCameraFocus(deltaMs / 1000);
  resizeRenderer();

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

resizeRenderer();
resetRound();
markHudDirty();
setGameState("idle");
requestAnimationFrame(animate);
