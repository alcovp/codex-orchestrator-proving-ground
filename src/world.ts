import type {
  AiState,
  AttackState,
  BuildingDefinition,
  BuildingState,
  BuildingTypeId,
  FactionId,
  GameWorld,
  MapDefinition,
  PlayerState,
  ProductionQueueItem,
  Selection,
  StartLocation,
  UnitBehaviorState,
  UnitDefinition,
  UnitOrder,
  UnitState,
  UnitTypeId,
  VisionState,
  WorldOutcome,
} from "./types";

type IdGen = () => string;

function makeIdGen(prefix: string): IdGen {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}

const nextUnitId = makeIdGen("unit");
const nextBuildingId = makeIdGen("bld");
const nextQueueId = makeIdGen("q");

const unitDefs: Record<UnitTypeId, UnitDefinition> = {
  worker: {
    id: "worker",
    name: "Рабочий",
    maxHp: 60,
    buildTime: 6,
    moveSpeed: 6,
    cost: { spice: 50 },
    harvestRate: 18,
    carryCapacity: 60,
    visionRange: 18,
    attack: { damage: 4, cooldown: 1.2, range: 4 },
  },
  infantry: {
    id: "infantry",
    name: "Легкая пехота",
    maxHp: 85,
    buildTime: 8,
    moveSpeed: 6.5,
    cost: { spice: 90 },
    visionRange: 24,
    attack: { damage: 14, cooldown: 0.95, range: 8.5 },
  },
};

const buildingDefs: Record<BuildingTypeId, BuildingDefinition> = {
  hq: {
    id: "hq",
    name: "Штаб",
    maxHp: 900,
    size: 12,
    produces: ["worker"],
    queueLimit: 4,
    cost: { spice: 0 },
    isRefinery: true,
    visionRange: 30,
  },
  barracks: {
    id: "barracks",
    name: "Казармы",
    maxHp: 650,
    size: 10,
    produces: ["infantry"],
    queueLimit: 4,
    cost: { spice: 120 },
    visionRange: 22,
  },
  refinery: {
    id: "refinery",
    name: "Переработка",
    maxHp: 700,
    size: 10,
    produces: [],
    queueLimit: 0,
    cost: { spice: 200 },
    isRefinery: true,
    visionRange: 20,
  },
};

function createVision(map: MapDefinition): VisionState {
  const cellSize = Math.max(2, Math.round(map.tileSize / 2));
  const width = Math.max(8, Math.ceil(map.size.width / cellSize));
  const height = Math.max(8, Math.ceil(map.size.height / cellSize));
  const size = width * height;
  return {
    width,
    height,
    cellSize,
    visible: new Uint8Array(size),
    explored: new Uint8Array(size),
  };
}

function revealVision(
  vision: VisionState,
  map: MapDefinition,
  position: { x: number; z: number },
  radius: number,
): void {
  const mapHalfWidth = map.size.width / 2;
  const mapHalfHeight = map.size.height / 2;
  const radiusSq = radius * radius;
  const minX = Math.max(
    0,
    Math.floor((position.x - radius + mapHalfWidth) / vision.cellSize),
  );
  const maxX = Math.min(
    vision.width - 1,
    Math.floor((position.x + radius + mapHalfWidth) / vision.cellSize),
  );
  const minZ = Math.max(
    0,
    Math.floor((position.z - radius + mapHalfHeight) / vision.cellSize),
  );
  const maxZ = Math.min(
    vision.height - 1,
    Math.floor((position.z + radius + mapHalfHeight) / vision.cellSize),
  );

  for (let gz = minZ; gz <= maxZ; gz += 1) {
    const cellCenterZ = gz * vision.cellSize - mapHalfHeight + vision.cellSize * 0.5;
    const dz = cellCenterZ - position.z;
    for (let gx = minX; gx <= maxX; gx += 1) {
      const cellCenterX = gx * vision.cellSize - mapHalfWidth + vision.cellSize * 0.5;
      const dx = cellCenterX - position.x;
      if (dx * dx + dz * dz <= radiusSq) {
        const idx = gz * vision.width + gx;
        vision.visible[idx] = 1;
        vision.explored[idx] = 1;
      }
    }
  }
}

function recomputeVision(world: GameWorld): void {
  (["player", "ai"] as const).forEach((id) => world.vision[id].visible.fill(0));
  world.units.forEach((unit) => {
    const def = world.defs.units[unit.typeId];
    revealVision(world.vision[unit.owner], world.map, unit.position, def.visionRange);
  });
  world.buildings.forEach((building) => {
    const def = world.defs.buildings[building.typeId];
    revealVision(
      world.vision[building.owner],
      world.map,
      building.position,
      def.visionRange,
    );
  });
}

function findStartLocation(map: MapDefinition, id: string): StartLocation | null {
  return map.startLocations.find((loc) => loc.id === id) ?? null;
}

function defaultAiState(map: MapDefinition, now: number): AiState {
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
  };
}

function ensureAttackState(unit: UnitState, attackDef: UnitDefinition["attack"]): AttackState | undefined {
  if (!attackDef) {
    return undefined;
  }
  if (!unit.attack) {
    unit.attack = { targetId: null, targetKind: null, cooldown: 0 };
  }
  return unit.attack;
}

function ensureBehavior(unit: UnitState, now: number): UnitBehaviorState {
  if (!unit.behavior) {
    unit.behavior = { order: { kind: "idle" }, lastAttackAt: now };
  }
  return unit.behavior;
}

function setOrder(unit: UnitState, order: UnitOrder, now: number): UnitBehaviorState {
  const behavior = ensureBehavior(unit, now);
  behavior.order = order;
  return behavior;
}

function spawnBuilding(
  world: GameWorld,
  owner: FactionId,
  typeId: BuildingTypeId,
  position: { x: number; z: number },
  facingDeg: number,
): BuildingState {
  const def = buildingDefs[typeId];
  const building: BuildingState = {
    id: nextBuildingId(),
    typeId: def.id,
    owner,
    position: { ...position },
    facingDeg,
    hp: def.maxHp,
    queue: [],
    rallyOffset: { x: 0, z: def.size * 0.6 },
  };
  world.buildings.push(building);
  return building;
}

function spawnWorldUnit(
  world: GameWorld,
  owner: FactionId,
  unitTypeId: UnitTypeId,
  position: { x: number; z: number },
  facingDeg: number,
  now: number,
): UnitState {
  const def = unitDefs[unitTypeId];
  const attackState = def.attack ? { targetId: null, targetKind: null, cooldown: 0 } : null;
  const behaviorState = def.attack ? { order: { kind: "idle" } as UnitOrder, lastAttackAt: now } : null;
  const unit: UnitState = {
    id: nextUnitId(),
    typeId: def.id,
    owner,
    position: { ...position },
    facingDeg,
    hp: def.maxHp,
    ...(attackState ? { attack: attackState } : {}),
    ...(behaviorState ? { behavior: behaviorState } : {}),
    ...(def.id === "worker"
      ? { harvest: { mode: "idle", nodeId: null, dropoffId: null, carried: 0, progress: 0 } }
      : {}),
  };
  world.units.push(unit);
  return unit;
}

export function queueProduction(
  world: GameWorld,
  now: number,
  building: BuildingState,
  unitTypeId: UnitTypeId,
  options?: { silent?: boolean },
): ProductionQueueItem | null {
  const def = buildingDefs[building.typeId];
  if (!def.produces.includes(unitTypeId)) {
    return null;
  }
  if (building.queue.length >= def.queueLimit) {
    return null;
  }
  const player = world.players[building.owner];
  const unitDef = unitDefs[unitTypeId];
  if (player.spice < unitDef.cost.spice) {
    if (!options?.silent && building.owner === "player") {
      world.statusMessage = `Недостаточно спайса: нужно ${unitDef.cost.spice}`;
    }
    return null;
  }
  player.spice -= unitDef.cost.spice;
  const item: ProductionQueueItem = {
    id: nextQueueId(),
    unitTypeId,
    startedAt: now,
    readyAt: now + unitDef.buildTime * 1000,
  };
  building.queue.push(item);
  if (!options?.silent && building.owner === "player") {
    world.statusMessage = `${unitDef.name}: заказ принят (${Math.floor(player.spice)} спайса осталось)`;
  }
  return item;
}

function spawnFromQueue(
  world: GameWorld,
  building: BuildingState,
  queueItem: ProductionQueueItem,
): void {
  const def = buildingDefs[building.typeId];
  const facingRad = (building.facingDeg * Math.PI) / 180;
  const offsetX = Math.sin(facingRad) * def.size * 0.6 + building.rallyOffset.x;
  const offsetZ = Math.cos(facingRad) * def.size * 0.6 + building.rallyOffset.z;
  const position = {
    x: building.position.x + offsetX,
    z: building.position.z + offsetZ,
  };
  spawnWorldUnit(world, building.owner, queueItem.unitTypeId, position, building.facingDeg, world.lastTick);
  if (building.owner === "player") {
    const unitDef = world.defs.units[queueItem.unitTypeId];
    world.statusMessage = `${unitDef.name} готов к выходу`;
  }
}

function findNearestResourceNode(world: GameWorld, position: { x: number; z: number }): number {
  let bestIdx = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  world.resourceNodes.forEach((node, idx) => {
    if (node.amount <= 0) {
      return;
    }
    const dx = node.position.x - position.x;
    const dz = node.position.z - position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDist) {
      bestDist = distSq;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

function findDropoffBuilding(world: GameWorld, owner: FactionId, position: { x: number; z: number }): BuildingState | null {
  const candidates = world.buildings.filter(
    (b) => b.owner === owner && world.defs.buildings[b.typeId].isRefinery,
  );
  if (!candidates.length) {
    return null;
  }
  candidates.sort((a, b) => {
    const da =
      (a.position.x - position.x) * (a.position.x - position.x) +
      (a.position.z - position.z) * (a.position.z - position.z);
    const db =
      (b.position.x - position.x) * (b.position.x - position.x) +
      (b.position.z - position.z) * (b.position.z - position.z);
    return da - db;
  });
  return candidates[0] ?? null;
}

function moveUnitTowards(
  unit: UnitState,
  target: { x: number; z: number },
  speed: number,
  deltaSeconds: number,
): number {
  const dx = target.x - unit.position.x;
  const dz = target.z - unit.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 1e-3) {
    return 0;
  }
  const step = speed * deltaSeconds;
  const t = step >= dist ? 1 : step / dist;
  unit.position.x += dx * t;
  unit.position.z += dz * t;
  unit.facingDeg = (Math.atan2(dx, dz) * 180) / Math.PI;
  return dist - step;
}

function updateWorker(
  world: GameWorld,
  worker: UnitState,
  deltaSeconds: number,
): void {
  if (worker.typeId !== "worker") {
    return;
  }
  const def = world.defs.units.worker;
  const carryCapacity = def.carryCapacity ?? 60;
  const harvestRate = def.harvestRate ?? 12;
  const task =
    worker.harvest ??
    { mode: "idle", nodeId: null, dropoffId: null, carried: 0, progress: 0 };
  worker.harvest = task;

  const targetNode =
    task.nodeId !== null
      ? world.resourceNodes.find((n) => n.id === task.nodeId && n.amount > 0)
      : null;

  if ((!targetNode || targetNode.amount <= 0) && task.mode !== "idle") {
    task.mode = "idle";
    task.nodeId = null;
  }

  if (task.mode === "idle") {
    const idx = findNearestResourceNode(world, worker.position);
    if (idx >= 0) {
      const node = world.resourceNodes[idx];
      if (!node) {
        task.mode = "idle";
        task.nodeId = null;
        return;
      }
      task.nodeId = node.id;
      task.mode = "toResource";
      task.dropoffId = findDropoffBuilding(world, worker.owner, worker.position)?.id ?? null;
    } else {
      return;
    }
  }

  const node =
    task.nodeId !== null
      ? world.resourceNodes.find((n) => n.id === task.nodeId)
      : null;
  const dropoff =
    task.dropoffId !== null
      ? world.buildings.find((b) => b.id === task.dropoffId)
      : findDropoffBuilding(world, worker.owner, worker.position);

  switch (task.mode) {
    case "toResource": {
      if (!node) {
        task.mode = "idle";
        break;
      }
      const remaining = moveUnitTowards(worker, node.position, def.moveSpeed, deltaSeconds);
      const arriveDistance = node.radius + 0.6;
      if (remaining <= arriveDistance) {
        task.mode = "gathering";
        task.progress = 0;
      }
      break;
    }
    case "gathering": {
      if (!node || node.amount <= 0) {
        task.mode = "idle";
        task.nodeId = null;
        break;
      }
      const remainingCap = carryCapacity - task.carried;
      if (remainingCap <= 0) {
        task.mode = "toDropoff";
        break;
      }
      const amountBefore = node.amount;
      const harvested = Math.min(
        node.amount,
        remainingCap,
        harvestRate * deltaSeconds * node.richness,
      );
      task.carried += harvested;
      node.amount = Math.max(0, node.amount - harvested);
      task.progress = task.carried / carryCapacity;
      if (amountBefore > 0 && node.amount <= 0) {
        world.statusMessage = "Залежь спайса истощена.";
      }
      if (task.carried >= carryCapacity || node.amount <= 0) {
        task.mode = "toDropoff";
      }
      break;
    }
    case "toDropoff": {
      if (task.carried <= 0) {
        task.mode = "toResource";
        break;
      }
      const target = dropoff ?? findDropoffBuilding(world, worker.owner, worker.position);
      if (!target) {
        world.players[worker.owner].spice += task.carried;
        task.carried = 0;
        task.mode = "toResource";
        break;
      }
      task.dropoffId = target.id;
      const defTarget = world.defs.buildings[target.typeId];
      const remaining = moveUnitTowards(worker, target.position, def.moveSpeed, deltaSeconds);
      const arriveDistance = defTarget.size * 0.6;
      if (remaining <= arriveDistance) {
        world.players[worker.owner].spice += task.carried;
        if (worker.owner === "player") {
          world.statusMessage = `Доставлено ${Math.round(task.carried)} спайса`;
        }
        task.carried = 0;
        task.progress = 0;
        if (node && node.amount > 0) {
          task.mode = "toResource";
        } else {
          task.mode = "idle";
          task.nodeId = null;
        }
      }
      break;
    }
    default:
      break;
  }
}

function resolveAttackTarget(world: GameWorld, state: AttackState | undefined): { target: UnitState | BuildingState; kind: "unit" | "building" } | null {
  if (!state || !state.targetId || !state.targetKind) {
    return null;
  }
  if (state.targetKind === "unit") {
    const unit = world.units.find((u) => u.id === state.targetId && u.hp > 0);
    if (unit) {
      return { target: unit, kind: "unit" };
    }
  } else {
    const building = world.buildings.find((b) => b.id === state.targetId && b.hp > 0);
    if (building) {
      return { target: building, kind: "building" };
    }
  }
  state.targetId = null;
  state.targetKind = null;
  return null;
}

function distanceSq(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function findNearestEnemyTarget(
  world: GameWorld,
  owner: FactionId,
  position: { x: number; z: number },
  maxRange: number,
): { target: UnitState | BuildingState; kind: "unit" | "building"; distSq: number } | null {
  const maxRangeSq = maxRange * maxRange;
  let best: { target: UnitState | BuildingState; kind: "unit" | "building"; distSq: number } | null = null;
  world.units.forEach((unit) => {
    if (unit.owner === owner || unit.hp <= 0) {
      return;
    }
    const d = distanceSq(position, unit.position);
    if (d <= maxRangeSq && (!best || d < best.distSq)) {
      best = { target: unit, kind: "unit", distSq: d };
    }
  });
  world.buildings.forEach((building) => {
    if (building.owner === owner || building.hp <= 0) {
      return;
    }
    const d = distanceSq(position, building.position);
    if (d <= maxRangeSq && (!best || d < best.distSq)) {
      best = { target: building, kind: "building", distSq: d };
    }
  });
  return best;
}

function applyDamage(
  world: GameWorld,
  target: UnitState | BuildingState,
  amount: number,
  sourceOwner: FactionId,
): void {
  target.hp = Math.max(0, target.hp - amount);
  if (target.hp > 0) {
    return;
  }
  if ("queue" in target) {
    const def = world.defs.buildings[target.typeId];
    if (target.owner === "player") {
      world.statusMessage = `${def.name} уничтожено.`;
    } else if (sourceOwner === "player") {
      world.statusMessage = `${def.name} противника уничтожено.`;
    }
  }
}

function updateCombatUnit(
  world: GameWorld,
  unit: UnitState,
  deltaSeconds: number,
  now: number,
): void {
  const def = world.defs.units[unit.typeId];
  const attackDef = def.attack;
  if (!attackDef) {
    return;
  }
  const behavior = ensureBehavior(unit, now);
  const attackState = ensureAttackState(unit, attackDef);
  if (!attackState) {
    return;
  }

  attackState.cooldown = Math.max(0, attackState.cooldown - deltaSeconds);
  const desiredRange = attackDef.range;
  const aggroRange = desiredRange + 5;

  let targetInfo = resolveAttackTarget(world, attackState);
  if (targetInfo && targetInfo.target.owner === unit.owner) {
    attackState.targetId = null;
    attackState.targetKind = null;
    targetInfo = null;
  }

  if (behavior.order.kind === "attackTarget" && !targetInfo) {
    attackState.targetId = behavior.order.targetId;
    attackState.targetKind = behavior.order.targetKind;
    targetInfo = resolveAttackTarget(world, attackState);
  }

  if (!targetInfo) {
    const enemy = findNearestEnemyTarget(world, unit.owner, unit.position, aggroRange);
    if (enemy) {
      attackState.targetId = enemy.target.id;
      attackState.targetKind = enemy.kind;
      targetInfo = enemy;
    }
  }

  if (targetInfo) {
    const targetPos = targetInfo.target.position;
    const distSqToTarget = distanceSq(unit.position, targetPos);
    const desiredRangeSq = desiredRange * desiredRange;
    if (distSqToTarget > desiredRangeSq * 0.85) {
      moveUnitTowards(unit, targetPos, def.moveSpeed, deltaSeconds);
    } else if (attackState.cooldown <= 0) {
      applyDamage(world, targetInfo.target, attackDef.damage, unit.owner);
      attackState.cooldown = attackDef.cooldown;
      behavior.lastAttackAt = now;
    }
    return;
  }

  if (behavior.order.kind === "attackMove" || behavior.order.kind === "move") {
    const dest = behavior.order.target;
    const remaining = moveUnitTowards(unit, dest, def.moveSpeed, deltaSeconds);
    if (remaining <= 0.5) {
      behavior.order = { kind: "idle" };
    }
  }
}

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

function chooseAttackPoint(world: GameWorld, ai: AiState): { x: number; z: number } {
  const playerBuilding = world.buildings.find((b) => b.owner === "player");
  if (playerBuilding) {
    return { ...playerBuilding.position };
  }
  return { ...ai.attackTarget };
}

function evaluateOutcome(world: GameWorld, now: number): void {
  if (world.outcome) {
    return;
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
}

function updateAi(world: GameWorld, now: number): void {
  if (world.outcome) {
    return;
  }
  const ai = world.ai;
  if (now - ai.lastProductionCheck >= 900) {
    ai.lastProductionCheck = now;
    const aiWorkers = world.units.filter((u) => u.owner === "ai" && u.typeId === "worker").length;
    const hq = world.buildings.find((b) => b.owner === "ai" && b.typeId === "hq");
    if (hq && aiWorkers < ai.desiredWorkers) {
      queueProduction(world, now, hq, "worker", { silent: true });
    }
    world.buildings
      .filter((b) => b.owner === "ai" && buildingDefs[b.typeId].produces.includes("infantry"))
      .forEach((barracks) => {
        queueProduction(world, now, barracks, "infantry", { silent: true });
      });
  }

  if (now >= ai.nextWaveAt) {
    const attackPoint = chooseAttackPoint(world, ai);
    world.units
      .filter((u) => u.owner === "ai" && world.defs.units[u.typeId].attack)
      .forEach((unit) => setOrder(unit, { kind: "attackMove", target: attackPoint }, now));
    world.statusMessage = "ИИ выдвигает ударную группу.";
    ai.waveNumber += 1;
    ai.desiredWorkers = Math.min(9, ai.desiredWorkers + 1);
    ai.nextWaveAt = now + Math.max(8000, 15000 - ai.waveNumber * 1200);
  }
}

export function createGameWorld(map: MapDefinition, now: number): GameWorld {
  const players: Record<FactionId, PlayerState> = {
    player: { id: "player", spice: 600, power: 50 },
    ai: { id: "ai", spice: 600, power: 50 },
  };

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

  const vision: Record<FactionId, VisionState> = {
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

  map.startLocations.forEach((start) => {
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
  });

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

  world.units.forEach((unit) => {
    if (unit.typeId === "worker") {
      updateWorker(world, unit, deltaSeconds);
    } else {
      updateCombatUnit(world, unit, deltaSeconds, now);
    }
  });

  cleanupDestroyed(world);
  recomputeVision(world);
  evaluateOutcome(world, now);
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
