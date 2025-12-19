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
const lobbyStatus = requireElement(
  document.querySelector<HTMLElement>("#lobby-status"),
  "#lobby-status",
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
let selectionStart: { clientX: number; clientY: number; localX: number; localY: number } | null = null;
let selectionPointerId: number | null = null;
let selectionRectActive = false;
let selectionScreenRect: DOMRect | null = null;
const activeTouchPointers = new Set<number>();
let touchGestureLock = false;
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
  selectionRectActive = false;
  selectionScreenRect = null;
  scene.setSelectionRect(null);
}

function showSelectionRect(
  start: { clientX: number; clientY: number; localX: number; localY: number },
  current: { clientX: number; clientY: number; localX: number; localY: number },
): void {
  const left = Math.min(start.clientX, current.clientX);
  const top = Math.min(start.clientY, current.clientY);
  const width = Math.abs(current.clientX - start.clientX);
  const height = Math.abs(current.clientY - start.clientY);
  const localLeft = Math.min(start.localX, current.localX);
  const localTop = Math.min(start.localY, current.localY);
  if (width < 4 && height < 4) {
    selectionRectActive = false;
    selectionScreenRect = null;
    scene.setSelectionRect(null);
    return;
  }
  selectionRectActive = true;
  selectionScreenRect = new DOMRect(left, top, width, height);
  scene.setSelectionRect({ left: localLeft, top: localTop, width, height });
}

function updateOutcomeOverlay(worldState: GameWorld | null): void {
  const outcome = worldState?.outcome ?? null;
  if (!outcome) {
    scene.setMatchOutcome(null);
    return;
  }
  const state = outcome.winner === "player" ? "win" : outcome.winner === "ai" ? "lose" : "draw";
  scene.setMatchOutcome({
    state,
    message: outcome.message,
  });
}

function setPhase(next: GamePhase): void {
  phase = next;
  const playing = phase === "playing";
  menuScreen.hidden = playing;
  scene.setHudVisible(playing);
  scene.setInputEnabled(playing && !activePanel);
  // Keep UI minimal: no session indicator or auto hints.
  if (!playing) {
    hideSelectionRect();
  }
}

function updateHud(_map: MapDefinition | null, worldState: GameWorld | null): void {
  updateOutcomeOverlay(worldState);
  if (!worldState) {
    scene.setHudValues({ spice: "—", power: "—" });
    return;
  }
  const player = worldState.players.player;
  scene.setHudValues({
    spice: `${Math.floor(player.spice)}`,
    power: `${Math.floor(player.power)}`,
  });
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
  const rect = canvasElement.getBoundingClientRect();
  selectionStart = {
    clientX: event.clientX,
    clientY: event.clientY,
    localX: event.clientX - rect.left,
    localY: event.clientY - rect.top,
  };
  isDraggingSelection = true;
  selectionPointerId = event.pointerId;
  hideSelectionRect();
  canvasElement.setPointerCapture(event.pointerId);
}

function updateSelectionDrag(event: PointerEvent): void {
  if (!isDraggingSelection || !selectionStart || phase !== "playing" || activePanel) {
    return;
  }
  const rect = canvasElement.getBoundingClientRect();
  showSelectionRect(selectionStart, {
    clientX: event.clientX,
    clientY: event.clientY,
    localX: event.clientX - rect.left,
    localY: event.clientY - rect.top,
  });
  if (selectionRectActive && selectionScreenRect) {
    const hovered = scene.pickInRect(selectionScreenRect);
    scene.setHover(hovered);
  } else {
    scene.setHover([]);
  }
}

function endSelectionDrag(event?: PointerEvent): void {
  const pointerIds = new Set<number>();
  if (event) {
    pointerIds.add(event.pointerId);
  }
  if (selectionPointerId != null) {
    pointerIds.add(selectionPointerId);
  }
  pointerIds.forEach((id) => {
    if (canvasElement.hasPointerCapture(id)) {
      canvasElement.releasePointerCapture(id);
    }
  });
  isDraggingSelection = false;
  selectionStart = null;
  selectionPointerId = null;
  hideSelectionRect();
  scene.usePointerHover();
}

function onCanvasPointerUp(event: PointerEvent): void {
  if (activePanel) {
    return;
  }
  const isTouch = event.pointerType === "touch";
  if (!isTouch && event.button === 2) {
    if (world && currentSelection.length) {
      issueOrderFromPointer(event);
    }
    return;
  }
  if (!isTouch && event.button !== 0) {
    return;
  }
  if (isDraggingSelection) {
    const wasActive = selectionRectActive;
    const rect = selectionScreenRect;
    endSelectionDrag(event);
    if (world && wasActive && rect) {
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
    if (isTouch) {
      const target = picked ? findSelection(world, picked) : null;
      const isEnemyTarget = !!target && "owner" in target && target.owner !== "player";
      if (picked && (!isEnemyTarget || !currentSelection.length)) {
        currentSelection = [picked];
      } else if (currentSelection.length) {
        issueOrderFromPointer(event);
      } else {
        currentSelection = [];
      }
    } else if (picked) {
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

function handleCanvasPointerDown(event: PointerEvent): void {
  if (scene.handleHudPointer(event)) {
    return;
  }
  if (event.pointerType === "touch") {
    activeTouchPointers.add(event.pointerId);
    if (activeTouchPointers.size >= 2) {
      touchGestureLock = true;
      endSelectionDrag(event);
      return;
    }
  }
  if (touchGestureLock) {
    return;
  }
  beginSelectionDrag(event);
}

function handleCanvasPointerMove(event: PointerEvent): void {
  if (scene.handleHudPointer(event)) {
    return;
  }
  if (touchGestureLock) {
    return;
  }
  updateSelectionDrag(event);
}

function handleCanvasPointerUp(event: PointerEvent): void {
  if (scene.handleHudPointer(event)) {
    return;
  }
  const wasTouchGesture = touchGestureLock;
  if (event.pointerType === "touch") {
    activeTouchPointers.delete(event.pointerId);
    if (activeTouchPointers.size === 0) {
      touchGestureLock = false;
    }
  }
  if (wasTouchGesture) {
    endSelectionDrag(event);
    return;
  }
  onCanvasPointerUp(event);
}

function handleCanvasPointerCancel(event: PointerEvent): void {
  if (scene.handleHudPointer(event)) {
    return;
  }
  if (event.pointerType === "touch") {
    activeTouchPointers.delete(event.pointerId);
    if (activeTouchPointers.size === 0) {
      touchGestureLock = false;
    }
  }
  endSelectionDrag(event);
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

scene.setHudCallbacks({
  onRestart: () => startSession(session ? session.map : preparedMap),
  onMenu: () => backToMenu(),
});

createButton.addEventListener("click", () => createLobby());
startButton.addEventListener("click", () => startSession());
mapSelect.addEventListener("change", () => {
  updateMapMeta(findMapById(mapSelect.value) ?? preparedMap);
});
canvasElement.addEventListener("pointerdown", (event) => handleCanvasPointerDown(event));
canvasElement.addEventListener("pointermove", (event) => handleCanvasPointerMove(event));
canvasElement.addEventListener("pointerup", (event) => handleCanvasPointerUp(event));
canvasElement.addEventListener("pointercancel", (event) => handleCanvasPointerCancel(event));
canvasElement.addEventListener("contextmenu", (event) => event.preventDefault());
openSettingsButtons.forEach((btn) => btn.addEventListener("click", () => openPanel(settingsPanel)));
openControlsButtons.forEach((btn) => btn.addEventListener("click", () => openPanel(controlsPanel)));
closeSettings.addEventListener("click", () => closePanel());
closeControls.addEventListener("click", () => closePanel());
sliderVolume.addEventListener("input", () => applyVolume(Number(sliderVolume.value)));
sliderCamera.addEventListener("input", () =>
  applyCameraSensitivity(Number(sliderCamera.value) / 100),
);

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
