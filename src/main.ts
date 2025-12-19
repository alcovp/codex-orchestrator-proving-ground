import { createWorldScene } from "./scene";
import { maps, worldSettings } from "./settings";
import type { GamePhase, GameSession, MapDefinition } from "./types";

function requireElement<T extends Element>(el: T | null, name: string): T {
  if (!el) {
    throw new Error(`Не найден элемент: ${name}`);
  }
  return el;
}

const canvasElement = requireElement(
  document.querySelector<HTMLCanvasElement>("#game"),
  "#game",
);
const mapSelect = requireElement(
  document.querySelector<HTMLSelectElement>("#map-select"),
  "#map-select",
);
const createButton = requireElement(
  document.querySelector<HTMLButtonElement>("#create-game"),
  "#create-game",
);
const startButton = requireElement(
  document.querySelector<HTMLButtonElement>("#start-game"),
  "#start-game",
);
const menuScreen = requireElement(
  document.querySelector<HTMLElement>("#menu-screen"),
  "#menu-screen",
);
const hud = requireElement(
  document.querySelector<HTMLElement>("#hud"),
  "#hud",
);
const hudMapName = requireElement(
  document.querySelector<HTMLElement>("#hud-map-name"),
  "#hud-map-name",
);
const hudStatus = requireElement(
  document.querySelector<HTMLElement>("#hud-status"),
  "#hud-status",
);
const selectionRect = requireElement(
  document.querySelector<HTMLElement>("#selection-rect"),
  "#selection-rect",
);
const lobbyStatus = requireElement(
  document.querySelector<HTMLElement>("#lobby-status"),
  "#lobby-status",
);
const backToMenuButton = requireElement(
  document.querySelector<HTMLButtonElement>("#back-to-menu"),
  "#back-to-menu",
);
const restartButton = requireElement(
  document.querySelector<HTMLButtonElement>("#restart-game"),
  "#restart-game",
);

const scene = createWorldScene(canvasElement, worldSettings);
const emptyMap: MapDefinition = {
  id: "empty",
  name: "Пусто",
  description: "Заглушка карты",
  size: { width: 60, height: 60 },
  tileSize: 6,
  startLocations: [],
  resources: [],
};
const initialMap: MapDefinition = maps[0] ?? emptyMap;

maps.forEach((map) => {
  const option = document.createElement("option");
  option.value = map.id;
  option.textContent = `${map.name} — ${map.description}`;
  mapSelect.appendChild(option);
});

let phase: GamePhase = "menu";
let session: GameSession | null = null;
let preparedMap: MapDefinition | null = initialMap ?? null;
let isDraggingSelection = false;
let selectionStart: { x: number; y: number } | null = null;

function findMapById(id: string): MapDefinition | null {
  return maps.find((map) => map.id === id) ?? null;
}

function hideSelectionRect(): void {
  selectionRect.dataset.active = "false";
  selectionRect.style.width = "0px";
  selectionRect.style.height = "0px";
}

function showSelectionRect(
  start: { x: number; y: number },
  current: { x: number; y: number },
): void {
  const left = Math.min(start.x, current.x);
  const top = Math.min(start.y, current.y);
  const width = Math.abs(current.x - start.x);
  const height = Math.abs(current.y - start.y);
  if (width < 2 && height < 2) {
    selectionRect.dataset.active = "false";
    return;
  }
  selectionRect.style.left = `${left}px`;
  selectionRect.style.top = `${top}px`;
  selectionRect.style.width = `${width}px`;
  selectionRect.style.height = `${height}px`;
  selectionRect.dataset.active = "true";
}

function setPhase(next: GamePhase): void {
  phase = next;
  const playing = phase === "playing";
  menuScreen.hidden = playing;
  hud.hidden = !playing;
  scene.setInputEnabled(playing);
  if (!playing) {
    hideSelectionRect();
  }
}

function updateHud(map: MapDefinition): void {
  hudMapName.textContent = map.name;
  hudStatus.textContent =
    "Пустынные тайлы, стартовые площадки и залежи спайса размечены. Камера: WASD/края экрана, колесо — зум. ЛКМ + выделение рамкой.";
}

function createLobby(): void {
  const selected = findMapById(mapSelect.value) ?? initialMap;
  preparedMap = selected ?? null;
  if (preparedMap) {
    lobbyStatus.textContent = `Лобби создано: ${preparedMap.name}`;
    lobbyStatus.dataset.state = "ready";
  } else {
    lobbyStatus.textContent = "Не удалось выбрать карту";
    lobbyStatus.dataset.state = "error";
  }
}

function startSession(mapOverride?: MapDefinition | null): void {
  const map = mapOverride ?? preparedMap ?? initialMap;
  if (!map) {
    lobbyStatus.textContent = "Нет доступных карт для запуска";
    lobbyStatus.dataset.state = "error";
    return;
  }
  scene.setMap(map);
  session = { map, startedAt: performance.now() };
  updateHud(map);
  setPhase("playing");
}

function backToMenu(): void {
  session = null;
  preparedMap = initialMap ?? null;
  setPhase("menu");
  lobbyStatus.textContent = "Выберите карту и создайте игру.";
  lobbyStatus.dataset.state = "idle";
}

function beginSelectionDrag(event: PointerEvent): void {
  if (phase !== "playing" || event.button !== 0) {
    return;
  }
  selectionStart = { x: event.clientX, y: event.clientY };
  isDraggingSelection = true;
  hideSelectionRect();
  canvasElement.setPointerCapture(event.pointerId);
}

function updateSelectionDrag(event: PointerEvent): void {
  if (!isDraggingSelection || !selectionStart || phase !== "playing") {
    return;
  }
  showSelectionRect(selectionStart, { x: event.clientX, y: event.clientY });
}

function endSelectionDrag(event?: PointerEvent): void {
  if (event && canvasElement.hasPointerCapture(event.pointerId)) {
    canvasElement.releasePointerCapture(event.pointerId);
  }
  isDraggingSelection = false;
  selectionStart = null;
  hideSelectionRect();
}

function onCanvasPointerUp(event: PointerEvent): void {
  if (event.button !== 0) {
    return;
  }
  if (isDraggingSelection) {
    endSelectionDrag(event);
  }
}

createButton.addEventListener("click", () => createLobby());
startButton.addEventListener("click", () => startSession());
backToMenuButton.addEventListener("click", () => backToMenu());
restartButton.addEventListener("click", () =>
  startSession(session ? session.map : preparedMap),
);
canvasElement.addEventListener("pointerdown", (event) => beginSelectionDrag(event));
canvasElement.addEventListener("pointermove", (event) => updateSelectionDrag(event));
canvasElement.addEventListener("pointerup", (event) => onCanvasPointerUp(event));
canvasElement.addEventListener("pointercancel", (event) => endSelectionDrag(event));

window.addEventListener("resize", () => scene.resize());

let isRunning = true;
function renderLoop(): void {
  if (!isRunning) {
    return;
  }
  scene.render();
  window.requestAnimationFrame(renderLoop);
}

backToMenu();
scene.setMap(initialMap);
renderLoop();
