import { aiBuildPlan, buildingDefs, unitDefs } from "./defs";
import { queueProduction } from "./production";
import { spawnBuilding } from "./spawn";
import { setOrder } from "./behavior";
import { findStartLocation } from "./mapUtils";
import { distanceSq } from "./movement";
import type {
  AiLoopProduction,
  AiState,
  BuildingState,
  BuildingTypeId,
  FactionId,
  GameWorld,
  StartLocation,
  UnitState,
  UnitTypeId,
  WorldOutcome,
} from "./types";

export function defaultAiState(map: GameWorld["map"], now: number): AiState {
  const aiStart = findStartLocation(map, "ai") ?? map.startLocations[1] ?? map.startLocations[0] ?? null;
  const playerStart = findStartLocation(map, "player") ?? aiStart ?? map.startLocations[0] ?? null;
  const attackTarget = playerStart ? { ...playerStart.position } : { x: 0, z: 0 };
  const rallyPoint = aiStart
    ? { x: aiStart.position.x + 6, z: aiStart.position.z + 4 }
    : { x: 0, z: 0 };
  return {
    waveNumber: 0,
    nextWaveAt: now + 12000,
    lastProductionCheck: now,
    desiredWorkers: 4,
    rallyPoint,
    attackTarget,
    planStep: 0,
    loopProduction: null,
    nextScoutAt: now + 10000,
  };
}

function countUnits(world: GameWorld, owner: FactionId, typeId?: UnitTypeId): number {
  return world.units.filter((u) => u.owner === owner && (!typeId || u.typeId === typeId)).length;
}

function countQueuedUnits(world: GameWorld, owner: FactionId, typeId?: UnitTypeId): number {
  return world.buildings
    .filter((b) => b.owner === owner)
    .reduce(
      (acc, b) =>
        acc +
        b.queue.filter((item) => !typeId || item.unitTypeId === typeId).length,
      0,
    );
}

function countBuildings(
  world: GameWorld,
  owner: FactionId,
  typeId?: BuildingTypeId,
): number {
  return world.buildings.filter((b) => b.owner === owner && (!typeId || b.typeId === typeId)).length;
}

function producerBuildings(
  world: GameWorld,
  owner: FactionId,
  unitTypeId: UnitTypeId,
): BuildingState[] {
  return world.buildings.filter(
    (b) => b.owner === owner && buildingDefs[b.typeId].produces.includes(unitTypeId),
  );
}

function rotateOffset(offset: { x: number; z: number }, facingDeg: number): { x: number; z: number } {
  const rad = (facingDeg * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  return { x: offset.x * cos - offset.z * sin, z: offset.x * sin + offset.z * cos };
}

function offsetFromStart(
  map: GameWorld["map"],
  owner: FactionId,
  offset: { x: number; z: number },
): { x: number; z: number } {
  const start = findStartLocation(map, owner) ?? map.startLocations[0] ?? null;
  if (!start) {
    return { ...offset };
  }
  const rotated = rotateOffset(offset, start.facingDeg ?? 0);
  return {
    x: start.position.x + rotated.x,
    z: start.position.z + rotated.z,
  };
}

function tryPlaceAiStructure(
  world: GameWorld,
  owner: FactionId,
  typeId: BuildingTypeId,
  start: StartLocation | null,
  offset: { x: number; z: number },
): BuildingState | null {
  const def = buildingDefs[typeId];
  const facing = start?.facingDeg ?? 0;
  const rotated = rotateOffset(offset, facing);
  const position = start
    ? { x: start.position.x + rotated.x, z: start.position.z + rotated.z }
    : { ...offset };
  const paddingSq = (def.size * 0.8 + 3) * (def.size * 0.8 + 3);
  const blocked = world.buildings.some((b) => {
    const otherDef = buildingDefs[b.typeId];
    const clearance = (otherDef.size + def.size) * 0.55;
    const required = Math.max(paddingSq, clearance * clearance);
    return distanceSq(position, b.position) < required;
  });
  if (blocked || world.players[owner].spice < def.cost.spice) {
    return null;
  }
  world.players[owner].spice -= def.cost.spice;
  return spawnBuilding(world, owner, typeId, position, facing);
}

function ensureUnitGoal(
  world: GameWorld,
  now: number,
  owner: FactionId,
  unitTypeId: UnitTypeId,
  targetCount: number,
  options?: { silent?: boolean },
): boolean {
  let total = countUnits(world, owner, unitTypeId) + countQueuedUnits(world, owner, unitTypeId);
  if (total >= targetCount) {
    return true;
  }
  const producers = producerBuildings(world, owner, unitTypeId).sort(
    (a, b) => a.queue.length - b.queue.length,
  );
  producers.forEach((producer) => {
    if (total >= targetCount) {
      return;
    }
    const queued = queueProduction(world, now, producer, unitTypeId, options);
    if (queued) {
      total += 1;
    }
  });
  return total >= targetCount;
}

function maintainAiProduction(world: GameWorld, now: number): void {
  const ai = world.ai;
  ensureUnitGoal(world, now, "ai", "worker", ai.desiredWorkers, { silent: true });
  const infantryBaseline = Math.max(3, 4 + ai.waveNumber);
  ensureUnitGoal(world, now, "ai", "infantry", infantryBaseline, { silent: true });
  const loop = ai.loopProduction;
  if (!loop) {
    return;
  }
  let queued = countQueuedUnits(world, "ai", loop.unitTypeId);
  const producers = producerBuildings(world, "ai", loop.unitTypeId).sort(
    (a, b) => a.queue.length - b.queue.length,
  );
  const desiredQueue = Math.ceil(Math.max(loop.minQueue, 1 + ai.waveNumber * 0.2));
  producers.forEach((producer) => {
    if (queued >= desiredQueue) {
      return;
    }
    const item = queueProduction(world, now, producer, loop.unitTypeId, { silent: true });
    if (item) {
      queued += 1;
    }
  });
}

function dispatchAiScout(world: GameWorld, now: number): void {
  const ai = world.ai;
  if (now < ai.nextScoutAt) {
    return;
  }
  const scoutTarget =
    world.map.resources[0]?.position ??
    offsetFromStart(world.map, "player", { x: 0, z: 0 });
  const scout = world.units.find(
    (u) =>
      u.owner === "ai" &&
      u.typeId === "infantry" &&
      (!u.behavior || u.behavior.order.kind === "idle"),
  );
  if (!scout) {
    ai.nextScoutAt = now + 6000;
    return;
  }
  setOrder(scout, { kind: "attackMove", target: scoutTarget }, now);
  ai.nextScoutAt = now + 17000;
}

function stageAiArmy(world: GameWorld, now: number): void {
  const rally = world.ai.rallyPoint;
  world.units.forEach((unit) => {
    if (unit.owner !== "ai") {
      return;
    }
    const def = unitDefs[unit.typeId];
    if (!def.attack) {
      return;
    }
    const currentOrder = unit.behavior?.order.kind ?? "idle";
    if (currentOrder === "idle") {
      setOrder(unit, { kind: "attackMove", target: rally }, now);
    }
  });
}

function runAiBuildPlan(world: GameWorld, now: number, aiStart: StartLocation | null): void {
  const ai = world.ai;
  let stepsAdvanced = 0;
  while (stepsAdvanced < 3) {
    const step = aiBuildPlan[ai.planStep];
    if (!step) {
      return;
    }
    let done = false;
    switch (step.kind) {
      case "ensureWorkers":
        ai.desiredWorkers = Math.max(ai.desiredWorkers, step.count);
        done = ensureUnitGoal(world, now, "ai", "worker", step.count, { silent: true });
        break;
      case "trainUnits":
        done = ensureUnitGoal(world, now, "ai", step.unitTypeId, step.count, { silent: true });
        break;
      case "buildStructure": {
        const existing = countBuildings(world, "ai", step.typeId);
        if (existing >= (step.typeId === "barracks" ? 2 : 1)) {
          done = true;
          break;
        }
        if (world.players.ai.spice >= (step.requireSpice ?? 0)) {
          const placed = tryPlaceAiStructure(world, "ai", step.typeId, aiStart, step.offset);
          if (placed) {
            done = true;
            world.statusMessage = "ИИ расширяет базу.";
          }
        }
        break;
      }
      case "setRally": {
        const facing = aiStart?.facingDeg ?? 0;
        const rotated = rotateOffset(step.offset, facing);
        ai.rallyPoint = aiStart
          ? { x: aiStart.position.x + rotated.x, z: aiStart.position.z + rotated.z }
          : { ...step.offset };
        done = true;
        break;
      }
      case "loopProduction":
        ai.loopProduction = { unitTypeId: step.unitTypeId, minQueue: step.minQueue };
        done = true;
        break;
      default:
        done = true;
        break;
    }
    if (!done) {
      break;
    }
    ai.planStep += 1;
    stepsAdvanced += 1;
  }
}

function chooseAttackPoint(world: GameWorld, ai: AiState): { x: number; z: number } {
  const playerBuilding = world.buildings.find((b) => b.owner === "player");
  if (playerBuilding) {
    return { ...playerBuilding.position };
  }
  return { ...ai.attackTarget };
}

function launchAiWave(world: GameWorld, now: number): void {
  const ai = world.ai;
  const attackers = world.units.filter(
    (u) => u.owner === "ai" && world.defs.units[u.typeId].attack,
  );
  if (!attackers.length) {
    ai.nextWaveAt = Math.max(ai.nextWaveAt, now + 4000);
    return;
  }
  const desiredSize = Math.min(14, 5 + ai.waveNumber * 2);
  const minimumSize = Math.max(3, desiredSize - 2);
  const ready = attackers.length >= desiredSize;
  const overdue = now >= ai.nextWaveAt + 4500 && attackers.length >= minimumSize;
  if ((now >= ai.nextWaveAt && attackers.length >= minimumSize) || overdue || ready) {
    const attackPoint = chooseAttackPoint(world, ai);
    attackers.forEach((unit) => setOrder(unit, { kind: "attackMove", target: attackPoint }, now));
    world.statusMessage = "Сканеры: вражеская волна выдвинулась.";
    ai.waveNumber += 1;
    ai.desiredWorkers = Math.min(10, ai.desiredWorkers + 1);
    const cooldown = Math.max(9000, 15500 - ai.waveNumber * 900);
    ai.nextWaveAt = now + cooldown;
    return;
  }
  if (now >= ai.nextWaveAt && attackers.length < minimumSize) {
    ai.nextWaveAt = now + 3200;
  }
}

export function evaluateOutcome(world: GameWorld, now: number): WorldOutcome | null {
  if (world.outcome) {
    return world.outcome;
  }
  const playerAlive = world.buildings.some((b) => b.owner === "player");
  const aiAlive = world.buildings.some((b) => b.owner === "ai");
  let outcome: WorldOutcome | null = null;
  if (!playerAlive && !aiAlive) {
    outcome = { winner: "draw", message: "Обе базы уничтожены. Ничья." };
  } else if (!aiAlive) {
    outcome = { winner: "player", message: "Победа! База ИИ разрушена." };
  } else if (!playerAlive) {
    outcome = { winner: "ai", message: "Поражение. База потеряна." };
  }
  if (outcome) {
    world.outcome = outcome;
    world.ai.nextWaveAt = Number.POSITIVE_INFINITY;
    world.statusMessage = outcome.message;
  }
  return outcome;
}

export function updateAi(world: GameWorld, now: number): void {
  if (world.outcome) {
    return;
  }
  const aiStart = findStartLocation(world.map, "ai") ?? world.map.startLocations[1] ?? world.map.startLocations[0] ?? null;
  runAiBuildPlan(world, now, aiStart);
  if (now - world.ai.lastProductionCheck >= 900) {
    world.ai.lastProductionCheck = now;
    maintainAiProduction(world, now);
  }
  stageAiArmy(world, now);
  dispatchAiScout(world, now);
  launchAiWave(world, now);
}

export function offsetFromStartForTests(
  map: GameWorld["map"],
  owner: FactionId,
  offset: { x: number; z: number },
): { x: number; z: number } {
  return offsetFromStart(map, owner, offset);
}
