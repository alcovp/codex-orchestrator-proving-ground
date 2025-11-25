import * as THREE from "three";
import {
  Body,
  Box,
  ContactMaterial,
  Material,
  Plane,
  Vec3,
  World,
} from "cannon-es";

type Point = { x: number; y: number };
type GamePhase = "menu" | "playing" | "exploding";

const settings = {
  columns: 18,
  rows: 18,
  tickMs: 140,
  unit: 1.2,
};

const sceneContainer = document.getElementById("scene-container");
const overlay = document.getElementById("menu-overlay");
const startButton = document.getElementById("start-button");
const menuMessage = document.getElementById("menu-message");
const stateIndicator = document.getElementById("state-indicator");
const scoreValue = document.getElementById("score-value");

if (!(sceneContainer instanceof HTMLDivElement)) {
  throw new Error("Не найден контейнер для сцены");
}
if (
  !(overlay instanceof HTMLDivElement) ||
  !(startButton instanceof HTMLButtonElement) ||
  !(menuMessage instanceof HTMLElement)
) {
  throw new Error("Не найдены элементы меню");
}
if (!(stateIndicator instanceof HTMLElement) || !(scoreValue instanceof HTMLElement)) {
  throw new Error("Не найдены элементы HUD");
}

const boardWidth = settings.columns * settings.unit;
const boardDepth = settings.rows * settings.unit;
const segmentSize = settings.unit * 0.9;
const halfSegment = segmentSize / 2;
const tickInterval = settings.tickMs / 1000;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
renderer.shadowMap.enabled = true;
sceneContainer.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
scene.fog = new THREE.Fog(0x05070d, 16, 60);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
const cameraTarget = new THREE.Vector3(0, 0.2, 0);

function updateRendererSize(): void {
  const { clientWidth, clientHeight } = sceneContainer;
  renderer.setSize(clientWidth, clientHeight);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
}

function positionCamera(): void {
  const distance = Math.max(boardWidth, boardDepth) * 0.9;
  camera.position.set(boardWidth * 0.25, distance, distance);
  camera.lookAt(cameraTarget);
}

window.addEventListener("resize", updateRendererSize);

const ambient = new THREE.AmbientLight(0xdde6ff, 0.55);
const mainLight = new THREE.DirectionalLight(0xffffff, 0.95);
mainLight.position.set(-12, 18, 8);
mainLight.castShadow = true;
mainLight.shadow.mapSize.set(1024, 1024);
mainLight.shadow.camera.far = 80;
const rimLight = new THREE.DirectionalLight(0x7c6bff, 0.4);
rimLight.position.set(14, 12, -8);
scene.add(ambient, mainLight, rimLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(boardWidth + 4, boardDepth + 4),
  new THREE.MeshStandardMaterial({
    color: 0x0b1221,
    roughness: 0.92,
    metalness: 0.05,
  }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(boardWidth, settings.columns, 0x2f3a52, 0x1e2535);
grid.position.y = 0.02;
if (!Array.isArray(grid.material)) {
  grid.material.transparent = true;
  grid.material.opacity = 0.22;
}
scene.add(grid);

const segmentGeometry = new THREE.BoxGeometry(segmentSize, segmentSize, segmentSize);
const headMaterial = new THREE.MeshStandardMaterial({
  color: 0x22c55e,
  emissive: 0x0e2c1b,
  roughness: 0.35,
  metalness: 0.15,
});
const bodyMaterial = new THREE.MeshStandardMaterial({
  color: 0x4ade80,
  emissive: 0x113322,
  roughness: 0.45,
  metalness: 0.08,
});

const appleGeometry = new THREE.SphereGeometry(segmentSize * 0.35, 22, 22);
const appleMaterial = new THREE.MeshStandardMaterial({
  color: 0xf43f5e,
  emissive: 0x661525,
  roughness: 0.38,
  metalness: 0.2,
});
const appleMesh = new THREE.Mesh(appleGeometry, appleMaterial);
appleMesh.castShadow = true;
appleMesh.position.y = halfSegment;
scene.add(appleMesh);

const snakeGroup = new THREE.Group();
scene.add(snakeGroup);
const snakeMeshes: THREE.Mesh[] = [];

const debrisGroup = new THREE.Group();
scene.add(debrisGroup);

type Debris = { mesh: THREE.Mesh; body: Body };
let physicsWorld: World | null = null;
let debrisPieces: Debris[] = [];
const physicsMaterials = {
  floor: new Material("floor"),
  segment: new Material("segment"),
};

let snake: Point[] = [];
let apple: Point = { x: 0, y: 0 };
let direction: Point = { x: 1, y: 0 };
let nextDirection: Point = { x: 1, y: 0 };
let score = 0;
let gamePhase: GamePhase = "menu";
let accumulator = 0;
let lastFrame = performance.now();

const stateLabels: Record<GamePhase, string> = {
  menu: "Меню",
  playing: "Идёт игра",
  exploding: "Поражение",
};

function toWorld(point: Point, height = halfSegment): THREE.Vector3 {
  return new THREE.Vector3(
    -boardWidth / 2 + settings.unit * point.x + settings.unit / 2,
    height,
    -boardDepth / 2 + settings.unit * point.y + settings.unit / 2,
  );
}

function isOutOfBounds(point: Point): boolean {
  return (
    point.x < 0 || point.y < 0 || point.x >= settings.columns || point.y >= settings.rows
  );
}

function isOnSnake(point: Point): boolean {
  return snake.some((segment) => segment.x === point.x && segment.y === point.y);
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
    if (!mesh) {
      return;
    }
    mesh.material = index === 0 ? headMaterial : bodyMaterial;
    mesh.position.copy(toWorld(segment));
  });
}

function placeApple(): void {
  const world = toWorld(apple, halfSegment);
  appleMesh.position.x = world.x;
  appleMesh.position.z = world.z;
}

function updateHud(): void {
  stateIndicator.textContent = stateLabels[gamePhase];
  scoreValue.textContent = score.toString();
}

function showOverlay(message: string, buttonLabel: string): void {
  menuMessage.textContent = message;
  startButton.textContent = buttonLabel;
  overlay.classList.add("overlay--visible");
}

function hideOverlay(): void {
  overlay.classList.remove("overlay--visible");
}

function resetSnake(): void {
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
  syncSnakeMeshes();
  placeApple();
  accumulator = 0;
}

function clearExplosion(): void {
  debrisPieces = [];
  while (debrisGroup.children.length > 0) {
    const child = debrisGroup.children[0];
    debrisGroup.remove(child);
  }
  physicsWorld = null;
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
}

function setPhase(phase: GamePhase): void {
  gamePhase = phase;
  updateHud();
}

function handleCrash(reason: string): void {
  setPhase("exploding");
  snakeGroup.visible = false;
  showOverlay(`${reason} Счёт: ${score}.`, "Сыграть ещё");
  startExplosion();
}

function stepSnake(): void {
  direction = nextDirection;
  const head = snake[0];
  const newHead: Point = { x: head.x + direction.x, y: head.y + direction.y };

  if (isOutOfBounds(newHead) || isOnSnake(newHead)) {
    handleCrash("Столкновение.");
    return;
  }

  const ateApple = newHead.x === apple.x && newHead.y === apple.y;
  snake = [newHead, ...snake];
  if (!ateApple) {
    snake.pop();
  } else {
    score += 1;
    apple = spawnApple();
    placeApple();
  }

  syncSnakeMeshes();
  updateHud();
}

function startRun(): void {
  score = 0;
  setPhase("playing");
  snakeGroup.visible = true;
  hideOverlay();
  clearExplosion();
  resetSnake();
  updateHud();
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
    if (gamePhase === "playing") {
      tryChangeDirection(requested);
    }
  } else if (event.key === " " && gamePhase !== "playing") {
    event.preventDefault();
    startRun();
  }
});

startButton.addEventListener("click", () => {
  startRun();
});

function animate(now: number): void {
  const delta = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;

  if (gamePhase === "playing") {
    accumulator += delta;
    while (accumulator >= tickInterval) {
      stepSnake();
      accumulator -= tickInterval;
    }
  }

  if (gamePhase === "exploding" && physicsWorld) {
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

  const wobble = Math.sin(now * 0.004) * 0.12;
  appleMesh.position.y = halfSegment + wobble + 0.05;
  appleMesh.rotation.y += delta * 0.8;

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

positionCamera();
updateRendererSize();
resetSnake();
placeApple();
updateHud();
requestAnimationFrame(animate);
