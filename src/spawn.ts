import type {
  BuildingState,
  BuildingTypeId,
  FactionId,
  GameWorld,
  UnitState,
  UnitTypeId,
} from "./types";
import { buildingDefs, unitDefs } from "./defs";

type IdGen = () => string;

function makeIdGen(prefix: string): IdGen {
  let counter = 0;
  return () => `${prefix}-${++counter}`;
}

const nextUnitId = makeIdGen("unit");
const nextBuildingId = makeIdGen("bld");

export const nextQueueId = makeIdGen("q");

export function spawnBuilding(
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

export function spawnWorldUnit(
  world: GameWorld,
  owner: FactionId,
  unitTypeId: UnitTypeId,
  position: { x: number; z: number },
  facingDeg: number,
  now: number,
): UnitState {
  const def = unitDefs[unitTypeId];
  const attackState = def.attack ? { targetId: null, targetKind: null, cooldown: 0 } : null;
  const behaviorState = def.attack ? { order: { kind: "idle" } as const, lastAttackAt: now } : null;
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
