import { updateAi, defaultAiState, evaluateOutcome } from "./ai";
import { ensureBehavior, setOrder } from "./behavior";
import { updateCombatUnit } from "./combat";
import { buildingDefs, unitDefs } from "./defs";
import { updateWorker, resetWorkerHarvest } from "./economy";
import { findStartLocation } from "./mapUtils";
import { queueProduction, spawnFromQueue } from "./production";
import { spawnBuilding, spawnWorldUnit } from "./spawn";
import { createVision, recomputeVision } from "./vision";
import type {
  BuildingState,
  FactionId,
  GameWorld,
  MapDefinition,
  PlayerState,
  Selection,
  StartLocation,
  UnitOrder,
  UnitState,
} from "./types";

function cleanupDestroyed(world: GameWorld): void {
  const destroyedBuildings = new Set(world.buildings.filter((b) => b.hp <= 0).map((b) => b.id));
  if (destroyedBuildings.size > 0) {
    world.units.forEach((unit) => {
      if (unit.harvest && unit.harvest.dropoffId && destroyedBuildings.has(unit.harvest.dropoffId)) {
        unit.harvest.dropoffId = null;
      }
    });
  }
  world.buildings = world.buildings.filter((b) => b.hp > 0);
  world.units = world.units.filter((u) => u.hp > 0);
}

function initPlayers(): Record<FactionId, PlayerState> {
  return {
    player: { id: "player", spice: 600, power: 50 },
    ai: { id: "ai", spice: 600, power: 50 },
  };
}

function spawnStartingBase(world: GameWorld, start: StartLocation, now: number): void {
  const owner: FactionId = start.id === "ai" ? "ai" : "player";
  const facing = start.facingDeg ?? 0;
  const base = spawnBuilding(world, owner, "hq", start.position, facing);
  const offset =
    start.id === "ai"
      ? { x: -base.rallyOffset.z, z: -base.rallyOffset.z }
      : { x: base.rallyOffset.z * 0.6, z: base.rallyOffset.z };
  const barracksPos = {
    x: start.position.x + offset.x,
    z: start.position.z + offset.z,
  };
  const barracks = spawnBuilding(world, owner, "barracks", barracksPos, facing);
  const refineryOffset =
    start.id === "ai"
      ? { x: -base.rallyOffset.z * 0.7, z: base.rallyOffset.z * 0.8 }
      : { x: base.rallyOffset.z * 0.8, z: -base.rallyOffset.z * 0.7 };
  spawnBuilding(
    world,
    owner,
    "refinery",
    {
      x: start.position.x + refineryOffset.x,
      z: start.position.z + refineryOffset.z,
    },
    facing,
  );

  spawnWorldUnit(world, owner, "worker", { x: start.position.x + 3, z: start.position.z + 2 }, facing, now);
  spawnWorldUnit(world, owner, "worker", { x: start.position.x - 3, z: start.position.z - 2 }, facing, now);
  spawnWorldUnit(world, owner, "infantry", { x: barracks.position.x + 2, z: barracks.position.z - 2 }, facing, now);

  queueProduction(world, now, barracks, "infantry", { silent: true });
}

function processProduction(world: GameWorld, now: number): void {
  world.buildings.forEach((building) => {
    if (!building.queue.length) {
      return;
    }
    const next = building.queue[0]!;
    if (now >= next.readyAt) {
      building.queue.shift();
      spawnFromQueue(world, building, next);
    }
  });
}

function updateUnits(world: GameWorld, deltaSeconds: number, now: number): void {
  world.units.forEach((unit) => {
    const hasOrder =
      unit.behavior?.order.kind !== undefined && unit.behavior.order.kind !== "idle";
    if (unit.typeId === "worker" && hasOrder) {
      updateCombatUnit(world, unit, deltaSeconds, now);
      return;
    }
    if (unit.typeId === "worker") {
      updateWorker(world, unit, deltaSeconds);
      return;
    }
    updateCombatUnit(world, unit, deltaSeconds, now);
  });
}

export function createGameWorld(map: MapDefinition, now: number): GameWorld {
  const players = initPlayers();
  const buildings: BuildingState[] = [];
  const units: UnitState[] = [];
  const resourceNodes = map.resources.map((spot) => {
    const amount = Math.max(
      0,
      spot.amount ?? Math.round(spot.radius * spot.richness * 240),
    );
    return {
      id: `node-${spot.id}`,
      spotId: spot.id,
      position: { ...spot.position },
      radius: spot.radius,
      richness: spot.richness,
      amount,
      maxAmount: amount,
    };
  });

  const vision = {
    player: createVision(map),
    ai: createVision(map),
  };

  const world: GameWorld = {
    map,
    units,
    buildings,
    resourceNodes,
    players,
    defs: { units: unitDefs, buildings: buildingDefs },
    lastTick: now,
    statusMessage: "База готова. Рабочие ждут приказа добывать спайс.",
    vision,
    outcome: null,
    ai: defaultAiState(map, now),
  };

  map.startLocations.forEach((start) => spawnStartingBase(world, start, now));
  recomputeVision(world);
  return world;
}

export function updateGameWorld(world: GameWorld, now: number): void {
  const previousTick = world.lastTick;
  world.lastTick = now;
  const deltaSeconds = Math.min((now - previousTick) / 1000, 0.25);
  if (world.outcome) {
    return;
  }

  updateAi(world, now);
  processProduction(world, now);
  updateUnits(world, deltaSeconds, now);

  cleanupDestroyed(world);
  recomputeVision(world);
  evaluateOutcome(world, now);
}

export function issueOrder(
  world: GameWorld,
  selection: Selection | null,
  order: UnitOrder,
  now: number,
): boolean {
  if (!selection) {
    return false;
  }
  const entity = findSelection(world, selection);
  if (!entity || "queue" in entity) {
    return false;
  }
  if (entity.owner !== "player") {
    return false;
  }
  const unit = entity;
  ensureBehavior(unit, now);
  if (order.kind === "attackTarget") {
    const target =
      order.targetKind === "unit"
        ? world.units.find((u) => u.id === order.targetId)
        : world.buildings.find((b) => b.id === order.targetId);
    if (!target || target.owner === "player") {
      return false;
    }
  }
  setOrder(unit, order, now);
  resetWorkerHarvest(unit);
  if (order.kind === "move") {
    world.statusMessage = "Приказ: движение.";
  } else if (order.kind === "attackMove") {
    world.statusMessage = "Приказ: двигаться с боем.";
  } else if (order.kind === "attackTarget") {
    world.statusMessage = "Приказ: атака цели.";
  }
  return true;
}

export function findSelection(
  world: GameWorld,
  selection: Selection | null,
): UnitState | BuildingState | null {
  if (!selection) {
    return null;
  }
  if (selection.kind === "unit") {
    return world.units.find((u) => u.id === selection.id) ?? null;
  }
  return world.buildings.find((b) => b.id === selection.id) ?? null;
}
