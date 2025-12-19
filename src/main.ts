import { createWorldScene } from "./scene";
import { maps, worldSettings } from "./settings";
import type { GamePhase, GameSession, GameWorld, MapDefinition, Selection, SelectionGroup, UnitState } from "./types";
import { createGameWorld, findSelection, issueOrder, updateGameWorld } from "./world";

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
const mapDetails = requireElement(
  document.querySelector<HTMLElement>("#map-details"),
  "#map-details",
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
const selectionRect = requireElement(
  document.querySelector<HTMLElement>("#selection-rect"),
  "#selection-rect",
);
const lobbyStatus = requireElement(
  document.querySelector<HTMLElement>("#lobby-status"),
  "#lobby-status",
);
const hudSpice = requireElement(
  document.querySelector<HTMLElement>("#hud-spice"),
  "#hud-spice",
);
const hudPower = requireElement(
  document.querySelector<HTMLElement>("#hud-power"),
  "#hud-power",
);
const openSettingsButtons = [
  requireElement(document.querySelector<HTMLButtonElement>("#open-settings"), "#open-settings"),
];
const openControlsButtons = [
  requireElement(document.querySelector<HTMLButtonElement>("#open-controls"), "#open-controls"),
];
const settingsPanel = requireElement(
  document.querySelector<HTMLElement>("#settings-panel"),
  "#settings-panel",
);
const controlsPanel = requireElement(
  document.querySelector<HTMLElement>("#controls-panel"),
  "#controls-panel",
);
const closeSettings = requireElement(
  document.querySelector<HTMLButtonElement>("#close-settings"),
  "#close-settings",
);
const closeControls = requireElement(
  document.querySelector<HTMLButtonElement>("#close-controls"),
  "#close-controls",
);
const sliderVolume = requireElement(
  document.querySelector<HTMLInputElement>("#slider-volume"),
  "#slider-volume",
);
const sliderCamera = requireElement(
  document.querySelector<HTMLInputElement>("#slider-camera"),
  "#slider-camera",
);
const valueVolume = requireElement(
  document.querySelector<HTMLElement>("#value-volume"),
  "#value-volume",
);
const valueCamera = requireElement(
  document.querySelector<HTMLElement>("#value-camera"),
  "#value-camera",
);
const outcomePanel = requireElement(
  document.querySelector<HTMLElement>("#match-outcome"),
  "#match-outcome",
);
const outcomeLabel = requireElement(
  document.querySelector<HTMLElement>("#outcome-label"),
  "#outcome-label",
);
const outcomeMessage = requireElement(
  document.querySelector<HTMLElement>("#outcome-message"),
  "#outcome-message",
);
const outcomeRestartButton = requireElement(
  document.querySelector<HTMLButtonElement>("#outcome-restart"),
  "#outcome-restart",
);
const outcomeMenuButton = requireElement(
  document.querySelector<HTMLButtonElement>("#outcome-menu"),
  "#outcome-menu",
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
if (initialMap) {
  mapSelect.value = initialMap.id;
  updateMapMeta(initialMap);
}

let phase: GamePhase = "menu";
let session: GameSession | null = null;
let preparedMap: MapDefinition | null = initialMap ?? null;
let world: GameWorld | null = null;
let currentSelection: SelectionGroup = [];
let isDraggingSelection = false;
let selectionStart: { x: number; y: number } | null = null;
let activePanel: HTMLElement | null = null;
const uiSettings = {
  volume: 70,
  cameraSensitivity: 1,
};

function findMapById(id: string): MapDefinition | null {
  return maps.find((map) => map.id === id) ?? null;
}

function updateMapMeta(map: MapDefinition | null): void {
  if (!map) {
    mapDetails.textContent = "Нет данных по карте.";
    return;
  }
  const deposits = map.resources.length;
  const starts = map.startLocations.length;
  mapDetails.textContent = `${map.name}: ${map.size.width}×${map.size.height}, стартовых позиций — ${starts}, залежей спайса — ${deposits}.`;
}

function selectionKey(sel: Selection): string {
  return `${sel.kind}:${sel.id}`;
}

function mergeSelections(base: SelectionGroup, additions: SelectionGroup): SelectionGroup {
  const seen = new Set(base.map((item) => selectionKey(item)));
  const result = [...base];
  additions.forEach((item) => {
    const key = selectionKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  });
  return result;
}

function toggleSelection(base: SelectionGroup, target: Selection): SelectionGroup {
  const key = selectionKey(target);
  const exists = base.some((item) => selectionKey(item) === key);
  if (exists) {
    return base.filter((item) => selectionKey(item) !== key);
  }
  return [...base, target];
}

function isVisibleToPlayer(worldState: GameWorld, position: { x: number; z: number }): boolean {
  const vision = worldState.vision.player;
  if (!vision) {
    return true;
  }
  const gx = Math.floor((position.x + worldState.map.size.width / 2) / vision.cellSize);
  const gz = Math.floor((position.z + worldState.map.size.height / 2) / vision.cellSize);
  if (gx < 0 || gz < 0 || gx >= vision.width || gz >= vision.height) {
    return false;
  }
  const idx = gz * vision.width + gx;
  return vision.visible[idx] === 1;
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

function updateOutcomeOverlay(worldState: GameWorld | null): void {
  const outcome = worldState?.outcome ?? null;
  if (!outcome) {
    outcomePanel.hidden = true;
    outcomePanel.dataset.state = "";
    return;
  }
  const state = outcome.winner === "player" ? "win" : outcome.winner === "ai" ? "lose" : "draw";
  outcomePanel.hidden = false;
  outcomePanel.dataset.state = state;
  outcomeLabel.textContent = state === "win" ? "Победа" : state === "lose" ? "Поражение" : "Ничья";
  outcomeMessage.textContent = outcome.message;
}

function setPhase(next: GamePhase): void {
  phase = next;
  const playing = phase === "playing";
  menuScreen.hidden = playing;
  hud.hidden = !playing;
  scene.setInputEnabled(playing && !activePanel);
  // Keep UI minimal: no session indicator or auto hints.
  if (!playing) {
    hideSelectionRect();
  }
}

function updateHud(_map: MapDefinition | null, worldState: GameWorld | null): void {
  updateOutcomeOverlay(worldState);
  if (!worldState) {
    hudSpice.textContent = "—";
    hudPower.textContent = "—";
    return;
  }
  const player = worldState.players.player;
  const activeNodes = worldState.resourceNodes.filter((node) => node.amount > 1);
  const minUnitCost = Math.min(
    ...Object.values(worldState.defs.units).map((def) => def.cost.spice),
  );
  hudSpice.textContent = `${Math.floor(player.spice)}`;
  hudPower.textContent = `${Math.floor(player.power)}`;
}

function createLobby(): void {
  const selected = findMapById(mapSelect.value) ?? initialMap;
  preparedMap = selected ?? null;
  updateMapMeta(preparedMap);
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
  updateMapMeta(map);
  closePanel();
  updateOutcomeOverlay(null);
  world = createGameWorld(map, performance.now());
  currentSelection = [];
  scene.setMap(map);
  scene.updateWorld(world, currentSelection);
  session = { map, startedAt: performance.now() };
  updateHud(map, world);
  setPhase("playing");
}

function backToMenu(): void {
  session = null;
  world = null;
  currentSelection = [];
  preparedMap = initialMap ?? null;
  updateOutcomeOverlay(null);
  closePanel();
  setPhase("menu");
  if (preparedMap) {
    mapSelect.value = preparedMap.id;
  }
  lobbyStatus.textContent = "Выберите карту и создайте игру.";
  lobbyStatus.dataset.state = "idle";
  updateMapMeta(preparedMap);
  updateHud(preparedMap, world);
}

function beginSelectionDrag(event: PointerEvent): void {
  if (phase !== "playing" || activePanel || event.button !== 0) {
    return;
  }
  selectionStart = { x: event.clientX, y: event.clientY };
  isDraggingSelection = true;
  hideSelectionRect();
  canvasElement.setPointerCapture(event.pointerId);
}

function updateSelectionDrag(event: PointerEvent): void {
  if (!isDraggingSelection || !selectionStart || phase !== "playing" || activePanel) {
    return;
  }
  showSelectionRect(selectionStart, { x: event.clientX, y: event.clientY });
  if (selectionRect.dataset.active === "true") {
    const rect = selectionRect.getBoundingClientRect();
    const hovered = scene.pickInRect(rect);
    scene.setHover(hovered);
  } else {
    scene.setHover([]);
  }
}

function endSelectionDrag(event?: PointerEvent): void {
  if (event && canvasElement.hasPointerCapture(event.pointerId)) {
    canvasElement.releasePointerCapture(event.pointerId);
  }
  isDraggingSelection = false;
  selectionStart = null;
  hideSelectionRect();
  scene.usePointerHover();
}

function onCanvasPointerUp(event: PointerEvent): void {
  if (activePanel) {
    return;
  }
  if (event.button === 2) {
    if (world && currentSelection.length) {
      issueOrderFromPointer(event);
    }
    return;
  }
  if (event.button !== 0) {
    return;
  }
  if (isDraggingSelection) {
    const wasActive = selectionRect.dataset.active === "true";
    const rect = selectionRect.getBoundingClientRect();
    endSelectionDrag(event);
    if (world && wasActive) {
      const rectSelection = scene.pickInRect(rect);
      if (event.ctrlKey) {
        currentSelection = mergeSelections(currentSelection, rectSelection);
      } else {
        currentSelection = rectSelection;
      }
      scene.updateWorld(world, currentSelection);
      updateHud(world.map, world);
      return;
    }
  }
  if (world) {
    const picked = scene.pick(event.clientX, event.clientY);
    if (picked) {
      currentSelection = event.ctrlKey ? toggleSelection(currentSelection, picked) : [picked];
    } else if (!event.ctrlKey) {
      currentSelection = [];
    }
    scene.updateWorld(world, currentSelection);
    updateHud(world.map, world);
  }
}

function issueOrderFromPointer(event: PointerEvent): void {
  if (!world || !currentSelection.length) {
    return;
  }
  const worldState = world;
  const playerUnits = currentSelection
    .map((item) => findSelection(worldState, item))
    .filter((entity): entity is UnitState => !!entity && !("queue" in entity) && entity.owner === "player");
  if (!playerUnits.length) {
    return;
  }
  event.preventDefault();
  const now = performance.now();
  const picked = scene.pick(event.clientX, event.clientY);
  if (picked) {
    const target = findSelection(worldState, picked);
    if (target && target.owner !== "player") {
      const targetKind = "queue" in target ? "building" : "unit";
      issueOrder(
        worldState,
        currentSelection,
        { kind: "attackTarget", targetId: target.id, targetKind },
        now,
      );
      updateHud(worldState.map, worldState);
      return;
    }
  }
  const ground = scene.projectToGround(event.clientX, event.clientY);
  if (ground) {
    issueOrder(worldState, currentSelection, { kind: "attackMove", target: ground }, now);
    updateHud(worldState.map, worldState);
  }
}

function openPanel(panel: HTMLElement): void {
  if (activePanel) {
    closePanel();
  }
  panel.dataset.open = "true";
  activePanel = panel;
  scene.setInputEnabled(false);
}

function closePanel(): void {
  if (activePanel) {
    activePanel.dataset.open = "false";
    activePanel = null;
  }
  scene.setInputEnabled(phase === "playing");
}

function applyCameraSensitivity(multiplier: number): void {
  scene.setCameraSensitivity(multiplier);
  uiSettings.cameraSensitivity = multiplier;
  valueCamera.textContent = `${multiplier.toFixed(2)}×`;
}

function applyVolume(value: number): void {
  uiSettings.volume = value;
  valueVolume.textContent = `${value}%`;
}

createButton.addEventListener("click", () => createLobby());
startButton.addEventListener("click", () => startSession());
mapSelect.addEventListener("change", () => {
  updateMapMeta(findMapById(mapSelect.value) ?? preparedMap);
});
canvasElement.addEventListener("pointerdown", (event) => beginSelectionDrag(event));
canvasElement.addEventListener("pointermove", (event) => updateSelectionDrag(event));
canvasElement.addEventListener("pointerup", (event) => onCanvasPointerUp(event));
canvasElement.addEventListener("pointercancel", (event) => endSelectionDrag(event));
canvasElement.addEventListener("contextmenu", (event) => event.preventDefault());
openSettingsButtons.forEach((btn) => btn.addEventListener("click", () => openPanel(settingsPanel)));
openControlsButtons.forEach((btn) => btn.addEventListener("click", () => openPanel(controlsPanel)));
closeSettings.addEventListener("click", () => closePanel());
closeControls.addEventListener("click", () => closePanel());
sliderVolume.addEventListener("input", () => applyVolume(Number(sliderVolume.value)));
sliderCamera.addEventListener("input", () =>
  applyCameraSensitivity(Number(sliderCamera.value) / 100),
);
outcomeRestartButton.addEventListener("click", () =>
  startSession(session ? session.map : preparedMap),
);
outcomeMenuButton.addEventListener("click", () => backToMenu());

window.addEventListener("resize", () => scene.resize());

let isRunning = true;
function renderLoop(): void {
  if (!isRunning) {
    return;
  }
  const now = performance.now();
  if (phase === "playing" && world) {
    const worldState = world;
    updateGameWorld(worldState, now);
    currentSelection = currentSelection.filter((item) => {
      const resolved = findSelection(worldState, item);
      if (!resolved) {
        return false;
      }
      return resolved.owner === "player" || isVisibleToPlayer(worldState, resolved.position);
    });
    scene.updateWorld(worldState, currentSelection);
    updateHud(worldState.map, worldState);
  }
  scene.render();
  window.requestAnimationFrame(renderLoop);
}

applyVolume(uiSettings.volume);
applyCameraSensitivity(uiSettings.cameraSensitivity);
backToMenu();
scene.setMap(initialMap);
updateHud(initialMap, world);
renderLoop();
