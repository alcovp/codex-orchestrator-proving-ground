import { createWorldScene } from "./scene";
import { maps, worldSettings } from "./settings";
import type {
  GamePhase,
  GameSession,
  GameWorld,
  MapDefinition,
  Selection,
} from "./types";
import { createGameWorld, findSelection, updateGameWorld } from "./world";

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
const hudSpice = requireElement(
  document.querySelector<HTMLElement>("#hud-spice"),
  "#hud-spice",
);
const hudPower = requireElement(
  document.querySelector<HTMLElement>("#hud-power"),
  "#hud-power",
);
const hudSelectionName = requireElement(
  document.querySelector<HTMLElement>("#hud-selection-name"),
  "#hud-selection-name",
);
const hudSelectionDetails = requireElement(
  document.querySelector<HTMLElement>("#hud-selection-details"),
  "#hud-selection-details",
);
const hudProduction = requireElement(
  document.querySelector<HTMLElement>("#hud-production"),
  "#hud-production",
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
let world: GameWorld | null = null;
let currentSelection: Selection | null = null;
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

function updateHud(map: MapDefinition | null, worldState: GameWorld | null): void {
  hudMapName.textContent = map?.name ?? "Нет карты";
  const baseHint =
    "Камера: WASD/края экрана, колесо — зум. ЛКМ — выбор, рамка — множественный выбор.";
  if (!worldState) {
    hudStatus.textContent = "Создайте матч и нажмите «Начать». " + baseHint;
    hudSpice.textContent = "—";
    hudPower.textContent = "—";
    hudSelectionName.textContent = "Ничего не выбрано";
    hudSelectionDetails.textContent = "Выделите здание или юнит.";
    hudProduction.textContent = "";
    return;
  }
  const player = worldState.players.player;
  const activeNodes = worldState.resourceNodes.filter((node) => node.amount > 1);
  const minUnitCost = Math.min(
    ...Object.values(worldState.defs.units).map((def) => def.cost.spice),
  );
  let status = "Добыча спайса идет.";
  if (!activeNodes.length) {
    status = "Залежи спайса исчерпаны. Добыча остановлена.";
  } else if (player.spice < minUnitCost) {
    status = `Недостаточно спайса: минимум ${minUnitCost} для заказа юнитов.`;
  }
  hudStatus.textContent = `${status} ${baseHint}`;
  hudSpice.textContent = `${Math.floor(player.spice)} спайс`;
  hudPower.textContent = `${Math.floor(player.power)} энергия`;

  const target = currentSelection ? findSelection(worldState, currentSelection) : null;
  if (!target) {
    hudSelectionName.textContent = "Ничего не выбрано";
    hudSelectionDetails.textContent = "Кликните по объекту на поле.";
    hudProduction.textContent = "";
    return;
  }

  if ("queue" in target) {
    const def = worldState.defs.buildings[target.typeId];
    hudSelectionName.textContent = `${def.name} (${target.owner === "player" ? "Вы" : "ИИ"})`;
    hudSelectionDetails.textContent = `Прочность: ${Math.floor(target.hp)} / ${def.maxHp}`;
    if (target.queue.length) {
      const next = target.queue[0]!;
      const unitDef = worldState.defs.units[next.unitTypeId];
      const remaining = Math.max(0, Math.ceil((next.readyAt - performance.now()) / 1000));
      hudProduction.textContent = `В очереди: ${unitDef.name} • готов через ${remaining} с (${target.queue.length} шт.)`;
    } else {
      hudProduction.textContent = "Очередь пуста";
    }
  } else {
    const def = worldState.defs.units[target.typeId];
    hudSelectionName.textContent = `${def.name} (${target.owner === "player" ? "Вы" : "ИИ"})`;
    hudSelectionDetails.textContent = `Прочность: ${Math.floor(target.hp)} / ${def.maxHp}`;
    hudProduction.textContent = "";
  }
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
  world = createGameWorld(map, performance.now());
  currentSelection = null;
  scene.setMap(map);
  scene.updateWorld(world, currentSelection);
  session = { map, startedAt: performance.now() };
  updateHud(map, world);
  setPhase("playing");
}

function backToMenu(): void {
  session = null;
  world = null;
  currentSelection = null;
  preparedMap = initialMap ?? null;
  setPhase("menu");
  lobbyStatus.textContent = "Выберите карту и создайте игру.";
  lobbyStatus.dataset.state = "idle";
  updateHud(preparedMap, world);
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
    if (world && selectionRect.dataset.active === "true") {
      const rect = selectionRect.getBoundingClientRect();
      currentSelection = scene.pickInRect(rect);
      scene.updateWorld(world, currentSelection);
      updateHud(world.map, world);
      return;
    }
  }
  if (world) {
    currentSelection = scene.pick(event.clientX, event.clientY);
    scene.updateWorld(world, currentSelection);
    updateHud(world.map, world);
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
  const now = performance.now();
  if (phase === "playing" && world) {
    updateGameWorld(world, now);
    const resolved = currentSelection ? findSelection(world, currentSelection) : null;
    if (!resolved) {
      currentSelection = null;
    }
    scene.updateWorld(world, currentSelection);
    updateHud(world.map, world);
  }
  scene.render();
  window.requestAnimationFrame(renderLoop);
}

backToMenu();
scene.setMap(initialMap);
updateHud(initialMap, world);
renderLoop();
