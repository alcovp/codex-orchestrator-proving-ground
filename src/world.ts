import type {
  BuildingDefinition,
  BuildingState,
  BuildingTypeId,
  FactionId,
  GameWorld,
  MapDefinition,
  PlayerState,
  ProductionQueueItem,
  Selection,
  UnitDefinition,
  UnitState,
  UnitTypeId,
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
  },
  infantry: {
    id: "infantry",
    name: "Легкая пехота",
    maxHp: 85,
    buildTime: 8,
    moveSpeed: 6.5,
    cost: { spice: 90 },
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
  },
  barracks: {
    id: "barracks",
    name: "Казармы",
    maxHp: 650,
    size: 10,
    produces: ["infantry"],
    queueLimit: 4,
    cost: { spice: 120 },
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
  },
};

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

  const world: GameWorld = {
    map,
    units,
    buildings,
    resourceNodes,
    players,
    defs: { units: unitDefs, buildings: buildingDefs },
    lastTick: now,
    statusMessage: "База готова. Рабочие ждут приказа добывать спайс.",
  };

  function spawnBuilding(
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
    buildings.push(building);
    return building;
  }

  function spawnInitialUnit(
    owner: FactionId,
    typeId: UnitTypeId,
    position: { x: number; z: number },
    facingDeg: number,
  ): UnitState {
    const def = unitDefs[typeId];
    const unit: UnitState = {
      id: nextUnitId(),
      typeId: def.id,
      owner,
      position: { ...position },
      facingDeg,
      hp: def.maxHp,
      ...(def.id === "worker"
        ? { harvest: { mode: "idle", nodeId: null, dropoffId: null, carried: 0, progress: 0 } }
        : {}),
    };
    units.push(unit);
    return unit;
  }

  map.startLocations.forEach((start) => {
    const facing = start.facingDeg ?? 0;
    const base = spawnBuilding(
      start.id === "ai" ? "ai" : "player",
      "hq",
      start.position,
      facing,
    );
    // Place barracks slightly offset on the right-hand side.
    const offset =
      start.id === "ai"
        ? { x: -base.rallyOffset.z, z: -base.rallyOffset.z }
        : { x: base.rallyOffset.z * 0.6, z: base.rallyOffset.z };
    const barracksPos = {
      x: start.position.x + offset.x,
      z: start.position.z + offset.z,
    };
    const barracks = spawnBuilding(
      start.id === "ai" ? "ai" : "player",
      "barracks",
      barracksPos,
      facing,
    );
    const refineryOffset =
      start.id === "ai"
        ? { x: -base.rallyOffset.z * 0.7, z: base.rallyOffset.z * 0.8 }
        : { x: base.rallyOffset.z * 0.8, z: -base.rallyOffset.z * 0.7 };
    spawnBuilding(
      start.id === "ai" ? "ai" : "player",
      "refinery",
      {
        x: start.position.x + refineryOffset.x,
        z: start.position.z + refineryOffset.z,
      },
      facing,
    );

    // A couple of starter units.
    spawnInitialUnit(start.id === "ai" ? "ai" : "player", "worker", {
      x: start.position.x + 3,
      z: start.position.z + 2,
    }, facing);
    spawnInitialUnit(start.id === "ai" ? "ai" : "player", "worker", {
      x: start.position.x - 3,
      z: start.position.z - 2,
    }, facing);
    spawnInitialUnit(start.id === "ai" ? "ai" : "player", "infantry", {
      x: barracks.position.x + 2,
      z: barracks.position.z - 2,
    }, facing);

    // Queue one infantry to demonstrate production.
    queueProduction(world, now, barracks, "infantry");
  });

  return world;
}

export function queueProduction(
  world: GameWorld,
  now: number,
  building: BuildingState,
  unitTypeId: UnitTypeId,
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
    world.statusMessage = `Недостаточно спайса: нужно ${unitDef.cost.spice}`;
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
  world.statusMessage = `${unitDef.name}: заказ принят (${player.spice} спайса осталось)`;
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
  spawnWorldUnit(world, building.owner, queueItem.unitTypeId, position, building.facingDeg);
}

function spawnWorldUnit(
  world: GameWorld,
  owner: FactionId,
  unitTypeId: UnitTypeId,
  position: { x: number; z: number },
  facingDeg: number,
): UnitState {
  const def = unitDefs[unitTypeId];
  const unit: UnitState = {
    id: nextUnitId(),
    typeId: def.id,
    owner,
    position,
    facingDeg,
    hp: def.maxHp,
    ...(def.id === "worker"
      ? { harvest: { mode: "idle", nodeId: null, dropoffId: null, carried: 0, progress: 0 } }
      : {}),
  };
  world.units.push(unit);
  return unit;
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
        world.statusMessage = `Доставлено ${Math.round(task.carried)} спайса`;
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

export function updateGameWorld(world: GameWorld, now: number): void {
  const previousTick = world.lastTick;
  world.lastTick = now;
  const deltaSeconds = Math.min((now - previousTick) / 1000, 0.25);
  // Future: use delta for movement/logic; for now just drive production.
  world.buildings.forEach((building) => {
    if (!building.queue.length) {
      return;
    }
    const next = building.queue[0]!;
    if (now >= next.readyAt) {
      building.queue.shift();
      spawnFromQueue(world, building, next);
      const unitDef = world.defs.units[next.unitTypeId];
      world.statusMessage = `${unitDef.name} готов к выходу`;
    }
  });

  world.units.forEach((unit) => updateWorker(world, unit, deltaSeconds));
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
