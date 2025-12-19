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
  },
  infantry: {
    id: "infantry",
    name: "Легкая пехота",
    maxHp: 85,
    buildTime: 8,
    moveSpeed: 6.5,
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
  },
  barracks: {
    id: "barracks",
    name: "Казармы",
    maxHp: 650,
    size: 10,
    produces: ["infantry"],
    queueLimit: 4,
  },
  refinery: {
    id: "refinery",
    name: "Переработка",
    maxHp: 700,
    size: 10,
    produces: [],
    queueLimit: 0,
  },
};

export function createGameWorld(map: MapDefinition, now: number): GameWorld {
  const players: Record<FactionId, PlayerState> = {
    player: { id: "player", spice: 600, power: 50 },
    ai: { id: "ai", spice: 600, power: 50 },
  };

  const buildings: BuildingState[] = [];
  const units: UnitState[] = [];

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
    queueProduction(now, barracks, "infantry");
  });

  return {
    map,
    units,
    buildings,
    players,
    defs: { units: unitDefs, buildings: buildingDefs },
    lastTick: now,
  };
}

export function queueProduction(
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
  const unitDef = unitDefs[unitTypeId];
  const item: ProductionQueueItem = {
    id: nextQueueId(),
    unitTypeId,
    startedAt: now,
    readyAt: now + unitDef.buildTime * 1000,
  };
  building.queue.push(item);
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
  };
  world.units.push(unit);
  return unit;
}

export function updateGameWorld(world: GameWorld, now: number): void {
  const previousTick = world.lastTick;
  world.lastTick = now;
  // Future: use delta for movement/logic; for now just drive production.
  world.buildings.forEach((building) => {
    if (!building.queue.length) {
      return;
    }
    const next = building.queue[0];
    if (now >= next.readyAt) {
      building.queue.shift();
      spawnFromQueue(world, building, next);
    }
  });
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
